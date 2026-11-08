import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** npm does not bundle hoisted workspace symlinks. Stage the exact public files. */
export function bundle(packageRoot) {
  const sibling = resolve(packageRoot, '../herdr-ui');
  const source = existsSync(join(sibling, 'index.mjs')) ? sibling : dirname(fileURLToPath(import.meta.url));
  const target = resolve(packageRoot, 'node_modules/@iurysza/herdr-ui');
  mkdirSync(target, { recursive: true });
  if (realpathSync(source) === realpathSync(target)) return;
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  for (const file of ['package.json', ...manifest.files]) copyFileSync(join(source, file), join(target, file));
  writeFileSync(resolve(packageRoot, 'node_modules/.herdr-ui-staged'), realpathSync(target));
}

/** Remove only the workspace copy staged by bundle, never an installed dependency. */
export function unbundle(packageRoot) {
  const marker = resolve(packageRoot, 'node_modules/.herdr-ui-staged');
  const target = resolve(packageRoot, 'node_modules/@iurysza/herdr-ui');
  if (!existsSync(marker)) return;
  if (existsSync(target) && readFileSync(marker, 'utf8') === realpathSync(target)) rmSync(target, { recursive: true });
  unlinkSync(marker);
}
