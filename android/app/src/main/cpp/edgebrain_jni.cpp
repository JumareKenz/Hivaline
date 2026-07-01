/**
 * edgebrain_jni.cpp — JNI bridge between EdgeBrainPlugin.kt and llama.cpp
 *
 * Exposes model load/unload, context creation, and text generation to Kotlin.
 * The llama.cpp library is linked as a shared library (.so) built separately
 * via the CMakeLists.txt in this directory.
 */

#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>
#include "llama.h"

#define TAG "EdgeBrainJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static int g_last_token_count = 0;

// Inline helper functions (avoid depending on common lib)
static void common_batch_clear(struct llama_batch & batch) {
    batch.n_tokens = 0;
}

static void common_batch_add(
        struct llama_batch & batch,
              llama_token   id,
                llama_pos   pos,
    const std::vector<llama_seq_id> & seq_ids,
                     bool   logits) {
    batch.token   [batch.n_tokens] = id;
    batch.pos     [batch.n_tokens] = pos;
    batch.n_seq_id[batch.n_tokens] = seq_ids.size();
    for (size_t i = 0; i < seq_ids.size(); ++i) {
        batch.seq_id[batch.n_tokens][i] = seq_ids[i];
    }
    batch.logits  [batch.n_tokens] = logits;

    batch.n_tokens++;
}

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_hiva_runtime_llm_EdgeBrainPlugin_nativeLoadModel(
    JNIEnv* env, jobject /* this */, jstring jpath) {

    const char* path = env->GetStringUTFChars(jpath, nullptr);
    LOGI("Loading model from: %s", path);

    llama_model_params params = llama_model_default_params();
    params.n_gpu_layers = 0; // CPU-only on mobile

    llama_model* model = llama_load_model_from_file(path, params);
    env->ReleaseStringUTFChars(jpath, path);

    if (!model) {
        LOGE("Failed to load model");
        return 0;
    }

    LOGI("Model loaded successfully");
    return reinterpret_cast<jlong>(model);
}

JNIEXPORT jlong JNICALL
Java_com_hiva_runtime_llm_EdgeBrainPlugin_nativeCreateContext(
    JNIEnv* /* env */, jobject /* this */, jlong jmodel, jint contextSize) {

    auto* model = reinterpret_cast<llama_model*>(jmodel);

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = contextSize;
    ctx_params.n_batch = 512;
    ctx_params.n_threads = 4;

    llama_context* ctx = llama_new_context_with_model(model, ctx_params);
    if (!ctx) {
        LOGE("Failed to create context");
        return 0;
    }

    LOGI("Context created (n_ctx=%d)", contextSize);
    return reinterpret_cast<jlong>(ctx);
}

JNIEXPORT void JNICALL
Java_com_hiva_runtime_llm_EdgeBrainPlugin_nativeFreeModel(
    JNIEnv* /* env */, jobject /* this */, jlong jmodel) {

    auto* model = reinterpret_cast<llama_model*>(jmodel);
    if (model) {
        llama_free_model(model);
        LOGI("Model freed");
    }
}

JNIEXPORT void JNICALL
Java_com_hiva_runtime_llm_EdgeBrainPlugin_nativeFreeContext(
    JNIEnv* /* env */, jobject /* this */, jlong jctx) {

    auto* ctx = reinterpret_cast<llama_context*>(jctx);
    if (ctx) {
        llama_free(ctx);
        LOGI("Context freed");
    }
}

JNIEXPORT jstring JNICALL
Java_com_hiva_runtime_llm_EdgeBrainPlugin_nativeGenerate(
    JNIEnv* env, jobject /* this */,
    jlong jctx,
    jstring jprompt,
    jint maxTokens,
    jfloat temperature,
    jfloat topP,
    jfloat repeatPenalty,
    jobjectArray jstopSequences) {

    auto* ctx = reinterpret_cast<llama_context*>(jctx);
    const llama_model* model = llama_get_model(ctx);

    const char* prompt_cstr = env->GetStringUTFChars(jprompt, nullptr);
    std::string prompt(prompt_cstr);
    env->ReleaseStringUTFChars(jprompt, prompt_cstr);

    // Collect stop sequences
    std::vector<std::string> stop_sequences;
    int stop_count = env->GetArrayLength(jstopSequences);
    for (int i = 0; i < stop_count; i++) {
        auto jstr = (jstring)env->GetObjectArrayElement(jstopSequences, i);
        const char* s = env->GetStringUTFChars(jstr, nullptr);
        stop_sequences.emplace_back(s);
        env->ReleaseStringUTFChars(jstr, s);
    }

    // Tokenize prompt
    const int n_ctx = llama_n_ctx(ctx);
    const llama_vocab* vocab = llama_model_get_vocab(model);
    std::vector<llama_token> tokens(n_ctx);
    int n_tokens = llama_tokenize(vocab, prompt.c_str(), prompt.length(),
                                   tokens.data(), tokens.size(), true, true);
    if (n_tokens < 0) {
        LOGE("Tokenization failed");
        return env->NewStringUTF("");
    }
    tokens.resize(n_tokens);

    LOGI("Prompt tokenized: %d tokens", n_tokens);

    // Evaluate prompt (KV cache is auto-managed in new API)
    llama_batch batch = llama_batch_init(512, 0, 1);
    for (int i = 0; i < n_tokens; i++) {
        common_batch_add(batch, tokens[i], i, {0}, false);
    }
    batch.logits[batch.n_tokens - 1] = true;

    if (llama_decode(ctx, batch) != 0) {
        LOGE("Prompt decode failed");
        llama_batch_free(batch);
        return env->NewStringUTF("");
    }

    // Generate tokens
    std::string output;
    int generated = 0;
    int cur_pos = n_tokens;

    llama_sampler* sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(temperature));
    llama_sampler_chain_add(sampler, llama_sampler_init_top_p(topP, 1));
    llama_sampler_chain_add(sampler, llama_sampler_init_penalties(
        64, repeatPenalty, 0.0f, 0.0f));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(42));

    while (generated < maxTokens) {
        llama_token new_token = llama_sampler_sample(sampler, ctx, -1);

        if (llama_vocab_is_eog(vocab, new_token)) {
            break;
        }

        char buf[256];
        int len = llama_token_to_piece(vocab, new_token, buf, sizeof(buf), 0, true);
        if (len > 0) {
            output.append(buf, len);
        }

        // Check stop sequences
        bool should_stop = false;
        for (const auto& stop : stop_sequences) {
            if (output.length() >= stop.length() &&
                output.compare(output.length() - stop.length(), stop.length(), stop) == 0) {
                output.erase(output.length() - stop.length());
                should_stop = true;
                break;
            }
        }
        if (should_stop) break;

        // Prepare next token
        common_batch_clear(batch);
        common_batch_add(batch, new_token, cur_pos, {0}, true);
        cur_pos++;

        if (llama_decode(ctx, batch) != 0) {
            LOGE("Decode failed at token %d", generated);
            break;
        }

        generated++;
    }

    llama_sampler_free(sampler);
    llama_batch_free(batch);

    g_last_token_count = generated;
    LOGI("Generated %d tokens, output length: %zu", generated, output.length());

    return env->NewStringUTF(output.c_str());
}

JNIEXPORT jint JNICALL
Java_com_hiva_runtime_llm_EdgeBrainPlugin_nativeGetLastTokenCount(
    JNIEnv* /* env */, jobject /* this */) {
    return g_last_token_count;
}

} // extern "C"
