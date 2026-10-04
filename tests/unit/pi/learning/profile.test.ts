import { describe, expect, it } from 'vitest';
import {
  defaultPiLearningProfile,
  normalizePiLearningProfile,
  piLearningSystemPrompt,
  validatePiLearningProfile,
} from '@/common/pi';

describe('conversation learning profiles', () => {
  it('uses a familiar profile by default and produces distinct response guidance', () => {
    const familiar = defaultPiLearningProfile();
    expect(familiar.level).toBe('familiar');
    expect(piLearningSystemPrompt({ ...familiar, level: 'beginner' })).toContain('small ordered steps');
    expect(piLearningSystemPrompt({ ...familiar, level: 'expert' })).toContain('edge cases');
  });

  it('normalizes persisted profiles without trusting malformed data', () => {
    expect(normalizePiLearningProfile({ level: 'unknown', customDescription: 42 })).toEqual(defaultPiLearningProfile());
  });

  it('requires a description for a custom profile', () => {
    expect(() => validatePiLearningProfile({ level: 'custom', customDescription: '' })).toThrow(
      'learning_description_required'
    );
  });
});
