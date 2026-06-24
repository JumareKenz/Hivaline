/**
 * greetingHandler.ts — Greeting and social acknowledgment responses
 *
 * Handles turn-1 greetings and mid-conversation social triggers
 * like "thanks", "ok", "bye" with context-aware routing.
 */

const GREETING_RESPONSES = [
  "Hello! I'm HIVA, your clinical companion. How can I help you today?",
  'Hi there — ready to help. How can I help you today?',
  'Good to have you here. How can I help you today?',
  'Hello! How can I help you today?',
];

const SOCIAL_RESPONSES = [
  "You're welcome! Let me know if anything else comes up.",
  'Glad to help. Stay confident — you\'ve got this.',
  'Anytime. Your patients are lucky to have you.',
  'Happy to help. Reach out whenever you need guidance.',
];

const SOCIAL_TRIGGERS = [
  'thanks', 'thank you', 'thank', 'thx',
  'got it', 'understood', 'noted',
  'great', 'good', 'perfect', 'awesome', 'nice',
  'bye', 'goodbye', 'see you', 'later',
];

const ALWAYS_SOCIAL = [
  'thanks', 'thank you', 'thank', 'thx',
  'bye', 'goodbye', 'see you', 'later',
];

const DANGER_KEYWORDS = [
  'convulsing', 'convulsion', 'fitting', 'seizure',
  'not breathing', 'cant breathe', 'difficulty breathing',
  'unconscious', 'unresponsive', 'collapsed',
  'bleeding heavily', 'severe bleeding', 'hemorrhage',
  'cyanosis', 'blue lips', 'blue skin',
  'shock', 'cold extremities',
];

const CLINICAL_KEYWORDS = [
  'fever', 'malaria', 'diarrhea', 'vomiting', 'convulsion',
  'rash', 'cough', 'bleeding', 'jaundice', 'anaemia',
  'pneumonia', 'dehydration', 'malnutrition',
  'delivery', 'labour', 'pregnancy', 'anc',
  'pph', 'postpartum', 'hemorrhage', 'haemorrhage',
  'pre-eclampsia', 'preeclampsia', 'hypertension', 'eclampsia',
  'sepsis', 'obstructed labour', 'prolonged labour',
  'retained placenta', 'perineal tear', 'episiotomy',
  'newborn', 'neonatal', 'asphyxia', 'resuscitation',
  'immunization', 'vaccination', 'family planning', 'contraception',
  'sti', 'hiv', 'tb', 'nutrition', 'anemia',
  'blood pressure', 'sugar', 'diabetes',
  'injury', 'burn', 'fracture', 'wound', 'infection',
];

/**
 * Check if message is a short greeting on turn 1 with no clinical keywords.
 */
export function isShortGreeting(message: string, turnCount: number): boolean {
  const lowerMsg = message.toLowerCase();
  const isUrgentMsg = DANGER_KEYWORDS.some((k) => lowerMsg.includes(k));
  return (
    turnCount === 1 &&
    message.trim().split(/\s+/).length < 6 &&
    !CLINICAL_KEYWORDS.some((k) => lowerMsg.includes(k)) &&
    !isUrgentMsg
  );
}

/**
 * Check if message is a social trigger (thanks, bye, etc.) that should get
 * a social response instead of routing to search.
 * Context-aware: won't intercept clinical messages or affirmations during active topics.
 */
export function isSocialTrigger(message: string, hasActiveTopic: boolean, hasClinical: boolean): boolean {
  const lower = message.toLowerCase().trim();
  const isTrigger = SOCIAL_TRIGGERS.some((t) => lower === t || lower.startsWith(t + ' '));
  if (!isTrigger) return false;

  // Never intercept clinical messages
  if (hasClinical) return false;

  // If clinical topic is active, only pure social words trigger (not affirmations)
  if (hasActiveTopic) {
    return ALWAYS_SOCIAL.some((t) => lower === t || lower.startsWith(t + ' '));
  }

  return true;
}

/**
 * Check if message contains clinical keywords.
 */
export function hasClinicalKeywords(message: string): boolean {
  const lower = message.toLowerCase();
  return CLINICAL_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * Get greeting response based on turn count.
 */
export function getGreetingResponse(turnCount: number): string {
  const greetingIndex = (turnCount - 1) % GREETING_RESPONSES.length;
  return GREETING_RESPONSES[greetingIndex];
}

/**
 * Get social acknowledgment response based on turn count.
 */
export function getSocialResponse(turnCount: number): string {
  const socialIndex = (turnCount - 1) % SOCIAL_RESPONSES.length;
  return SOCIAL_RESPONSES[socialIndex];
}

/**
 * Export clinical keywords for slot extraction.
 */
export { CLINICAL_KEYWORDS };
