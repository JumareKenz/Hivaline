/**
 * responseComposer.ts — Compose warm, contextual clinical responses
 *
 * Selects tone-appropriate answers, adds conversational openers,
 * and appends follow-up questions when slots are missing.
 */

import type { HIVChunk, ConversationState, IntentType } from '@/types/hiv';

export function composeResponse(
  chunk: HIVChunk,
  state: ConversationState,
  intent: IntentType
): string {
  const lang = 'en';
  const content = chunk.content[lang] as Record<string, unknown> | undefined;

  if (!content) {
    return 'I found relevant information, but the content is not available in this release.';
  }

  // Step 1: Select tone-appropriate answer
  const toneAnswer = selectToneAnswer(content, state, intent);
  if (!toneAnswer) {
    return 'I found relevant information, but the answer is not available.';
  }

  // Step 2: Select opener
  const opener = selectOpener(content, state, intent);

  // Step 3: Compose
  let response = opener ? `${opener}\n\n${toneAnswer}` : toneAnswer;

  // Step 4: Append follow-up question if key slot is missing
  const missingSlot = getMissingSlot(state, intent);
  if (missingSlot && content.follow_up_questions) {
    const followUps = content.follow_up_questions as string[];
    if (followUps.length > 0 && intent !== 'urgent') {
      response += `\n\n${followUps[0]}`;
    }
  }

  return response;
}

/**
 * Select the most appropriate answer variant based on intent and state
 */
function selectToneAnswer(
  content: Record<string, unknown>,
  state: ConversationState,
  intent: IntentType
): string | null {
  // Urgent → always use urgent answer
  if (intent === 'urgent') {
    const urgent = content.answer_urgent;
    if (typeof urgent === 'string' && urgent.length > 0) return urgent;
  }

  // Turn count > 2 → use direct (they know the context)
  if (state.turnCount > 2) {
    const direct = content.answer_direct;
    if (typeof direct === 'string' && direct.length > 0) return direct;
  }

  // Default priority: answer > answer_formal > answer_direct > answer_reassuring
  const answer = content.answer;
  if (typeof answer === 'string' && answer.length > 0) return answer;

  const formal = content.answer_formal;
  if (typeof formal === 'string' && formal.length > 0) return formal;

  const direct = content.answer_direct;
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const reassuring = content.answer_reassuring;
  if (typeof reassuring === 'string' && reassuring.length > 0) return reassuring;

  // Fallback: any string field that looks like an answer
  for (const [key, value] of Object.entries(content)) {
    if (key.startsWith('answer') && typeof value === 'string' && value.length > 50) {
      return value;
    }
  }

  return null;
}

/**
 * Select an appropriate conversational opener
 */
function selectOpener(
  content: Record<string, unknown>,
  state: ConversationState,
  intent: IntentType
): string | null {
  const openers = content.conversational_openers;
  if (!Array.isArray(openers) || openers.length === 0) {
    // No openers available — return null (no opener)
    return null;
  }

  // Urgent: skip opener, get straight to the point
  if (intent === 'urgent') {
    return null;
  }

  // Follow-up with chief complaint → use follow-up opener
  if (intent === 'follow_up' && state.slots.chiefComplaint && state.turnCount > 1) {
    const opener = openers[2] || openers[0];
    if (typeof opener === 'string') {
      return opener.replace(/{chief_complaint}/g, state.slots.chiefComplaint);
    }
  }

  // Has slots → use contextual opener
  const hasSlots = Object.values(state.slots).some(s => s !== null);
  if (hasSlots && openers[0]) {
    let opener = openers[0] as string;
    if (state.slots.chiefComplaint) {
      opener = opener.replace(/{chief_complaint}/g, state.slots.chiefComplaint);
    }
    if (state.slots.patientAge) {
      opener = opener.replace(/{age}/g, state.slots.patientAge);
    }
    if (state.slots.patientWeight) {
      opener = opener.replace(/{weight}/g, state.slots.patientWeight);
    }
    return opener;
  }

  // Default warm opener
  if (openers[1]) {
    return openers[1] as string;
  }

  return null;
}

/**
 * Determine which key slot is missing for follow-up
 */
function getMissingSlot(state: ConversationState, intent: IntentType): string | null {
  if (intent === 'urgent') return null; // Don't delay urgent responses

  if (!state.slots.chiefComplaint) return 'chiefComplaint';
  if (!state.slots.patientAge) return 'patientAge';
  if (!state.slots.patientWeight) return 'patientWeight';
  if (!state.slots.symptomDuration) return 'symptomDuration';

  return null;
}
