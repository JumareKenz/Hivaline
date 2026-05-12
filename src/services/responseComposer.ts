/**
 * responseComposer.ts — Compose warm, contextual clinical responses
 *
 * Selects tone-appropriate answers, adds conversational openers,
 * reformats long answers for spoken delivery, and appends
 * context-sensitive closings.
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

  // Step 2: Reformat answer for conversational delivery
  let spokenAnswer = reformatForConversation(toneAnswer);

  // Step 3: Select opener
  const opener = selectOpener(content, state, intent);

  // Track opener used so we don't repeat next turn
  if (opener !== undefined) {
    state.lastOpener = opener;
  }

  // Step 4: Compose main response
  let response = opener ? `${opener}\n\n${spokenAnswer}` : spokenAnswer;

  // Step 5: Append follow-up question if key slot is missing
  const missingSlot = getMissingSlot(state, intent);
  if (missingSlot && content.follow_up_questions) {
    const followUps = content.follow_up_questions as string[];
    if (followUps.length > 0 && intent !== 'urgent') {
      response += `\n\n${followUps[0]}`;
    }
  }

  // Step 6: Append context-sensitive closing line
  const closing = selectClosing(intent, response);
  if (closing) {
    response += `\n\n${closing}`;
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
 * Reformat extracted document text for conversational delivery.
 */
function reformatForConversation(answer: string): string {
  let text = answer;

  // Strip document boilerplate phrases
  const boilerplatePatterns = [
    /In Nigeria[,\s]+/gi,
    /A comprehensive plan of action[,\s]+/gi,
    /significantly contribute to[,\s]+/gi,
    /It is important to note that[,\s]+/gi,
    /It should be noted that[,\s]+/gi,
    /Research has shown that[,\s]+/gi,
    /Studies indicate that[,\s]+/gi,
  ];
  for (const pattern of boilerplatePatterns) {
    text = text.replace(pattern, '');
  }

  // Rewrite parenthetical dosing: "(10 IU, IV/IM)" → "— give 10 IU IV or IM"
  text = text.replace(
    /\((\d+(?:\.\d+)?\s*(?:mg|g|kg|ml|IU|mcg|units?))[,\s]+([^)]+)\)/gi,
    '— give $1 $2'
  );
  // Also handle "IV/IM" style slashes
  text = text.replace(/\bgive\s+([^—]+?)\s+(IV|IM|PO|SC)\/([IVMOSC]+)\b/gi, 'give $1 $2 or $3');

  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  if (wordCount > 120) {
    // Extract first 2 sentences as spoken response
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const spokenPart = sentences.slice(0, 2).join(' ').trim();

    // Remaining content becomes bullets
    const remaining = sentences.slice(2).join(' ').trim();
    const bullets = extractBullets(remaining, 4, 12);

    if (bullets.length > 0) {
      return `${spokenPart}\n\nKey points:\n${bullets.map(b => `• ${b}`).join('\n')}`;
    }
    return spokenPart;
  }

  return text.trim();
}

/**
 * Extract short bullet points from remaining text.
 */
function extractBullets(text: string, maxBullets: number, maxWordsPerBullet: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const bullets: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) continue;

    // Truncate to max words
    const bulletText = words.slice(0, maxWordsPerBullet).join(' ');
    bullets.push(bulletText.replace(/[.!?]+$/, ''));

    if (bullets.length >= maxBullets) break;
  }

  return bullets;
}

/**
 * Select an appropriate conversational opener with rotation.
 *
 * Rules:
 * - Turn 1: openers[1] — generic warm opener
 * - Turn 2+ with SAME chiefComplaint: openers[2] — follow-up opener
 * - Turn 2+ with NEW chiefComplaint: openers[0] — contextual opener
 * - Never repeat the exact same opener twice in a row
 */
function selectOpener(
  content: Record<string, unknown>,
  state: ConversationState,
  intent: IntentType
): string | null {
  const openers = content.conversational_openers;
  if (!Array.isArray(openers) || openers.length === 0) {
    return null;
  }

  // Urgent: skip opener, get straight to the point
  if (intent === 'urgent') {
    return null;
  }

  let selected: string | null = null;

  if (state.turnCount === 1) {
    // Turn 1: generic opener
    selected = openers[1] ?? openers[0] ?? null;
  } else if (intent === 'follow_up' || state.turnCount > 1) {
    const currentComplaint = state.slots.chiefComplaint;
    const previousComplaint = state.lastChiefComplaint;

    if (currentComplaint && previousComplaint && currentComplaint === previousComplaint) {
      // Same topic — use follow-up opener
      selected = openers[2] ?? openers[0] ?? null;
    } else {
      // New topic — use contextual opener
      selected = openers[0] ?? openers[1] ?? null;
    }
  } else {
    selected = openers[1] ?? openers[0] ?? null;
  }

  if (typeof selected !== 'string') {
    return null;
  }

  // Replace placeholders
  if (state.slots.chiefComplaint) {
    selected = selected.replace(/{chief_complaint}/g, state.slots.chiefComplaint);
  }
  if (state.slots.patientAge) {
    selected = selected.replace(/{age}/g, state.slots.patientAge);
  }
  if (state.slots.patientWeight) {
    selected = selected.replace(/{weight}/g, state.slots.patientWeight);
  }

  // Anti-repetition: if this exact opener was used last turn, pick the next one
  if (selected === state.lastOpener) {
    const currentIndex = openers.findIndex((o) => typeof o === 'string' && o === selected);
    const nextIndex = (currentIndex + 1) % openers.length;
    const nextOpener = openers[nextIndex];
    if (typeof nextOpener === 'string') {
      selected = nextOpener;
      // Re-apply placeholders
      if (state.slots.chiefComplaint) {
        selected = selected.replace(/{chief_complaint}/g, state.slots.chiefComplaint);
      }
      if (state.slots.patientAge) {
        selected = selected.replace(/{age}/g, state.slots.patientAge);
      }
      if (state.slots.patientWeight) {
        selected = selected.replace(/{weight}/g, state.slots.patientWeight);
      }
    }
  }

  return selected;
}

/**
 * Select a context-sensitive closing line based on intent.
 * Never append if the response already ends with a question.
 */
function selectClosing(intent: IntentType, response: string): string | null {
  // If response already ends with a question, don't add another
  const trimmed = response.trim();
  if (trimmed.endsWith('?')) return null;

  switch (intent) {
    case 'clinical':
      return 'Anything else about this patient?';
    case 'follow_up':
      return 'Does that help, or do you need the specific dose?';
    case 'urgent':
      return 'Is the patient stable right now?';
    default:
      return null;
  }
}

/**
 * Determine which key slot is missing for follow-up
 */
function getMissingSlot(state: ConversationState, intent: IntentType): string | null {
  if (intent === 'urgent') return null;

  if (!state.slots.chiefComplaint) return 'chiefComplaint';
  if (!state.slots.patientAge) return 'patientAge';
  if (!state.slots.patientWeight) return 'patientWeight';
  if (!state.slots.symptomDuration) return 'symptomDuration';

  return null;
}
