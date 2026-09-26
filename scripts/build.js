import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyGrid, makeIdentityKnots } from '../src/shared/bilinear.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 构建：
 * 1. 自检——恒等网格必须通过校核且 J_min = 1，防止把损坏的数学模块打进产物；
 * 2. 组装 dist/public（页面 + 共享数学模块），并生成带 SHA-256 的构建清单。
 */
export async function build() {
  const probe = verifyGrid({
    rows: 2,
    cols: 2,
    knots: makeIdentityKnots(2, 2),
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 2, v: 2 }],
  });
  if (!probe.ok || probe.minJacobian.value !== 1) {
    throw new Error('构建自检失败：恒等网格校核未通过');
  }

  const srcPublic = path.join(ROOT, 'src', 'public');
  const distPublic = path.join(ROOT, 'dist', 'public');
  await rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
  await mkdir(path.join(distPublic, 'shared'), { recursive: true });

  const files = [
    ['index.html', path.join(srcPublic, 'index.html'), path.join(distPublic, 'index.html')],
    ['app.js', path.join(srcPublic, 'app.js'), path.join(distPublic, 'app.js')],
    ['styles.css', path.join(srcPublic, 'styles.css'), path.join(distPublic, 'styles.css')],
    ['shared/bilinear.js', path.join(ROOT, 'src', 'shared', 'bilinear.js'), path.join(distPublic, 'shared', 'bilinear.js')],
  ];

  const manifest = { builtAt: new Date().toISOString(), files: {} };
  for (const [name, from, to] of files) {
    await copyFile(from, to);
    const buf = await readFile(to);
    manifest.files[name] = {
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    };
  }
  await writeFile(path.join(ROOT, 'dist', 'build-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[build] dist/ 已生成（${files.length} 个文件），构建自检通过`);
  return manifest;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  build().catch((err) => {
    console.error('[build] 失败:', err.message);
    process.exit(1);
  });
}
