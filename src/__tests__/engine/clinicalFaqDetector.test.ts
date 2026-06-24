import { describe, it, expect, beforeEach } from 'vitest';
import { getClinicalFaqResponse, resetClinicalFaqState } from '@/engine/clinicalFaqDetector';

beforeEach(() => {
  resetClinicalFaqState();
});

describe('clinicalFaqDetector - fuzzy matching', () => {
  describe('exact phrasings', () => {
    it('matches amoxicillin dose question', () => {
      const r = getClinicalFaqResponse('What is the dose of amoxicillin for a 14kg child?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('250mg of amoxicillin three times a day');
    });

    it('matches cholera management', () => {
      const r = getClinicalFaqResponse('How do I manage a suspected cholera case in a rural facility?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('start ORS straight away');
    });

    it('matches PPH signs', () => {
      const r = getClinicalFaqResponse('What are the warning signs of postpartum hemorrhage?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('more than 500ml');
    });

    it('matches pidgin malaria question', () => {
      const r = getClinicalFaqResponse('Wetin be malaria sign for pikin?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('Oga, watch out');
    });

    it('matches IMCI fever protocol', () => {
      const r = getClinicalFaqResponse('Walk me through the IMCI steps for a child with fever.');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('check for danger signs');
    });

    it('matches Hausa fever question', () => {
      const r = getClinicalFaqResponse('Yaya ake magance zazzaɓi a cikin yaro?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('paracetamol bisa nauyin yaron');
    });

    it('matches newborn not breathing', () => {
      const r = getClinicalFaqResponse('What do I do if a newborn is not breathing at birth?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('Dry the baby vigorously');
    });

    it('matches TB screening', () => {
      const r = getClinicalFaqResponse('What symptoms of TB should I screen for in a coughing patient?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('cough that');
    });

    it('matches malnutrition assessment', () => {
      const r = getClinicalFaqResponse('How do I assess a child for malnutrition at the PHC level?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('MUAC tape');
    });
  });

  describe('rephrased / fuzzy queries', () => {
    it('matches amoxicillin with typo', () => {
      const r = getClinicalFaqResponse('amoxicilin dose for child');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('amoxicillin');
    });

    it('matches amoxicillin rephrased', () => {
      const r = getClinicalFaqResponse('How much amoxicillin should I give a child weighing 14kg?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('amoxicillin');
    });

    it('matches cholera rephrased', () => {
      const r = getClinicalFaqResponse('cholera treatment in my clinic');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('ORS');
    });

    it('matches PPH with abbreviation', () => {
      const r = getClinicalFaqResponse('PPH signs and symptoms');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('500ml');
    });

    it('matches PPH alternate phrasing', () => {
      const r = getClinicalFaqResponse('bleeding after delivery warning signs');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('500ml');
    });

    it('matches IMCI rephrased', () => {
      const r = getClinicalFaqResponse('IMCI protocol for febrile child');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('danger signs');
    });

    it('matches newborn rephrased', () => {
      const r = getClinicalFaqResponse('baby born not breathing what to do');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('Dry the baby');
    });

    it('matches newborn with synonym', () => {
      const r = getClinicalFaqResponse('infant asphyxia after birth');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('Dry the baby');
    });

    it('matches TB rephrased', () => {
      const r = getClinicalFaqResponse('tuberculosis screening signs');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('cough');
    });

    it('matches malnutrition with MUAC keyword', () => {
      const r = getClinicalFaqResponse('MUAC assessment for malnourished child');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('MUAC tape');
    });
  });

  describe('should NOT match (too vague)', () => {
    it('does not match generic greeting', () => {
      expect(getClinicalFaqResponse('hello')).toBeNull();
    });

    it('does not match vague malaria', () => {
      expect(getClinicalFaqResponse('what is malaria')).toBeNull();
    });

    it('does not match social', () => {
      expect(getClinicalFaqResponse('how are you')).toBeNull();
    });
  });

  describe('contextual follow-up (Q2)', () => {
    it('matches follow-up after amoxicillin question', () => {
      getClinicalFaqResponse('What is the dose of amoxicillin for a 14kg child?');
      const r = getClinicalFaqResponse('What if the child vomits after taking it?');
      expect(r).not.toBeNull();
      expect(r!.response).toContain('within 30 minutes');
    });

    it('does NOT match follow-up without prior context', () => {
      const r = getClinicalFaqResponse('child vomits after taking medicine');
      expect(r).toBeNull();
    });
  });
});
