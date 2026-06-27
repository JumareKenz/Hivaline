import { describe, it, expect } from 'vitest';
import { isNarrativeQuery, extractClinicalTerms, normalizeForBm25 } from '@/engine/narrativeNormalizer';

describe('isNarrativeQuery', () => {
  it('detects long narrative queries', () => {
    expect(isNarrativeQuery('the baby has been breathing fast since morning and refuses to feed')).toBe(true);
    expect(isNarrativeQuery('my patient is a 2 year old who has had watery stool for three days now')).toBe(true);
    expect(isNarrativeQuery('the mother came in this morning with heavy bleeding after she delivered yesterday')).toBe(true);
  });

  it('rejects short keyword queries', () => {
    expect(isNarrativeQuery('malaria treatment')).toBe(false);
    expect(isNarrativeQuery('ARV dose for child')).toBe(false);
    expect(isNarrativeQuery('what is ANC?')).toBe(false);
    expect(isNarrativeQuery('newborn danger signs')).toBe(false);
  });

  it('rejects medium queries that are already focused', () => {
    expect(isNarrativeQuery('what is the dose of amoxicillin for pneumonia')).toBe(false);
  });
});

describe('extractClinicalTerms', () => {
  it('extracts respiratory symptoms from narrative', () => {
    const result = extractClinicalTerms('the baby has been breathing fast since morning');
    expect(result).toContain('fast breathing');
    expect(result).toContain('tachypnea');
  });

  it('extracts feeding problems', () => {
    const result = extractClinicalTerms('the baby refuses to feed and is very weak');
    expect(result).toContain('poor feeding');
  });

  it('extracts combined symptoms', () => {
    const result = extractClinicalTerms('the baby has been breathing fast since morning and refuses to feed, what should I do');
    expect(result).toContain('fast breathing');
    expect(result).toContain('poor feeding');
    expect(result).toContain('management');
  });

  it('extracts dehydration signs', () => {
    const result = extractClinicalTerms('the child has sunken eyes and dry mouth with no tears');
    expect(result).toContain('dehydration');
    expect(result).toContain('sunken eyes');
  });

  it('extracts obstetric emergencies', () => {
    const result = extractClinicalTerms('the woman is bleeding heavily after delivery and the placenta has not come out');
    expect(result).toContain('hemorrhage');
    expect(result).toContain('postpartum hemorrhage');
  });

  it('extracts convulsion/seizure', () => {
    const result = extractClinicalTerms('the child started shaking and jerking and then became unconscious');
    expect(result).toContain('convulsion');
    expect(result).toContain('seizure');
  });

  it('extracts jaundice', () => {
    const result = extractClinicalTerms('the baby has yellow skin and yellow eyes since yesterday');
    expect(result).toContain('jaundice');
  });

  it('extracts fever description', () => {
    const result = extractClinicalTerms('the child body is very hot to touch and has been like this for two days');
    expect(result).toContain('fever');
  });

  it('preserves individual clinical tokens not covered by patterns', () => {
    const result = extractClinicalTerms('my patient has malaria and pneumonia together');
    expect(result).toContain('malaria');
    expect(result).toContain('pneumonia');
  });
});

describe('normalizeForBm25', () => {
  it('normalizes narrative queries into clinical terms', () => {
    const result = normalizeForBm25('the baby has been breathing fast since morning and refuses to feed');
    expect(result).toContain('fast breathing');
    expect(result).toContain('poor feeding');
    expect(result).not.toContain('since morning');
  });

  it('passes through keyword queries unchanged', () => {
    const query = 'malaria dose child 15kg';
    expect(normalizeForBm25(query)).toBe(query);
  });

  it('passes through short queries unchanged', () => {
    const query = 'ARV dosage';
    expect(normalizeForBm25(query)).toBe(query);
  });

  it('handles mixed narrative with clinical terms', () => {
    const result = normalizeForBm25('my patient is a child who has had watery stool and vomiting for three days now and is not drinking');
    expect(result).toContain('diarrhea');
    expect(result).toContain('vomiting');
  });
});
