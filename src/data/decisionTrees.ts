/**
 * Mock decision tree protocols
 */

import type { DecisionTree } from '@/types/hiv';

export const MOCK_TREES: readonly DecisionTree[] = [
  {
    id: 'malaria-assessment',
    name: 'Malaria Assessment',
    artifactId: 'malaria-2024',
    entryNode: 'q1',
    nodes: {
      q1: {
        id: 'q1',
        type: 'branch',
        question: 'Does the child have a fever or history of fever in the last 48 hours?',
        hint: "Ask the caregiver. Feel the child's forehead or use a thermometer.",
        options: [
          { id: 'yes', label: 'Yes — fever present', next: 'q2' },
          { id: 'no', label: 'No — no fever', next: 'action-no-malaria' },
        ],
      },
      q2: {
        id: 'q2',
        type: 'branch',
        question: 'Is the child able to drink or breastfeed?',
        hint: 'Observe the child. Attempted feeding counts if they try.',
        options: [
          { id: 'yes', label: 'Yes — drinking normally', next: 'q3' },
          { id: 'no', label: 'No — cannot drink', next: 'refer-severe' },
        ],
      },
      q3: {
        id: 'q3',
        type: 'branch',
        question: 'Does the child have any danger signs?',
        hint: 'Danger signs: convulsions, lethargy, vomiting everything, unable to sit/stand.',
        options: [
          { id: 'no', label: 'No danger signs', next: 'action-uncomplicated' },
          { id: 'yes', label: 'Yes — danger signs present', next: 'refer-severe' },
        ],
      },
      'action-uncomplicated': {
        id: 'action-uncomplicated',
        type: 'action',
        title: 'Uncomplicated Malaria',
        instruction: 'Give ACT (Artemether/Lumefantrine) as per weight. Counsel caregiver on completion of full course. Follow up in 3 days.',
        linkedDrug: 'act-artemether',
      },
      'refer-severe': {
        id: 'refer-severe',
        type: 'refer',
        urgency: 'immediate',
        title: 'Severe Malaria — Refer Urgently',
        holdingCare: 'Give rectal artesunate if available. Maintain airway. Position child on side if unconscious. IV access if possible. Keep warm.',
        handover: 'Child with features of severe malaria. Unable to drink / danger signs present. Pre-referral artesunate given.',
      },
      'action-no-malaria': {
        id: 'action-no-malaria',
        type: 'action',
        title: 'Malaria Unlikely',
        instruction: 'Perform RDT to confirm. If negative, assess for other causes of fever (pneumonia, meningitis, ear infection).',
      },
    },
  },
] as const;

export const getTreeById = (id: string): DecisionTree | undefined =>
  MOCK_TREES.find((t) => t.id === id);
