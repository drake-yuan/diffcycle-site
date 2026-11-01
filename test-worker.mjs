import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import worker, { signString, rsaSign, rsaVerify, pemToDer, pkcs1ToPkcs8, paymentConfigured, orderNo, licenseKey } from './_worker.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

const pkcs1 = readFileSync('./keys/pkcs1.pem', 'utf8');
const pkcs8 = readFileSync('./keys/pkcs8.pem', 'utf8');
const pub = readFileSync('./keys/pub.pem', 'utf8');
const pub1 = readFileSync('./keys/pub1.pem', 'utf8');  // pkcs1.pem 对应的公钥

console.log('\n[1] 签名串构造');
const s1 = signString({ b: '2', a: '1', sign: 'x', sign_type: 'RSA2', empty: '' });
ok('按 key 字典序拼接', s1 === 'a=1&b=2', s1);
ok('排除 sign / sign_type / 空值', !s1.includes('sign=') && !s1.includes('empty'), s1);

console.log('\n[2] 签名 / 验签往返（PKCS8 私钥）');
const msg = 'app_id=2021&biz_content={"x":1}&method=alipay.trade.page.pay';
const sig8 = await rsaSign(pkcs8, msg);
ok('签名产出 base64', typeof sig8 === 'string' && sig8.length > 200);
ok('支付宝公钥验签通过', await rsaVerify(pub, msg, sig8));
ok('篡改消息后验签失败', !(await rsaVerify(pub, msg + 'x', sig8)));

console.log('\n[3] PKCS1 私钥（支付宝常见格式）转换后可用');
const sig1 = await rsaSign(pkcs1, msg);
ok('PKCS1 私钥可直接签名', typeof sig1 === 'string' && sig1.length > 200);
ok('PKCS1 签名用对应公钥验签通过', await rsaVerify(pub1, msg, sig1));
// 用 openssl 反向验证：证明转换没有改变私钥本身（自己写临时文件，不依赖外部步骤）
const okOpen = (() => {
  try {
    writeFileSync('/tmp/dc-msg.txt', msg);
    writeFileSync('/tmp/dc-sig.bin', Buffer.from(sig1, 'base64'));
    execFileSync('openssl', ['dgst', '-sha256', '-verify', './keys/pub1.pem', '-signature', '/tmp/dc-sig.bin', '/tmp/dc-msg.txt'], { stdio: 'pipe' });
    return true;
  } catch (e) { return false; }
})();
ok('PKCS1→PKCS8 转换后签名被 OpenSSL 公钥验证通过', okOpen);

console.log('\n[4] PEM 解析');
ok('PEM 去头去尾后能解出 DER', pemToDer(pub).length > 100);
ok('PKCS1 转 PKCS8 产出 SEQUENCE 头', pkcs1ToPkcs8(pemToDer(pkcs1))[0] === 0x30);

console.log('\n[5] 配置判定');
ok('缺变量时判定为未配置', !paymentConfigured({}));
ok('齐全时判定为已配置', paymentConfigured({ ALIPAY_APP_ID: 'x', ALIPAY_PRIVATE_KEY: 'y', ALIPAY_PUBLIC_KEY: 'z' }));

console.log('\n[6] 未配置支付时的下单行为（不得假装成功）');
const fakeEnv = { ASSETS: { fetch: async () => new Response('{}', { status: 404 }) } };
const res = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'pro', email: 'a@b.com' })
}), fakeEnv);
const body = await res.json();
ok('返回 503', res.status === 503, String(res.status));
ok('带 payment_not_configured 标记', body.code === 'payment_not_configured', JSON.stringify(body));
ok('不返回任何支付链接', !body.payUrl);

console.log('\n[7] 订单号与授权码格式');
const nos = new Set();
for (let i = 0; i < 50; i++) nos.add(orderNo());
ok('订单号 50 次不重复', nos.size === 50);
const k = licenseKey();
ok('授权码形如 XXXX-XXXX-XXXX', /^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/.test(k), k);

console.log('\n[7b] 邮箱校验与前端一致');
const envLeads = { LEADS: { put: async () => {}, get: async () => null }, ASSETS: { fetch: async () => new Response('{}', { status: 404 }) } };
for (const em of ['a@b.com', 'user.name@example.co.uk', 'x@y.cn']) {
  const r = await worker.fetch(new Request('https://x.test/api/early-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }) }), envLeads);
  ok('接受 ' + em, r.status === 200, String(r.status));
}
for (const em of ['a@b', 'a@@b.com', 'no-at-sign']) {
  const r = await worker.fetch(new Request('https://x.test/api/early-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }) }), envLeads);
  ok('拒绝 ' + em, r.status === 400, String(r.status));
}

console.log('\n[7c] 已配置时的下单主路径');
const pricing = JSON.parse(readFileSync('./pricing.json', 'utf8'));
const writes = [];
const liveEnv = {
  ALIPAY_APP_ID: '2021000000000000',
  ALIPAY_PRIVATE_KEY: pkcs8,
  ALIPAY_PUBLIC_KEY: pub,
  LEADS: { put: async (k, v) => { writes.push([k, v]); }, get: async () => null },
  ASSETS: { fetch: async () => new Response(JSON.stringify(pricing), { headers: { 'Content-Type': 'application/json' } }) }
};
const r3 = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'pro', email: 'buyer@example.com' })
}), liveEnv);
const b3 = await r3.json();
ok('返回 200', r3.status === 200, JSON.stringify(b3).slice(0, 200));
ok('给出支付链接', typeof b3.payUrl === 'string' && b3.payUrl.indexOf('gateway.do?') > 0);
ok('链接带 sign 参数', /[?&]sign=/.test(b3.payUrl || ''));
const proPlan = pricing.plans.filter(function (p) { return p.id === 'pro'; })[0];
ok('金额取自 pricing.json（' + proPlan.price.toFixed(2) + '）', b3.amount === Number(proPlan.price).toFixed(2), String(b3.amount));
ok('订单号与响应一致', writes.some(w => w[0] === 'order:' + b3.out_trade_no));
const rec = JSON.parse((writes.find(w => w[0] === 'order:' + b3.out_trade_no) || ['', '{}'])[1]);
ok('订单记录了档位与额度', rec.planId === 'pro' && rec.credits === proPlan.ai_fix_credits.included, JSON.stringify(rec).slice(0, 160));
ok('订单初始状态是 created', rec.status === 'created');
ok('biz_content 带金额与商品代码', decodeURIComponent(b3.payUrl).indexOf('total_amount') > 0 && decodeURIComponent(b3.payUrl).indexOf('FAST_INSTANT_TRADE_PAY') > 0 && decodeURIComponent(b3.payUrl).indexOf(proPlan.price.toFixed(2)) > 0);
const r3y = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'pro', period: 'year', email: 'buyer@example.com' })
}), liveEnv);
const b3y = await r3y.json();
ok('年付下单返回 200', r3y.status === 200, JSON.stringify(b3y).slice(0, 160));
ok('年付金额取 annual_price（' + proPlan.annual_price.toFixed(2) + '）', b3y.amount === Number(proPlan.annual_price).toFixed(2), String(b3y.amount));
ok('年付主题含「年付」', /年付/.test(b3y.subject || ''), b3y.subject);
const rNoAnn = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'local', period: 'year', email: 'buyer@example.com' })
}), liveEnv);
ok('没有年付价的档位不按年付计价', rNoAnn.status === 400, String(rNoAnn.status));
const r4 = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'local', email: 'buyer@example.com' })
}), liveEnv);
ok('免费档位不生成支付链接', r4.status === 400 && (await r4.json()).code === 'free_plan');
const r5 = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'nope', email: 'buyer@example.com' })
}), liveEnv);
ok('未知档位返回 404', r5.status === 404, String(r5.status));

console.log('\n[8] 非 POST 的下单请求被拒');
const res2 = await worker.fetch(new Request('https://x.test/api/checkout'), fakeEnv);
ok('GET /api/checkout 返回 405', res2.status === 405, String(res2.status));

console.log('\n结果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
