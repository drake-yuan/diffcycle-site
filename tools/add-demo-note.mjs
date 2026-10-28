/* 给演示产物加一句如实说明：它生成于产品定名前，页面里沿用当时的内部代号。
 * 用法: node tools/add-demo-note.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = join(root, 'index.html');
let s = readFileSync(p, 'utf8');
if (s.includes('proof-note-inline')) { console.log('already patched'); process.exit(0); }
const anchor = '<a href="assets/runs/generated-page.html" target="_blank" rel="noreferrer">直接打开这次生成的页面 →</a>';
if (!s.includes(anchor)) { console.log('anchor not found'); process.exit(1); }
const note = '\n          <span class="proof-note-inline">这份产物生成于产品定名前，页面里沿用当时的内部代号 DiffStage，内容未作改动。</span>';
s = s.replace(anchor, anchor + note);
writeFileSync(p, s, 'utf8');
console.log('patched ok');