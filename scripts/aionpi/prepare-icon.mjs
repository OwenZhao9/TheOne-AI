import { execFileSync } from 'node:child_process';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

// Convert the approved local artwork without regenerating the logo.
const root = resolve(import.meta.dirname, '../..');
const assets = join(root, 'packages/desktop/src/renderer/assets/logos/brand');
const iconset = await mkdtemp(join(tmpdir(), 'theone-icon-'));
const folder = `${iconset}.iconset`;
await rename(iconset, folder);
try {
  await Promise.all(
    [16, 32, 128, 256, 512].flatMap((size) =>
      [1, 2].map((scale) =>
        sharp(join(assets, 'theone.png'))
          .resize(size * scale, size * scale, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toFile(join(folder, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`))
      )
    )
  );
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', folder, '-o', join(assets, 'theone.icns')]);
} finally {
  await rm(folder, { recursive: true, force: true });
}
console.log('TheOne macOS icon prepared.');
