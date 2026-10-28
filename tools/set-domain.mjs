/* 换正式域名：node tools/set-domain.mjs diffcycle.com
 * 把 index.html 里的 canonical / og:url / og:image / twitter:image 绝对地址
 * 统一改到正式域名，并同步 README 的线上地址。
 * 用法：
 *   node tools/set-domain.mjs <域名>          改写
 *   node tools/set-domain.mjs <域名> --check  只看当前状态，不改
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const target = process.argv[2];
const check = process.argv.includes('--check');
const htmlPath = join(root, 'index.html');
const readmePath = join(root, 'README.md');

function currentDomain(text) {
  const m = text.match(/<link rel="canonical" href="https?:\/\/([^/"]+)/);
  return m ? m[1] : '(未设置)';
}

if (!target) {
  const html = readFileSync(htmlPath, 'utf8');
  console.log('当前 canonical 域名:', currentDomain(html));
  console.log('用法: node tools/set-domain.mjs <你的域名>');
  process.exit(0);
}

const domain = target.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const html = readFileSync(htmlPath, 'utf8');
if (check) {
  console.log('当前:', currentDomain(html), '→ 目标:', domain, '(仅检查，未修改)');
  process.exit(0);
}
let out = html.replace(/https:\/\/[a-z0-9.-]+\/assets\/img\/og\.png/g, `https://${domain}/assets/img/og.png`);
out = out.replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="https://${domain}/"`);
out = out.replace(/(<meta property="og:url" content=")[^"]*/g, `$1https://${domain}/`);
out = out.replace(/(<meta name="twitter:url" content=")[^"]*/g, `$1https://${domain}/`);
writeFileSync(htmlPath, out, 'utf8');

let readme = readFileSync(readmePath, 'utf8');
readme = readme.replace(/- 线上地址：.*/, `- 线上地址：https://${domain}/`);
readme = readme.replace(/- 正式域名：.*/, `- 正式域名：${domain}`);
writeFileSync(readmePath, readme, 'utf8');
console.log('已改为', domain);