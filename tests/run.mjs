// 运行入口：用 esbuild 将 TS 测试打包为 ESM，再交给 node 执行。
// 之所以走 esbuild 而不是直接 node，是因为测试导入了项目内的 .ts 源码。
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// store 模块在 import 时会访问 localStorage；node 环境提供一个内存版垫片
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => Array.from(mem.keys())[i] ?? null,
  get length() {
    return mem.size;
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, 'bookingValidation.test.ts');

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  target: 'node18',
});

const outDir = mkdtempSync(join(tmpdir(), 'booking-test-'));
const outFile = join(outDir, 'test.mjs');
writeFileSync(outFile, result.outputFiles[0].text);

await import(pathToFileURL(outFile).href);
