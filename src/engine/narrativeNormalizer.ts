/**
 * narrativeNormalizer.ts — Extract clinical signal from narrative queries
 *
 * Health workers often describe patient situations in natural language:
 *   "the baby has been breathing fast since morning and refuses to feed"
 *
 * BM25 needs focused clinical terms, not narrative prose. This module:
 *   1. Detects whether a query is narrative (vs. already keyword-style)
 *   2. Extracts clinical n-grams and symptom patterns
 *   3. Maps colloquial descriptions to indexed clinical vocabulary
 *   4. Returns a BM25-optimized version alongside the original for vector search
 */

const NARRATIVE_FILLER = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
  'been', 'being', 'be', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'must',
  'i', 'me', 'my', 'we', 'our', 'us', 'you', 'your', 'he', 'she',
  'it', 'its', 'they', 'them', 'their',
  'this', 'that', 'these', 'those', 'there', 'here',
  'and', 'or', 'but', 'so', 'if', 'then', 'than', 'as', 'at',
  'by', 'for', 'from', 'in', 'into', 'of', 'on', 'to', 'up', 'with',
  'not', 'no', 'nor', 'very', 'just', 'also', 'too', 'only',
  'what', 'when', 'where', 'how', 'why', 'who', 'which',
  'since', 'until', 'after', 'before', 'during', 'while', 'about',
  'now', 'still', 'already', 'yet', 'again', 'ever', 'never',
  'morning', 'afternoon', 'evening', 'night', 'today', 'yesterday',
  'hours', 'hour', 'days', 'day', 'weeks', 'week', 'ago',
  'think', 'know', 'see', 'look', 'seem', 'want', 'need',
  'going', 'getting', 'doing', 'having', 'saying', 'looking',
  'please', 'help', 'tell', 'give', 'take', 'make', 'let',
  'some', 'any', 'many', 'much', 'few', 'more', 'most', 'all',
  'other', 'another', 'each', 'every', 'both',
]);

/**
 * Colloquial symptom descriptions → indexed clinical terms.
 * Maps natural-language patterns to the vocabulary used in .hiv chunks.
 */
const SYMPTOM_NORMALIZATIONS: Array<{ pattern: RegExp; terms: string[] }> = [
  // Respiratory
  { pattern: /breath(?:ing|e?s?)?\s*(?:fast|rapid|quick|difficult|hard|heavy)/i, terms: ['fast breathing', 'tachypnea', 'respiratory distress'] },
  { pattern: /(?:fast|rapid|quick|difficult|hard|heavy)\s*breath/i, terms: ['fast breathing', 'tachypnea', 'respiratory distress'] },
  { pattern: /chest\s*(?:indrawing|in-drawing|retraction|pulling)/i, terms: ['chest indrawing', 'respiratory distress'] },
  { pattern: /(?:can'?t|cannot|unable|difficulty|trouble|problem)\s*breath/i, terms: ['difficulty breathing', 'respiratory distress', 'dyspnea'] },
  { pattern: /(?:cough|coughing)\s*(?:blood|bloody)/i, terms: ['hemoptysis', 'coughing blood'] },
  { pattern: /(?:noisy|grunting|stridor|wheez)/i, terms: ['stridor', 'wheezing', 'grunting'] },

  // Feeding
  { pattern: /(?:refus\w*|not|won'?t|can'?t|unable|stop(?:ped)?|poor(?:ly)?)\s*(?:to\s+)?(?:feed|eat|suck|breastfeed|nurse|drink)/i, terms: ['poor feeding', 'feeding difficulty', 'refusal to feed'] },
  { pattern: /(?:feed|eat|suck|breastfeed|nurse|drink)(?:ing|s)?\s*(?:poor(?:ly)?|bad(?:ly)?|less|little|difficulty|problem|refus)/i, terms: ['poor feeding', 'feeding difficulty'] },
  { pattern: /not\s+(?:able\s+to\s+)?(?:swallow|take)/i, terms: ['difficulty swallowing', 'dysphagia'] },

  // Fever/temperature
  { pattern: /(?:body|skin)?\s*(?:hot|warm|burning)\s*(?:to\s*touch|body|skin)?/i, terms: ['fever', 'high temperature', 'hyperthermia'] },
  { pattern: /(?:high|raised|elevated)\s*(?:temperature|temp)/i, terms: ['fever', 'high temperature'] },
  { pattern: /(?:cold|cool)\s*(?:to\s*touch|body|skin|extremities)/i, terms: ['hypothermia', 'cold extremities'] },

  // GI
  { pattern: /(?:watery|loose|runny|frequent)\s*(?:stool|poo|motion)/i, terms: ['diarrhea', 'watery stool'] },
  { pattern: /(?:stool|poo|motion)s?\s*(?:with\s*)?(?:blood|bloody|mucus)/i, terms: ['bloody stool', 'dysentery'] },
  { pattern: /(?:throwing|throw)\s*up|vomit(?:ing|s)?/i, terms: ['vomiting'] },
  { pattern: /(?:can'?t|cannot|unable)\s*(?:keep|hold)\s*(?:food|milk|anything)\s*down/i, terms: ['vomiting', 'persistent vomiting'] },
  { pattern: /tummy\s*(?:pain|ache|swell|bloat|big)/i, terms: ['abdominal pain', 'abdominal distension'] },
  { pattern: /(?:belly|stomach|abdomen)\s*(?:pain|swell|bloat|big|hard)/i, terms: ['abdominal pain', 'abdominal distension'] },

  // Neurological
  { pattern: /(?:shaking|shak(?:es|ing)|jerking|jerk(?:s|ing)|fitting|fit(?:s)?|seizure|convuls)/i, terms: ['convulsion', 'seizure'] },
  { pattern: /(?:not\s*(?:moving|responding|conscious)|unconscious|floppy|limp|lethargi)/i, terms: ['lethargy', 'unconscious', 'reduced consciousness'] },
  { pattern: /(?:bulging|tense|swollen)\s*fontanel/i, terms: ['bulging fontanelle', 'raised intracranial pressure'] },

  // Skin/appearance
  { pattern: /(?:yellow|jaundic)\s*(?:skin|eyes|body|baby|color)/i, terms: ['jaundice', 'neonatal jaundice'] },
  { pattern: /(?:skin|eyes|body)\s*(?:yellow|jaundic)/i, terms: ['jaundice', 'neonatal jaundice'] },
  { pattern: /(?:pale|pallor|white|washed)/i, terms: ['pallor', 'anaemia'] },
  { pattern: /(?:rash|spots|blisters|sores|skin\s*lesion)/i, terms: ['rash', 'skin lesion'] },
  { pattern: /(?:swollen|puffy|oedema|edema|swelling)\s*(?:feet|legs|face|body|hands)?/i, terms: ['oedema', 'swelling'] },

  // Dehydration
  { pattern: /(?:sunken|dry)\s*(?:eyes|fontanel|mouth|skin)/i, terms: ['dehydration', 'sunken eyes', 'sunken fontanelle'] },
  { pattern: /(?:no|less|reduced|few)\s*(?:tears|urine|pee|wet\s*nappies)/i, terms: ['dehydration', 'reduced urine output'] },
  { pattern: /skin\s*(?:pinch|tent|turgor)/i, terms: ['dehydration', 'skin pinch'] },

  // Bleeding/obstetric
  { pattern: /(?:heav(?:y|ily)|a\s*lot\s*of|excessive(?:ly)?|too\s*much)\s*(?:bleed|blood)/i, terms: ['hemorrhage', 'excessive bleeding', 'postpartum hemorrhage'] },
  { pattern: /bleed(?:ing|s)?\s+heav(?:y|ily)/i, terms: ['hemorrhage', 'excessive bleeding', 'postpartum hemorrhage'] },
  { pattern: /bleed(?:ing|s)?\s*(?:heav(?:y|ily)\s*)?(?:after|post|following)\s*(?:delivery|birth|labour)/i, terms: ['postpartum hemorrhage', 'PPH'] },
  { pattern: /(?:water|waters?)\s*(?:broke|break|broken|leaking|gush)/i, terms: ['rupture of membranes', 'premature rupture'] },
  { pattern: /(?:baby|head)\s*(?:not\s*(?:coming|descending)|stuck)/i, terms: ['obstructed labour', 'prolonged labour'] },

  // Danger signs
  { pattern: /(?:not\s*(?:cry|crying)|weak\s*cry|no\s*cry)/i, terms: ['weak cry', 'neonatal danger sign'] },
  { pattern: /cord\s*(?:bleed|red|smell|pus|discharge)/i, terms: ['cord infection', 'omphalitis'] },
  { pattern: /(?:high|very)\s*(?:blood\s*)?pressure/i, terms: ['hypertension', 'pre-eclampsia'] },

  // Malnutrition
  { pattern: /(?:thin|wasted|marasmus|kwashiorkor|malnourish|underweight|not\s*gaining)/i, terms: ['malnutrition', 'wasting', 'underweight'] },
  { pattern: /(?:swollen|big)\s*(?:belly|tummy|abdomen)\s*(?:with\s*)?(?:thin|skinny)/i, terms: ['kwashiorkor', 'malnutrition'] },
];

/**
 * Clinical action/intent phrases that should be preserved.
 */
const CLINICAL_ACTION_PATTERNS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /what\s*(?:should|do|can)\s*(?:i|we)\s*do/i, terms: ['management', 'treatment'] },
  { pattern: /how\s*(?:to|do\s*(?:i|we))\s*(?:treat|manage|handle)/i, terms: ['management', 'treatment'] },
  { pattern: /(?:when|should)\s*(?:i|we)\s*refer/i, terms: ['referral', 'when to refer'] },
  { pattern: /(?:what|which)\s*(?:drug|medicine|medication|dose)/i, terms: ['dosage', 'drug'] },
  { pattern: /(?:how\s*(?:much|many)|what)\s*(?:dose|dosage)/i, terms: ['dosage'] },
  { pattern: /(?:danger|warning|alarm)\s*sign/i, terms: ['danger signs'] },
  { pattern: /(?:first\s*aid|immediate|emergency|urgent)/i, terms: ['emergency', 'immediate management'] },
];

/**
 * Detect whether a query is narrative-style (needs normalization) vs.
 * already concise keyword-style (pass through unchanged).
 *
 * Heuristic: narrative queries tend to be longer, contain temporal/relational
 * words, and have a low ratio of clinical terms to total words.
 * Queries that are mostly clinical terms (e.g. "what is the dose of amoxicillin
 * for pneumonia") pass through even if they contain some filler.
 */
export function isNarrativeQuery(query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
  if (tokens.length <= 5) return false;

  const fillerCount = tokens.filter(t => NARRATIVE_FILLER.has(t)).length;
  const fillerRatio = fillerCount / tokens.length;

  // If query has high clinical density, it's already focused
  const clinicalCount = tokens.filter(t => CLINICAL_VOCABULARY.has(t)).length;
  const clinicalRatio = clinicalCount / tokens.length;
  if (clinicalRatio >= 0.3) return false;

  return fillerRatio > 0.4 && tokens.length >= 7;
}

/**
 * Extract clinical terms from a narrative query.
 * Returns the focused clinical terms suitable for BM25 search.
 */
export function extractClinicalTerms(query: string): string {
  const lower = query.toLowerCase();
  const extracted: string[] = [];
  const seen = new Set<string>();

  // Phase 1: Extract multi-word symptom patterns
  for (const { pattern, terms } of SYMPTOM_NORMALIZATIONS) {
    if (pattern.test(lower)) {
      for (const term of terms) {
        if (!seen.has(term)) {
          seen.add(term);
          extracted.push(term);
        }
      }
    }
  }

  // Phase 2: Extract clinical action/intent
  for (const { pattern, terms } of CLINICAL_ACTION_PATTERNS) {
    if (pattern.test(lower)) {
      for (const term of terms) {
        if (!seen.has(term)) {
          seen.add(term);
          extracted.push(term);
        }
      }
    }
  }

  // Phase 3: Keep individual clinical tokens not already covered
  const tokens = lower.split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 3);
  for (const token of tokens) {
    if (NARRATIVE_FILLER.has(token)) continue;
    if (seen.has(token)) continue;
    if (CLINICAL_VOCABULARY.has(token)) {
      seen.add(token);
      extracted.push(token);
    }
  }

  return extracted.join(' ');
}

/**
 * Normalize a narrative query for BM25 search.
 * If the query is already keyword-style, returns it unchanged.
 * If narrative, extracts clinical terms and returns a focused BM25 query.
 */
export function normalizeForBm25(query: string): string {
  if (!isNarrativeQuery(query)) return query;

  const clinical = extractClinicalTerms(query);
  if (clinical.length === 0) return query;

  return clinical;
}

const CLINICAL_VOCABULARY = new Set([
  // Symptoms
  'fever', 'cough', 'diarrhea', 'diarrhoea', 'vomiting', 'bleeding',
  'pain', 'headache', 'rash', 'swelling', 'discharge', 'itching',
  'weakness', 'fatigue', 'weight', 'loss', 'gain',
  'nausea', 'constipation', 'bloating',

  // Body parts / systems
  'chest', 'abdomen', 'head', 'eyes', 'ears', 'throat', 'skin',
  'lungs', 'heart', 'liver', 'kidney', 'uterus', 'cervix',
  'breast', 'nipple', 'cord', 'fontanelle', 'fontanel',

  // Clinical terms
  'breathing', 'feeding', 'breastfeeding', 'sucking', 'crying',
  'urinating', 'defecating', 'sleeping', 'conscious', 'unconscious',
  'jaundice', 'pallor', 'cyanosis', 'oedema', 'edema',
  'dehydration', 'malnutrition', 'wasting', 'stunting',
  'convulsion', 'seizure', 'lethargy', 'irritability',
  'tachypnea', 'dyspnea', 'stridor', 'wheezing', 'grunting',
  'hypothermia', 'hyperthermia', 'hypoglycemia',

  // Conditions
  'malaria', 'pneumonia', 'sepsis', 'meningitis', 'tuberculosis',
  'hiv', 'aids', 'anemia', 'anaemia', 'diabetes', 'hypertension',
  'eclampsia', 'preeclampsia', 'hemorrhage', 'haemorrhage',
  'asphyxia', 'prematurity', 'infection', 'abscess',
  'measles', 'cholera', 'typhoid', 'dysentery',

  // Procedures / actions
  'delivery', 'labour', 'labor', 'birth', 'cesarean', 'episiotomy',
  'suturing', 'resuscitation', 'intubation', 'cannulation',
  'transfusion', 'infusion', 'injection', 'vaccination',
  'immunization', 'screening', 'counseling', 'referral',

  // Medications / substances
  'antibiotic', 'antimalarial', 'antiretroviral', 'antihypertensive',
  'paracetamol', 'amoxicillin', 'gentamicin', 'ampicillin',
  'metronidazole', 'oxytocin', 'misoprostol', 'magnesium',
  'iron', 'folate', 'zinc', 'vitamin', 'ors',
  'cotrimoxazole', 'isoniazid', 'dolutegravir', 'efavirenz',
  'artemether', 'lumefantrine', 'quinine',

  // Patient descriptors
  'baby', 'infant', 'newborn', 'neonate', 'child', 'toddler',
  'mother', 'pregnant', 'woman', 'patient',
  'preterm', 'premature', 'underweight', 'overweight',

  // Severity / modifiers
  'severe', 'mild', 'moderate', 'acute', 'chronic',
  'persistent', 'recurrent', 'sudden', 'progressive',
  'bilateral', 'unilateral', 'generalized', 'localized',

  // Dosage / measurement
  'dose', 'dosage', 'tablet', 'capsule', 'syrup', 'suspension',
  'milligram', 'kilogram', 'milliliter',

  // Prevention / care
  'prevention', 'prophylaxis', 'contraception', 'family',
  'planning', 'antenatal', 'postnatal', 'neonatal',
  'nutrition', 'hygiene', 'sanitation', 'breastmilk',
]);
