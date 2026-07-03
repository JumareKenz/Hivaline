/**
 * queryTranslator.test.ts — Unit tests for query translation layer
 */

import { describe, it, expect } from 'vitest';
import { detectLanguage } from '@/services/queryTranslator';

describe('QueryTranslator', () => {
  describe('detectLanguage', () => {
    it('should detect English queries', () => {
      expect(detectLanguage('How to start HIV treatment')).toBe('en');
      expect(detectLanguage('Signs of malaria')).toBe('en');
      expect(detectLanguage('Newborn danger signs')).toBe('en');
      expect(detectLanguage('What is PMTCT?')).toBe('en');
    });

    it('should detect Hausa queries', () => {
      expect(detectLanguage('Yaya ake fara maganin HIV')).toBe('ha');
      expect(detectLanguage('Alamun ciwon zazzabin cizon sauro')).toBe('ha');
      expect(detectLanguage('Adadin maganin HIV na yara')).toBe('ha');
      expect(detectLanguage('Alamomin cututtukan jiki mai hatsari ga jariri')).toBe('ha');
    });

    it('should detect Yoruba queries', () => {
      expect(detectLanguage('Bawo ni a ṣe le bẹrẹ itọju HIV')).toBe('yo');
      expect(detectLanguage('Ami aisan iba')).toBe('yo');
      expect(detectLanguage('Iwọn oogun HIV fun ọmọde')).toBe('yo');
      expect(detectLanguage('Ami ewu fun ọmọ tuntun')).toBe('yo');
    });

    it('should detect Igbo queries', () => {
      expect(detectLanguage('Kedu ka esi amalite ọgwụgwọ HIV')).toBe('ig');
      expect(detectLanguage('Ihe ngosi nke ọrịa ịba')).toBe('ig');
      expect(detectLanguage('Usoro ọgwụ HIV maka ụmụaka')).toBe('ig');
    });

    it('should detect Pidgin queries', () => {
      expect(detectLanguage('wetin be the sign say pikin dey sick well well')).toBe('pid');
      // Note: "how person fit take treat malaria" is ambiguous (could be broken English)
      // Only detect as Pidgin when clear markers present
      expect(detectLanguage('wetin dey happen for pikin body')).toBe('pid');
    });

    it('should default to English for ambiguous queries', () => {
      expect(detectLanguage('HIV')).toBe('en'); // single word, no markers
      expect(detectLanguage('treatment options')).toBe('en');
      expect(detectLanguage('what is ART')).toBe('en'); // lowercase, no strong markers
    });

    it('should require minimum 2 markers for non-English detection', () => {
      // "yaya" alone (1 marker) shouldn't trigger Hausa
      expect(detectLanguage('yaya treatment')).toBe('en');

      // But "yaya ake" (2 markers) should
      expect(detectLanguage('yaya ake HIV')).toBe('ha');
    });
  });
});
