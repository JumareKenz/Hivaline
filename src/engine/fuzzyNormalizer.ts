/**
 * fuzzyNormalizer.ts — Deterministic typo correction + local language normalization
 *
 * Provides:
 * 1. Edit-distance-1 correction for top clinical terms (L1 fix)
 * 2. Pidgin/local synonym expansion (L2 fix)
 * 3. Clinical term presence detection (M3 fix)
 *
 * All operations are dictionary-based and deterministic — no probabilistic AI.
 */

/**
 * Canonical clinical terms for fuzzy correction.
 * Key: correct spelling. Used to generate edit-distance-1 candidates.
 */
const CLINICAL_CORRECTIONS: Record<string, string> = {
  // Common misspellings → correct form
  'malarya': 'malaria',
  'maleria': 'malaria',
  'malarea': 'malaria',
  'pnemonia': 'pneumonia',
  'pneumona': 'pneumonia',
  'pnuemonia': 'pneumonia',
  'numonia': 'pneumonia',
  'newmonia': 'pneumonia',
  'diaroea': 'diarrhea',
  'diarhoea': 'diarrhea',
  'diarrhoea': 'diarrhea',
  'diarhea': 'diarrhea',
  'diarrea': 'diarrhea',
  'diareah': 'diarrhea',
  'amoxcilin': 'amoxicillin',
  'amoxicilin': 'amoxicillin',
  'amoxcillin': 'amoxicillin',
  'amoxycillin': 'amoxicillin',
  'imunization': 'immunization',
  'immunisation': 'immunization',
  'imunisation': 'immunization',
  'vacination': 'vaccination',
  'vacinnation': 'vaccination',
  'tuburculosis': 'tuberculosis',
  'tuberclosis': 'tuberculosis',
  'tuberculosi': 'tuberculosis',
  'diabetis': 'diabetes',
  'diabeties': 'diabetes',
  'hypertenshion': 'hypertension',
  'hipertension': 'hypertension',
  'preeclampsia': 'pre-eclampsia',
  'preeclamsia': 'pre-eclampsia',
  'eclampisa': 'eclampsia',
  'haemorrhage': 'hemorrhage',
  'haemorrage': 'hemorrhage',
  'hemorrage': 'hemorrhage',
  'hemmorhage': 'hemorrhage',
  'convultion': 'convulsion',
  'convulshion': 'convulsion',
  'siezure': 'seizure',
  'seisure': 'seizure',
  'dehydraton': 'dehydration',
  'dehidration': 'dehydration',
  'malnutrision': 'malnutrition',
  'malnutriton': 'malnutrition',
  'cotrimoxazol': 'cotrimoxazole',
  'paracetamol': 'paracetamol',
  'paracitamol': 'paracetamol',
  'paracetemol': 'paracetamol',
  'metronidazol': 'metronidazole',
  'gentamycin': 'gentamicin',
  'oxitocin': 'oxytocin',
  'misoprostl': 'misoprostol',
  'dolutegravr': 'dolutegravir',
  'efaverenz': 'efavirenz',
  'artimether': 'artemether',
  'artesunete': 'artesunate',
  'lumefantrin': 'lumefantrine',
  'isoniazd': 'isoniazid',
  'rifampicn': 'rifampicin',
  'ethambutl': 'ethambutol',
  'pyrazinamid': 'pyrazinamide',
  'anaemia': 'anemia',
  'aneamia': 'anemia',
  'jaundise': 'jaundice',
  'jandice': 'jaundice',
  'ceasarean': 'cesarean',
  'caesarean': 'cesarean',
  'episiotmy': 'episiotomy',
  'resusitation': 'resuscitation',
  'resucitation': 'resuscitation',
  'asphyxea': 'asphyxia',
  'aspyxia': 'asphyxia',
  'treetment': 'treatment',
  'treatmnt': 'treatment',
  'skedule': 'schedule',
  'scedule': 'schedule',
  'regiment': 'regimen',
};

/**
 * Pidgin English / local language → standard clinical English.
 * Covers Nigerian Pidgin, common informal terms, and regional shorthand.
 */
const LOCAL_SYNONYMS: Record<string, string> = {
  // Nigerian Pidgin
  'pikin': 'child',
  'pekin': 'child',
  'pickin': 'child',
  'belle': 'pregnancy',
  'bele': 'pregnancy',
  'feva': 'fever',
  'fiver': 'fever',
  'cof': 'cough',
  'kof': 'cough',
  'kofu': 'cough',
  'stooling': 'diarrhea',
  'purging': 'diarrhea',
  'runbelle': 'diarrhea',
  'run belly': 'diarrhea',
  'bellyache': 'abdominal pain',
  'stomachache': 'abdominal pain',
  'bodyache': 'body pain',
  'headache': 'headache',
  'fittin': 'convulsion',
  'fit': 'convulsion',
  'shaking': 'convulsion',
  'yelloweye': 'jaundice',
  'yellow eye': 'jaundice',
  'swollen': 'oedema',
  'swelling': 'oedema',
  'hotbody': 'fever',
  'hot body': 'fever',
  'weak body': 'fatigue',
  'no get power': 'fatigue',
  'no strength': 'fatigue',
  'rashes': 'rash',
  'sore': 'wound',
  'boil': 'abscess',
  'pile': 'hemorrhoids',
  'sugar': 'diabetes',
  'pressure': 'hypertension',
  'high pressure': 'hypertension',
  'low blood': 'anemia',
  'watery eyes': 'conjunctivitis',
  'running nose': 'rhinorrhea',
  'blocked nose': 'nasal congestion',
  'ear pain': 'ear infection',
  'ear discharge': 'otitis media',
  'mama': 'mother',
  'papa': 'father',
  'woman wey born': 'postpartum woman',
  'born house': 'delivery room',
  'inject': 'injection',
  'drip': 'IV fluids',
  'blood tonic': 'iron supplement',
  'worm medicine': 'deworming',
  'family medicine': 'family planning',
  'prevention': 'contraception',
  'cord': 'umbilical cord',
  'afterbirth': 'placenta',
  'waterbag': 'membranes',
  'navel': 'umbilicus',
};

/**
 * Core clinical vocabulary for presence detection (M3 fix).
 * If a query contains NONE of these, it's likely non-clinical.
 */
const CLINICAL_PRESENCE_TERMS = new Set([
  'fever', 'malaria', 'cough', 'pneumonia', 'diarrhea', 'vomiting',
  'bleeding', 'pain', 'headache', 'rash', 'swelling', 'discharge',
  'breathing', 'chest', 'abdomen', 'pregnant', 'pregnancy', 'delivery',
  'baby', 'child', 'infant', 'newborn', 'mother', 'woman', 'patient',
  'dose', 'dosage', 'treatment', 'drug', 'medicine', 'medication',
  'tablet', 'injection', 'syrup', 'ors',
  'hiv', 'aids', 'art', 'arv', 'tb', 'tuberculosis',
  'immunization', 'vaccination', 'vaccine',
  'refer', 'referral', 'emergency', 'danger', 'severe',
  'convulsion', 'seizure', 'unconscious', 'dehydration',
  'anemia', 'jaundice', 'malnutrition',
  'blood', 'urine', 'stool', 'sputum',
  'breastfeed', 'feeding', 'nutrition',
  'contraception', 'family', 'planning',
  'antenatal', 'postnatal', 'anc', 'pnc',
  'pmtct', 'pph', 'hemorrhage',
  'weight', 'height', 'age', 'kg', 'months',
  // Common pidgin that maps to clinical
  'pikin', 'feva', 'cof', 'stooling', 'belle', 'fittin',
  'hotbody', 'purging', 'pressure', 'sugar',
]);

/**
 * Apply fuzzy correction to a single token.
 * Returns the corrected form or the original if no match.
 */
function correctToken(token: string): string {
  const lower = token.toLowerCase();
  if (CLINICAL_CORRECTIONS[lower]) {
    return CLINICAL_CORRECTIONS[lower];
  }
  return token;
}

/**
 * Expand a local/pidgin token to standard clinical English.
 * Returns expanded form or the original if no match.
 */
function expandLocal(token: string): string {
  const lower = token.toLowerCase();
  if (LOCAL_SYNONYMS[lower]) {
    return LOCAL_SYNONYMS[lower];
  }
  return token;
}

/**
 * Normalize a query: apply typo correction and local language expansion.
 * Returns the normalized query with corrections applied inline.
 */
export function normalizeQuery(query: string): string {
  // First, check multi-word local phrases (must be done before tokenization)
  let normalized = query;
  for (const [phrase, replacement] of Object.entries(LOCAL_SYNONYMS)) {
    if (phrase.includes(' ') && normalized.toLowerCase().includes(phrase)) {
      normalized = normalized.replace(new RegExp(phrase, 'gi'), replacement);
    }
  }

  // Tokenize and correct individual words
  const tokens = normalized.split(/\s+/);
  const corrected = tokens.map(token => {
    const clean = token.replace(/[^\w]/g, '');
    if (clean.length < 3) return token;

    // Try local synonym first, then typo correction
    const localExpanded = expandLocal(clean);
    if (localExpanded !== clean) {
      return localExpanded;
    }
    const typoCorrected = correctToken(clean);
    if (typoCorrected !== clean) {
      return typoCorrected;
    }
    return token;
  });

  return corrected.join(' ');
}

/**
 * Check whether a query has sufficient clinical term presence.
 * Returns true if the query contains at least one recognized clinical term.
 * Used as a secondary out-of-scope defense (M3 fix).
 */
export function hasClinicalPresence(query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/)
    .map(t => t.replace(/[^\w]/g, ''))
    .filter(t => t.length >= 2);

  return tokens.some(t => CLINICAL_PRESENCE_TERMS.has(t));
}
