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


console.log('\n[9] 官方口径修正项（沙箱网关 / 时区 / 变量别名 / format）');
const sbxEnv = Object.assign({}, liveEnv, { ALIPAY_SANDBOX: '1' });
const rsb = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'pro', email: 'buyer@example.com' })
}), sbxEnv);
const bsb = await rsb.json();
ok('沙箱走新版沙箱网关（openapi-sandbox.dl.alipaydev.com）',
  String(bsb.payUrl || '').indexOf('https://openapi-sandbox.dl.alipaydev.com/gateway.do') === 0, String(bsb.payUrl).slice(0, 90));
ok('旧沙箱地址不再出现', String(bsb.payUrl || '').indexOf('openapi-sandbox.alipay.com') < 0);
const rover = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'pro', email: 'buyer@example.com' })
}), Object.assign({}, liveEnv, { ALIPAY_GATEWAY: 'https://example.test/gateway.do' }));
const bover = await rover.json();
ok('ALIPAY_GATEWAY 可覆盖网关', String(bover.payUrl).indexOf('https://example.test/gateway.do') === 0);
ok('AIPAY_* 别名也算已配置', paymentConfigured({ AIPAY_APP_ID: 'x', AIPAY_PRIVATE_KEY: 'y', AIPAY_PUBLIC_KEY: 'z' }));
const ralias = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'pro', email: 'buyer@example.com' })
}), { AIPAY_APP_ID: '2021000000000000', AIPAY_PRIVATE_KEY: pkcs8, AIPAY_PUBLIC_KEY: pub,
     LEADS: liveEnv.LEADS, ASSETS: liveEnv.ASSETS });
const balias = await ralias.json();
ok('用 AIPAY_* 也能拿到支付链接', typeof balias.payUrl === 'string' && balias.payUrl.indexOf('app_id=2021000000000000') > 0);
const tsParam = decodeURIComponent(String(b3.payUrl).split('timestamp=')[1].split('&')[0]);
const utcHour = new Date().getUTCHours();
const bjHour = Number(tsParam.slice(11, 13));
ok('timestamp 用北京时间而非 UTC（差 8 小时）', ((utcHour + 8) % 24) === bjHour, 'timestamp=' + tsParam + ' utcHour=' + utcHour);
ok('带 format=JSON', decodeURIComponent(b3.payUrl).indexOf('format=JSON') > 0);

console.log('\n[10] 异步通知端点：验签 → 核对金额 → 发授权码');
const kv = new Map();
const stateEnv = {
  ALIPAY_APP_ID: '2021000000000000', ALIPAY_PRIVATE_KEY: pkcs8, ALIPAY_PUBLIC_KEY: pub,
  LEADS: { put: async (k, v) => { kv.set(k, v); }, get: async (k) => (kv.has(k) ? kv.get(k) : null) },
  ASSETS: { fetch: async () => new Response(JSON.stringify(pricing), { headers: { 'Content-Type': 'application/json' } }) }
};
const rc = await worker.fetch(new Request('https://x.test/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: 'pro', email: 'buyer@example.com' })
}), stateEnv);
const bc = await rc.json();
const notifyParams = {
  notify_time: '2026-11-01 12:00:00', notify_type: 'trade_status_sync',
  notify_id: 'test-notify-id-001', trade_no: '2026110122000000000001',
  app_id: '2021000000000000', out_trade_no: bc.out_trade_no,
  seller_id: '2088101106499364', subject: bc.subject,
  trade_status: 'TRADE_SUCCESS', total_amount: bc.amount, gmt_payment: '2026-11-01 12:00:00'
};
const notifySign = await rsaSign(pkcs8, signString(notifyParams));
const form = new URLSearchParams();
for (const k of Object.keys(notifyParams)) form.set(k, notifyParams[k]);
form.set('sign', notifySign);
form.set('sign_type', 'RSA2');
const rn = await worker.fetch(new Request('https://x.test/api/pay-notify', { method: 'POST', body: form }), stateEnv);
ok('通知返回 200', rn.status === 200, String(rn.status));
ok('通知响应体正好是 success', (await rn.text()) === 'success');
const paidRec = JSON.parse(kv.get('order:' + bc.out_trade_no));
ok('订单被标记为已支付', paidRec.status === 'paid', paidRec.status);
ok('发放了授权码', /^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/.test(paidRec.licenseKey || ''), paidRec.licenseKey);
ok('授权记录已落库', kv.has('license:' + paidRec.licenseKey));
const tampered = new URLSearchParams(form);
tampered.set('total_amount', '0.01');
tampered.set('sign', await rsaSign(pkcs8, signString(Object.assign({}, notifyParams, { total_amount: '0.01' }))));
const rt = await worker.fetch(new Request('https://x.test/api/pay-notify', { method: 'POST', body: tampered }), stateEnv);
ok('金额被改但签名合法时，通知被拒（金额与订单不符）', rt.status === 400, String(rt.status));
const badSign = new URLSearchParams(form);
badSign.set('sign', 'not-a-signature');
const rb = await worker.fetch(new Request('https://x.test/api/pay-notify', { method: 'POST', body: badSign }), stateEnv);
ok('签名无效时通知被拒', rb.status === 400, String(rb.status));

console.log('\n[11] 主动查单兜底（官方要求与异步通知双重保障）');
const origFetch = globalThis.fetch;
globalThis.__lastQueryUrl = '';
globalThis.fetch = async (u) => {
  const url = String(u);
  globalThis.__lastQueryUrl = url;
  if (url.indexOf('alipay.trade.query') < 0 && url.indexOf('gateway.do') < 0) return origFetch(u);
  return new Response(JSON.stringify({
    alipay_trade_query_response: {
      code: '10000', msg: 'Success', out_trade_no: bc.out_trade_no,
      trade_no: '2026110122000000000001', trade_status: 'TRADE_SUCCESS', total_amount: bc.amount
    }
  }), { headers: { 'Content-Type': 'application/json' } });
};
const rq = await worker.fetch(new Request('https://x.test/api/pay-query', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ out_trade_no: bc.out_trade_no })
}), stateEnv);
const bq = await rq.json();
ok('查单返回 200', rq.status === 200, JSON.stringify(bq).slice(0, 160));
ok('查单返回交易状态 TRADE_SUCCESS', bq.trade_status === 'TRADE_SUCCESS', bq.trade_status);
ok('查单走 alipay.trade.query 接口', decodeURIComponent(String(globalThis.__lastQueryUrl)).indexOf('method=alipay.trade.query') > 0, String(globalThis.__lastQueryUrl).slice(0, 80));
ok('查单带签名', /[?&]sign=/.test(String(globalThis.__lastQueryUrl)));
const rq2 = await worker.fetch(new Request('https://x.test/api/pay-query', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
}), stateEnv);
ok('查单缺订单号返回 400', rq2.status === 400, String(rq2.status));
const rq3 = await worker.fetch(new Request('https://x.test/api/pay-query', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ out_trade_no: bc.out_trade_no })
}), fakeEnv);
ok('未配置支付时查单返回 503', rq3.status === 503, String(rq3.status));
globalThis.fetch = origFetch;

console.log('\n结果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
