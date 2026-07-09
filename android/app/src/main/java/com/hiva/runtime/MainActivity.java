package com.hiva.runtime;

import com.getcapacitor.BridgeActivity;
import com.hiva.runtime.llm.EdgeBrainPlugin;
import com.hiva.runtime.retriever.NativeRetrieverPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(EdgeBrainPlugin.class);
        registerPlugin(NativeRetrieverPlugin.class);
        // Native TTS temporarily disabled: debugging crash during initialization
        // registerPlugin(NativeTTSPlugin.class);
        // Native STT deferred: moonshine-voice requires API 35, will use Web Speech Recognition fallback
        super.onCreate(savedInstanceState);
    }
}
