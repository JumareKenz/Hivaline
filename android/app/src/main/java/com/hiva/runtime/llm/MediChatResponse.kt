package com.hiva.runtime.llm

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Schema-enforced response structure for LEAP constrained generation.
 *
 * LEAP's jsonSchemaConstraint enforces this at decode time, so a malformed
 * response is an integration bug, not a model quality issue.
 *
 * groundednessSignal is a SECONDARY signal only. The primary clinical safety
 * gate is the TypeScript checkGrounding() term-match check in conversationEngine.ts,
 * which runs independently on answerText regardless of what this field says.
 * Disagreements between the two are logged as data-quality signals.
 */
@Serializable
data class MediChatResponse(
    /** The generated answer, or exactly "INSUFFICIENT_EVIDENCE" if evidence doesn't support an answer. */
    @SerialName("answer_text")
    val answerText: String,

    /**
     * Chunk IDs the model believes support the answer.
     * These are the IDs that appeared in the evidence string passed to the model
     * (e.g., "Source: <chunk_id>"). Empty list is valid for INSUFFICIENT_EVIDENCE.
     */
    @SerialName("source_chunk_ids")
    val sourceChunkIds: List<String>,

    /**
     * Model's self-assessed groundedness. One of: "GROUNDED", "PARTIAL", "INSUFFICIENT".
     * "INSUFFICIENT" corresponds to the INSUFFICIENT_EVIDENCE signal — model believes
     * the evidence does not support an answer.
     *
     * This field is a SECONDARY signal. The TypeScript term-match check (≥70%) is primary
     * and always runs, regardless of this value. Log when the two disagree.
     */
    @SerialName("groundedness_signal")
    val groundednessSignal: GroundednessSignal,
)

@Serializable
enum class GroundednessSignal {
    @SerialName("GROUNDED") GROUNDED,
    @SerialName("PARTIAL") PARTIAL,
    @SerialName("INSUFFICIENT") INSUFFICIENT,
}
