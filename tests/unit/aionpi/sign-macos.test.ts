import { describe, expect, it } from 'vitest';
import { chooseSigningIdentity, parseSigningIdentities } from '../../../scripts/aionpi/sign-macos.mjs';

const identities = parseSigningIdentities(`
  1) 64E3FDE42DAC101991EF332B7BF4C8DEB34017A5 "Apple Development: Ning Zhao (DBU95WNFXA)"
  2) 5E3E399DF3ED59E369757755E90CD0CC71A52861 "Apple Distribution: Ning Zhao (87TM98S5XS)"
  3) ABC4EB6A75A2660C9D644999FAFAE9BB3771CEA6 "Apple Development: Ning Zhao (DBU95WNFXA)"
  4) 1234567890ABCDEF1234567890ABCDEF12345678 "Developer ID Application: Example (TEAM123456)"
  1 valid identities found
`);

describe('AionPi macOS signing identity selection', () => {
  it('parses valid identities and ignores summary lines', () => {
    expect(identities).toHaveLength(4);
    expect(identities[0]).toEqual({
      fingerprint: '64E3FDE42DAC101991EF332B7BF4C8DEB34017A5',
      name: 'Apple Development: Ning Zhao (DBU95WNFXA)',
    });
  });

  it('prefers an explicit identity and rejects ad-hoc signing', () => {
    expect(chooseSigningIdentity({ identities, env: { AIONPI_CODESIGN_IDENTITY: 'ABC4' } })).toBe('ABC4');
    expect(() => chooseSigningIdentity({ identities, env: { AIONPI_CODESIGN_IDENTITY: '-' } })).toThrow(
      'refuses ad-hoc signing'
    );
  });

  it('prefers Developer ID and deterministically selects duplicate development certificates', () => {
    expect(chooseSigningIdentity({ identities, env: {} })).toBe('1234567890ABCDEF1234567890ABCDEF12345678');
    expect(
      chooseSigningIdentity({
        identities: identities.filter(({ name }) => name.startsWith('Apple Development')),
        env: {},
      })
    ).toBe('64E3FDE42DAC101991EF332B7BF4C8DEB34017A5');
  });

  it('fails closed when no stable identity is available', () => {
    expect(() => chooseSigningIdentity({ identities: [], env: {} })).toThrow('No stable macOS signing identity found');
  });
});
