import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const CODESIGN = '/usr/bin/codesign';
const SECURITY = '/usr/bin/security';
const IDENTITY_LINE = /^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"\s*$/;

/**
 * Parse the valid code-signing identities printed by `security find-identity`.
 * The SHA-1 fingerprint is used as the selected identity so duplicate
 * certificates with the same display name remain distinguishable.
 */
export function parseSigningIdentities(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(IDENTITY_LINE))
    .filter((match) => match !== null)
    .map(([, fingerprint, name]) => ({ fingerprint, name }));
}

function stableIdentityCandidates(identities) {
  return identities
    .filter(({ name }) => name.startsWith('Developer ID Application: ') || name.startsWith('Apple Development: '))
    .sort((left, right) => {
      const leftRank = left.name.startsWith('Developer ID Application: ') ? 0 : 1;
      const rightRank = right.name.startsWith('Developer ID Application: ') ? 0 : 1;
      return (
        leftRank - rightRank || left.name.localeCompare(right.name) || left.fingerprint.localeCompare(right.fingerprint)
      );
    });
}

/**
 * Resolve a non-ad-hoc identity. An explicit fingerprint/name wins; otherwise
 * choose a valid Developer ID Application identity, then Apple Development.
 */
export function chooseSigningIdentity({ env = process.env, identities }) {
  const explicit = env.AIONPI_CODESIGN_IDENTITY?.trim() || env.CSC_NAME?.trim();
  if (explicit) {
    if (explicit === '-') throw new Error('AionPi macOS packaging refuses ad-hoc signing (identity "-").');
    return explicit;
  }

  const candidates = stableIdentityCandidates(identities);
  if (candidates.length === 0) {
    throw new Error(
      'No stable macOS signing identity found. Set AIONPI_CODESIGN_IDENTITY to a Developer ID Application or Apple Development identity; refusing ad-hoc signing.'
    );
  }
  return candidates[0].fingerprint;
}

function findSigningIdentities() {
  const result = spawnSync(SECURITY, ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`security find-identity failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return parseSigningIdentities(`${result.stdout}${result.stderr}`);
}

function codesignDetails(appPath) {
  const result = spawnSync(CODESIGN, ['-dvv', '-r-', appPath], { encoding: 'utf8' });
  if (result.error) throw result.error;
  const details = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) throw new Error(`Could not inspect the signed app: ${details.trim()}`);
  return details;
}

export function signMacOSApp(appPath, { env = process.env } = {}) {
  const identities = findSigningIdentities();
  const identity = chooseSigningIdentity({ env, identities });
  const selected = identities.find(({ fingerprint, name }) => fingerprint === identity || name === identity);

  console.log(
    `Signing ${appPath} with ${selected ? `${selected.name} (${selected.fingerprint})` : identity}; ad-hoc signing is disabled.`
  );
  execFileSync(CODESIGN, ['--force', '--deep', '--sign', identity, appPath], { stdio: 'inherit' });
  execFileSync(CODESIGN, ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

  const details = codesignDetails(appPath);
  if (/^Signature=adhoc$/m.test(details) || /^TeamIdentifier=not set$/m.test(details)) {
    throw new Error('The signed app is still ad-hoc signed; refusing to produce an unstable package.');
  }
  const designated = details.match(/^designated => (.+)$/m)?.[1] || 'unavailable';
  console.log(`Stable macOS signature verified. Designated requirement: ${designated}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const appPath = process.argv[2];
  if (!appPath) {
    console.error('Usage: node scripts/aionpi/sign-macos.mjs <TheOne.app>');
    process.exitCode = 2;
  } else {
    try {
      signMacOSApp(appPath);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
