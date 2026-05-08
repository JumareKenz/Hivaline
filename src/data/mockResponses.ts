/**
 * Mock chat response rules — keyword matcher
 */

import type { ChatMessage, MockResponseRule } from '@/types/hiv';

export const MOCK_RESPONSE_RULES: readonly MockResponseRule[] = [
  {
    keywords: ['act', 'dose', 'artemether', 'lumefantrine', 'malaria', 'tablet', 'kg'],
    response: {
      type: 'drug_table',
      content: 'Based on the FMOH Malaria Guidelines 2024, here is the ACT dosing for this child:',
      metadata: { drugId: 'act-artemether', topic: 'ACT Dose', source: 'FMOH Malaria Guidelines 2024' },
    },
  },
  {
    keywords: ['severe', 'malaria', 'danger', 'sign', 'convulsion', 'unconscious', 'cannot', 'drink'],
    response: {
      type: 'decision_tree',
      content: 'Let me walk you through the malaria assessment protocol to check for severe features.',
      metadata: { treeId: 'malaria-assessment', topic: 'Severe Malaria Assessment', source: 'FMOH Malaria Guidelines 2024' },
    },
  },
  {
    keywords: ['convulsion', 'seizure', 'fitting', 'stiff'],
    response: {
      type: 'danger_sign',
      content: '⚠ CONVULSION IS A DANGER SIGN\n\nImmediate action:\n1. Place child on their side (recovery position)\n2. Do NOT put anything in their mouth\n3. Check airway and breathing\n4. Give rectal diazepam if available and trained\n5. REFER URGENTLY after stabilization\n\nThis child needs immediate referral.',
      metadata: { topic: 'Danger Sign: Convulsion', source: 'FMOH Emergency Referral 2024' },
    },
  },
  {
    keywords: ['anc', 'antenatal', 'pregnancy', 'pregnant', 'first visit'],
    response: {
      type: 'response_card',
      content: 'ANC First Visit Checklist:\n\n• Confirm pregnancy (history + exam)\n• Check BP and weight\n• Test for HIV, HBV, syphilis\n• Give iron & folate (daily)\n• Tetanus toxoid dose 1\n• Counsel on nutrition and danger signs\n• Schedule next visit in 4 weeks\n\nDanger signs to explain:\n→ Vaginal bleeding, severe headache, blurred vision, swollen hands/face, fever, decreased fetal movement',
      metadata: { artifactId: 'anc-2024', topic: 'ANC First Visit', source: 'FMOH/WHO ANC Guidelines 2024' },
    },
  },
  {
    keywords: ['pneumonia', 'cough', 'fast breathing', 'chest'],
    response: {
      type: 'response_card',
      content: 'Pneumonia Assessment (IMCI):\n\nCount breaths in one minute:\n• <2 months: ≥60/min → fast\n• 2-11 months: ≥50/min → fast\n• 12-59 months: ≥40/min → fast\n\nIf fast breathing + cough:\n→ Give amoxicillin for 5 days\n→ Soothe throat, keep warm\n→ Follow up in 2 days\n\nDanger signs (refer urgently):\n→ Chest indrawing, stridor, unable to drink, convulsions, lethargy',
      metadata: { artifactId: 'imci-2023', topic: 'Pneumonia', source: 'FMOH IMCI 2023' },
    },
  },
] as const;

export const FALLBACK_RESPONSE: Omit<ChatMessage, 'id' | 'timestamp' | 'sender'> = {
  type: 'text',
  content: "I don't have information on that in the current .hiv file. The loaded artifacts cover: Malaria, ANC, Child Health, Essential Medicines, and Emergency Referral. Try rephrasing or check the Knowledge Base.",
};
