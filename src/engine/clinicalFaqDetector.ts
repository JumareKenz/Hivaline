/**
 * clinicalFaqDetector.ts — Fuzzy-matched clinical Q&A pairs
 *
 * Returns exact responses for recognized clinical questions.
 * Uses token overlap scoring with typo tolerance and synonym expansion.
 * Checked before the hybrid search pipeline for fast, deterministic answers.
 */

interface ClinicalFaq {
  id: string;
  keywords: string[][];
  response: string;
  followUps: string[];
}

interface ContextualFaq {
  id: string;
  keywords: string[][];
  contextRequired: string;
  response: string;
  followUps: string[];
}

// Each FAQ has keyword groups. A match is scored by how many groups have at least one keyword present.
// keywords[i] = array of synonyms for that concept (any one counts as a hit for the group).
const CLINICAL_FAQS: ClinicalFaq[] = [
  {
    id: 'amoxicillin-dose-child',
    keywords: [
      ['amoxicillin', 'amoxicilin', 'amoxycillin', 'amoxi'], // Drug name MUST match
      ['dose', 'dosage', 'dosing', 'how much', 'give', 'prescribe', 'administer'],
      ['child', 'kid', 'pikin', 'paediatric', 'pediatric', 'kg', 'weight'],
    ],
    // NOTE: Requires ALL 3 groups (drug name is mandatory)
    response:
      "For a 14kg child, you want to give 250mg of amoxicillin three times a day — so morning, afternoon, and night. Keep it going for at least 5 days, even if the child starts looking better before then. Stopping early is one of the main reasons infections come back.",
    followUps: ['What if the child vomits after taking it?', 'Any side effects to watch for?', 'Can I crush the tablet?'],
  },
  {
    id: 'cholera-management',
    keywords: [
      ['cholera'],
      ['manage', 'management', 'treat', 'treatment', 'handle', 'case', 'suspected', 'what do i do'],
      ['rural', 'facility', 'phc', 'clinic', 'primary'],
    ],
    response:
      "First thing — start ORS straight away, don't wait for lab confirmation. For mild to moderate dehydration, give 75ml per kg over about 4 hours and keep reassessing. If the patient is severely dehydrated — think sunken eyes, weak pulse, not passing urine — move to IV Ringer's Lactate and get them referred urgently. While you're doing all that, isolate the patient and notify your LGA disease surveillance officer. Cholera spreads fast, so that notification call matters.",
    followUps: ['How do I prepare ORS?', 'What are the signs of severe dehydration?', 'How do I isolate the patient?'],
  },
  {
    id: 'postpartum-hemorrhage-signs',
    keywords: [
      ['postpartum', 'post-partum', 'after delivery', 'after birth', 'pph'],
      ['hemorrhage', 'haemorrhage', 'bleeding', 'blood loss'],
      ['warning', 'signs', 'symptoms', 'watch for', 'recognize', 'detect', 'what are'],
    ],
    response:
      "The main thing you're watching for is bleeding that feels like too much — more than 500ml after a vaginal delivery. But don't just go by volume, because it's easy to underestimate. Also check the uterus — if it feels soft and boggy instead of firm, that's a sign it's not contracting the way it should. And watch the mother: rapid weak pulse, dropping blood pressure, pallor — those tell you she's losing more than her body can handle. Act immediately. Massage the uterus, give oxytocin 10 IU IM, get IV access in, and if the bleeding doesn't slow down, she needs a higher facility now.",
    followUps: ['How do I do uterine massage?', 'What if oxytocin is not available?', 'When should I refer?'],
  },
  {
    id: 'malaria-signs-pidgin',
    keywords: [
      ['malaria', 'zazzabi'],
      ['pikin', 'child', 'pickin', 'small pikin'],
      ['sign', 'signs', 'symptom', 'wetin', 'how', 'know'],
    ],
    response:
      "Oga, watch out for high fever wey dey come and go, pikin dey shake or shiver, vomiting, and sometimes the eyes fit turn yellow small. If pikin no fit drink water, dey convulse, or e just dey lie down without energy — that one is emergency, refer am sharp sharp. But first, do RDT to confirm, then give ACT medicine according to the pikin weight. No give aspirin for fever for pikin — use paracetamol only.",
    followUps: ['How I go give ACT?', 'Wetin be danger sign?', 'How I go refer?'],
  },
  {
    id: 'imci-fever-protocol',
    keywords: [
      ['imci', 'integrated management'],
      ['fever', 'febrile', 'temperature', 'hot'],
      ['steps', 'protocol', 'walk', 'guide', 'approach', 'assess', 'child'],
    ],
    response:
      "Okay, let's go through it. First, check for danger signs before anything else — can the child drink, are they convulsing, are they vomiting everything, are they unconscious? Any one of those means refer immediately, don't delay.\nIf no danger signs, look at the fever pattern. Been there 7 days or more? Refer for proper assessment. Less than that and you're in a malaria-risk area? Do an RDT.\nRDT positive — treat with ACT based on the child's weight. RDT negative — now look for another cause. Check the ears, throat, urine. The fever is coming from somewhere.\nFinish by counselling the caregiver. Tell them exactly what signs should bring them back immediately — don't assume they know.",
    followUps: ['What are the IMCI danger signs?', 'How do I dose ACT?', 'What if the RDT is negative?'],
  },
  {
    id: 'fever-management-hausa',
    keywords: [
      ['zazzaɓi', 'zazzabi', 'fever'],
      ['yaro', 'yara', 'child', 'ɗa'],
      ['magance', 'magani', 'treat', 'yaya'],
    ],
    response:
      "To fara, yi amfani da paracetamol bisa nauyin yaron — wannan zai rage zazzaɓin. Sa'an nan, yi gwajin RDT don sanin ko zazzaɓin zazzaɓi ne na cizon sauro. In gwajin ya nuna eh, ba yaron magani na ACT bisa nauyin sa. In yaron bai iya sha ba, yana girgiza, ko bai da ƙarfi — kai shi asibiti nan take. Kar a jira.\n(Translation: First, give paracetamol based on the child's weight to bring the fever down. Then do an RDT to check if it's malaria. If positive, give ACT based on weight. If the child can't drink, is convulsing, or is limp — refer immediately. Don't wait.)",
    followUps: ['Yaya ake ba ACT?', 'Menene alamun hadari?', 'Yaushe zan aika da yaron asibiti?'],
  },
  {
    id: 'newborn-not-breathing',
    keywords: [
      ['newborn', 'neonate', 'baby', 'infant', 'just born', 'at birth', 'after birth'],
      ['not breathing', 'no breathing', 'apnea', 'apnoea', 'asphyxia', 'isn\'t breathing', 'won\'t breathe', 'can\'t breathe', 'gasping'],
    ],
    response:
      "Don't panic — you have a short window and these steps matter. Start the clock in your head. Dry the baby vigorously, stimulate by rubbing the back, and reposition the airway — head slightly extended, not too far back. Call for help at the same time.\nIf after 30 seconds the baby still isn't breathing, start bag-and-mask ventilation — 40 breaths per minute. Watch for chest rise. If the chest isn't rising, recheck your seal and reposition the head.\nIf there's no response after a full minute of good ventilation, that baby needs more than your facility can give. Keep ventilating during transfer. Don't stop.",
    followUps: ['How do I use a bag and mask?', 'What if there is no bag and mask?', 'When do I stop resuscitation?'],
  },
  {
    id: 'tb-screening-symptoms',
    keywords: [
      ['tb', 'tuberculosis', 'tubercolosis'],
      ['screen', 'screening', 'symptoms', 'signs', 'suspect', 'check', 'look for', 'assess'],
      ['cough', 'coughing', 'patient', 'sputum'],
    ],
    response:
      "The one that should always catch your attention is a cough that's been going on for 2 weeks or more — that's your main flag. From there, ask about night sweats, unexplained weight loss, and whether there's ever been blood in the sputum. If you're getting yes answers on two or more of those, don't treat and send home. Refer for sputum microscopy or GeneXpert. Also ask about contact with a known TB patient — that changes your index of suspicion immediately.",
    followUps: ['How do I collect sputum?', 'What is GeneXpert?', 'Can I start treatment at PHC level?'],
  },
  {
    id: 'child-malnutrition-assessment',
    keywords: [
      ['malnutrition', 'malnourished', 'underweight', 'wasting', 'sam', 'mam'],
      ['assess', 'assessment', 'check', 'screen', 'screening', 'evaluate', 'identify', 'detect', 'muac'],
      ['child', 'children', 'kid', 'phc', 'facility', 'pikin'],
    ],
    response:
      "Your quickest tool is the MUAC tape — measure the mid-upper arm circumference on the left arm. Green means you're okay, yellow means moderate acute malnutrition and the child needs close follow-up and ready-to-use supplementary food, red means severe acute malnutrition and that child needs referral and therapeutic feeding now.\nBut don't stop at the tape. Check for bilateral pitting oedema — press both feet for 3 seconds. If the dent stays, that's a red flag regardless of what the MUAC says. Also look at the child's overall appearance — is the child alert, playful, interested? A child with SAM often looks withdrawn and has no appetite at all.",
    followUps: ['What is RUTF?', 'How do I measure MUAC correctly?', 'When should I refer for SAM?'],
  },
];

const CONTEXTUAL_FAQS: ContextualFaq[] = [
  {
    id: 'vomit-after-amoxicillin',
    keywords: [
      ['vomit', 'vomits', 'vomiting', 'throws up', 'throw up', 'puke', 'spit out', 'spit up'],
      ['after', 'taking', 'dose', 'medicine', 'drug', 'medication', 'swallow'],
    ],
    contextRequired: 'amoxicillin-dose-child',
    response:
      "If it happens within 30 minutes of the dose, go ahead and repeat it — the medication likely didn't absorb. But if the child keeps vomiting and can't keep anything down, don't push oral medicine. Switch to injectable and if you don't have that available at your facility, refer. A child that can't hold down antibiotics needs more support than oral treatment can give.",
    followUps: ['What injectable can I use?', 'When should I refer?', 'How do I prevent vomiting?'],
  },
];

// Minimum score thresholds (fraction of keyword groups matched)
// Increased from 0.6 to 0.8 to prevent false matches (e.g., "ARV dose" matching amoxicillin FAQ)
const MATCH_THRESHOLD = 0.8;
const CONTEXTUAL_THRESHOLD = 0.5;

let lastMatchedId: string | null = null;

/**
 * Compute edit distance between two strings (Levenshtein).
 * Used for typo tolerance on short tokens.
 */
function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > 2) return Math.max(a.length, b.length);

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Check if a query token fuzzy-matches a keyword.
 * - Exact substring match in the query text (handles multi-word keywords like "not breathing")
 * - Exact token match
 * - Prefix match (query token starts with keyword or vice versa, min 4 chars)
 * - Edit distance <= 1 for tokens 5+ chars, <= 2 for tokens 7+ chars
 */
function tokenMatchesKeyword(queryTokens: string[], queryText: string, keyword: string): boolean {
  // Multi-word keyword: check as substring in full query text
  if (keyword.includes(' ')) {
    return queryText.includes(keyword);
  }

  for (const token of queryTokens) {
    // Exact match
    if (token === keyword) return true;

    // Prefix match (min 4 chars)
    if (token.length >= 4 && keyword.length >= 4) {
      if (token.startsWith(keyword) || keyword.startsWith(token)) return true;
    }

    // Fuzzy match (edit distance)
    if (token.length >= 5 && keyword.length >= 5) {
      const maxDist = token.length >= 7 && keyword.length >= 7 ? 2 : 1;
      if (editDistance(token, keyword) <= maxDist) return true;
    }
  }

  return false;
}

/**
 * Score a query against a FAQ's keyword groups.
 * Returns fraction of keyword groups that have at least one matching keyword.
 */
function scoreFaq(queryTokens: string[], queryText: string, keywords: string[][]): number {
  let hits = 0;
  for (const group of keywords) {
    const groupHit = group.some((keyword) => tokenMatchesKeyword(queryTokens, queryText, keyword));
    if (groupHit) hits++;
  }
  return hits / keywords.length;
}

export function getClinicalFaqResponse(
  query: string
): { response: string; followUps: string[] } | null {
  const queryText = query.toLowerCase().trim();
  const queryTokens = queryText.split(/[\s,;:\-—/]+/).filter((t) => t.length >= 2);

  // Check contextual FAQs first (follow-up questions)
  if (lastMatchedId) {
    let bestContextual: ContextualFaq | null = null;
    let bestContextualScore = 0;
    for (const faq of CONTEXTUAL_FAQS) {
      if (faq.contextRequired !== lastMatchedId) continue;
      const score = scoreFaq(queryTokens, queryText, faq.keywords);
      if (score > bestContextualScore) {
        bestContextualScore = score;
        bestContextual = faq;
      }
    }
    if (bestContextual && bestContextualScore >= CONTEXTUAL_THRESHOLD) {
      lastMatchedId = bestContextual.id;
      return { response: bestContextual.response, followUps: bestContextual.followUps };
    }
  }

  // Score all standard FAQs and pick the best match above threshold
  let bestFaq: ClinicalFaq | null = null;
  let bestScore = 0;
  for (const faq of CLINICAL_FAQS) {
    const score = scoreFaq(queryTokens, queryText, faq.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestFaq = faq;
    }
  }

  if (bestFaq && bestScore >= MATCH_THRESHOLD) {
    // Only match if ALL keyword groups matched (perfect match)
    // This prevents false positives like "ARV dose" matching "amoxicillin dose"
    if (bestScore === 1.0) {
      lastMatchedId = bestFaq.id;
      return { response: bestFaq.response, followUps: bestFaq.followUps };
    }
  }

  return null;
}

export function resetClinicalFaqState(): void {
  lastMatchedId = null;
}
