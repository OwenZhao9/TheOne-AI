import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const piRoot = resolve(process.env.AIONPI_SOURCE || join(root, '../pi'));
const output = join(root, 'resources/aionpi-runtime');
mkdirSync(output, { recursive: true });
const { packReleasePackages, installCodingAgentConsumer } = await import(
  pathToFileURL(join(piRoot, 'scripts/coding-agent-consumer.mjs'))
);
const { getPublicWorkspacePackages } = await import(pathToFileURL(join(piRoot, 'scripts/release-packages.mjs')));
process.chdir(piRoot);
const tarballs = packReleasePackages(getPublicWorkspacePackages(), join(root, '.cache/aionpi-tarballs'));
process.chdir(root);
installCodingAgentConsumer(join(output, 'pi'), tarballs);

const nodeVersion = '22.22.2';
const nodeName = `node-v${nodeVersion}-darwin-arm64`;
const archive = `${nodeName}.tar.gz`;
const baseUrl = `https://nodejs.org/dist/v${nodeVersion}/`;
const cache = join(root, '.cache');
const download = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
};
const checksums = (await download(`${baseUrl}SHASUMS256.txt`)).toString();
const expected = checksums
  .split('\n')
  .find((line) => line.endsWith(`  ${archive}`))
  ?.split(' ')[0];
if (!expected) throw new Error('Node checksum missing');
const archivePath = join(cache, archive);
const bytes = existsSync(archivePath) ? readFileSync(archivePath) : await download(baseUrl + archive);
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node checksum mismatch');
writeFileSync(archivePath, bytes);
execFileSync('tar', ['-xzf', archivePath, '-C', cache]);
mkdirSync(join(output, 'node/bin'), { recursive: true });
copyFileSync(join(cache, nodeName, 'bin/node'), join(output, 'node/bin/node'));
copyFileSync(join(cache, nodeName, 'LICENSE'), join(output, 'node/LICENSE'));
copyFileSync(join(root, 'scripts/aionpi/auth-helper.mjs'), join(output, 'auth-helper.mjs'));
copyFileSync(join(root, 'scripts/aionpi/model-catalog.mjs'), join(output, 'model-catalog.mjs'));
await build({
  entryPoints: [join(root, 'scripts/aionpi/automation-extension.ts')],
  outfile: join(output, 'theone-automation.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@earendil-works/pi-coding-agent', 'typebox'],
});
const automationSkill = join(output, 'theone-skills', 'computer-use', 'SKILL.md');
mkdirSync(dirname(automationSkill), { recursive: true });
copyFileSync(join(root, 'scripts/aionpi/skills/computer-use/SKILL.md'), automationSkill);
copyFileSync(join(piRoot, 'LICENSE'), join(output, 'PI-LICENSE'));
writeFileSync(
  join(output, 'versions.json'),
  JSON.stringify(
    {
      node: nodeVersion,
      pi: '1.0.0',
      piCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: piRoot, encoding: 'utf8' }).trim(),
      nodeSha256: expected,
    },
    null,
    2
  )
);
console.log('TheOne runtime prepared:', output);
