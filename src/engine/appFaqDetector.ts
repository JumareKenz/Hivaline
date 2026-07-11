/**
 * appFaqDetector.ts — Detects and responds to app-level queries
 *
 * Handles queries about HIVA itself rather than clinical content:
 * - How to use the app
 * - Offline functionality
 * - Updates and credentials
 * - Search instructions
 */

const APP_FAQ: Array<{ patterns: string[]; response: string; followUps: string[] }> = [
  {
    patterns: ['what can you do', 'what do you do', 'who are you', 'what is hiva', 'what are you', 'your features', 'your capabilities'],
    response: "I'm HIVA — your offline clinical companion. I can help you with:\n\n• FMOH-approved clinical guidelines (malaria, ANC, child health, essential medicines, emergency referral)\n• Drug dosing calculations by patient weight\n• Step-by-step decision trees for common conditions\n• Danger sign recognition and urgent referral guidance\n• All of this works completely offline — no internet needed after your first login.",
    followUps: ['How do you work offline?', 'How do I get updates?', 'How do I search?'],
  },
  {
    patterns: ['offline', 'no internet', 'without network', 'work offline', 'how do you work offline', 'offline mode'],
    response: "HIVA is built to work entirely offline. Here's how:\n\n• After your first login, the app downloads all clinical guidelines securely to your device\n• No internet needed to use them — everything is stored locally\n• Everything runs locally: search, drug tables, decision trees, and responses\n• You only need internet briefly to check for guideline updates (we'll prompt you)\n• Perfect for rural health facilities with unreliable connectivity.",
    followUps: ['How do I get updates?', 'What can you do?', 'What is my access code?'],
  },
  {
    patterns: ['update', 'get updates', 'how do i get updates', 'check for updates', 'new version', 'download update'],
    response: "Getting updates is simple:\n\n• Go to Settings → tap 'Check for Updates'\n• If a newer version of clinical data is available, HIVA will download it automatically\n• Updates happen in the background — you can keep using the app\n• The app also checks for updates automatically after each login\n• Your current version, chunk count, and coverage score are shown in Settings → Clinical Data.",
    followUps: ['How do you work offline?', 'What can you do?', 'How do I search?'],
  },
  {
    patterns: ['access code', 'server code', 'my code', 'what is my access code', 'login code', 'facility code', 'credentials'],
    response: "Your access credentials are provided by your facility supervisor or state coordinator:\n\n• Server Code: looks like HIVA-XXXX (your facility identifier)\n• Access Key: a 4-character key (e.g., A7B2) given to you personally\n• Both are required to log in\n• If you forget them, contact your supervisor — they can reissue your Access Key\n• Never share your Access Key with others.",
    followUps: ['How do I get updates?', 'How do you work offline?', 'What can you do?'],
  },
  {
    patterns: ['how do i search', 'how do i query', 'how to search', 'how to query', 'how does search work', 'ask questions', 'type questions'],
    response: "Just type your question naturally in the chat box and hit send — that's it!\n\n• I understand plain English: 'child with fever for 3 days', 'ACT dose for 15kg', 'signs of severe malaria'\n• I also have a Knowledge Base tab where you can browse all approved guidelines\n• For drug dosing, use the Drug Tables tab with the weight slider\n• For step-by-step protocols, check the Decision Trees tab\n• Voice input is available too — tap the microphone icon.",
    followUps: ['What can you do?', 'How do you work offline?', 'How do I get updates?'],
  },
];

/**
 * Check if query matches an app FAQ pattern.
 */
export function getAppFaqResponse(query: string): { response: string; followUps: string[] } | null {
  const lower = query.toLowerCase().trim();
  for (const faq of APP_FAQ) {
    if (faq.patterns.some((p) => lower.includes(p))) {
      return { response: faq.response, followUps: faq.followUps };
    }
  }
  return null;
}
