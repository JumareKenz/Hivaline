/**
 * Mock clinical artifact data (FMOH guidelines)
 */

import type { Artifact } from '@/types/hiv';

export const MOCK_ARTIFACTS: readonly Artifact[] = [
  {
    id: 'malaria-2024',
    title: 'Malaria Case Management',
    publisher: 'FMOH',
    year: 2024,
    icon: '🦟',
    colorTint: 'bg-accent-50',
    topics: ['Diagnosis & RDT use', 'ACT dosing by weight', 'Severe malaria criteria', 'Post-treatment follow-up'],
    verified: true,
    syncedAt: 'today',
    description: 'Comprehensive guidelines for diagnosing and treating malaria in children and adults, including RDT procedures and ACT dosing.',
  },
  {
    id: 'anc-2024',
    title: 'Antenatal Care (ANC)',
    publisher: 'FMOH/WHO',
    year: 2024,
    icon: '🤱',
    colorTint: 'bg-brand-tan-subtle',
    topics: ['Visit schedule', 'Danger signs in pregnancy', 'Iron & folate dosing', 'Tetanus immunization'],
    verified: true,
    syncedAt: 'today',
    description: 'ANC guidelines for routine visits, danger sign identification, and supplementation schedules.',
  },
  {
    id: 'imci-2023',
    title: 'Child Health (IMCI)',
    publisher: 'FMOH',
    year: 2023,
    icon: '👶',
    colorTint: 'bg-warning/10',
    topics: ['Pneumonia assessment', 'Diarrhoea management', 'Malnutrition screening', 'Immunization catch-up'],
    verified: true,
    syncedAt: 'today',
    description: 'Integrated Management of Childhood Illness protocols for frontline assessment and referral.',
  },
  {
    id: 'essential-meds-2024',
    title: 'Essential Medicines',
    publisher: 'FMOH',
    year: 2024,
    icon: '💊',
    colorTint: 'bg-info/10',
    topics: ['Drug dosing by weight', 'Drug interactions', 'Storage conditions', 'Expired medication protocol'],
    verified: true,
    syncedAt: 'today',
    description: 'Reference for essential drug dosing, interaction checks, and safe storage practices.',
  },
  {
    id: 'emergency-referral-2024',
    title: 'Emergency Referral',
    publisher: 'FMOH',
    year: 2024,
    icon: '🏥',
    colorTint: 'bg-error/10',
    topics: ['Referral criteria', 'Pre-referral stabilization', 'Handover communication', 'Transport arrangement'],
    verified: true,
    syncedAt: 'today',
    description: 'When and how to refer patients urgently, including stabilization steps and handover notes.',
  },
] as const;

export const getArtifactById = (id: string): Artifact | undefined =>
  MOCK_ARTIFACTS.find((a) => a.id === id);
