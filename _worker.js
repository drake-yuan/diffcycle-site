/* Cloudflare Pages 高级模式（_worker.js）
 *
 * 三件事：
 *   1. 「免费开始」登记写入 Workers KV，可选推送到机器人 Webhook。
 *   2. 支付：支付宝 Vibe Pay 网页支付（基础收款能力）——下单、异步通知验签、订单查询、权益发放。
 *   3. 其余请求原样交给静态资源。
 *
 * 绑定与变量（全部走环境变量，代码库里不出现任何凭据值）：
 *   LEADS = KV namespace（线索 + 订单 + 授权）
 *   LEADS_TOKEN = 读取线索用的令牌
 *   LEAD_WEBHOOK = 企业微信/飞书机器人 Webhook（可选）
 *   LEAD_MAIL = 对外联系邮箱
 *   ALIPAY_APP_ID = 支付宝应用 app_id
 *   ALIPAY_PRIVATE_KEY = 应用私钥（PEM，PKCS8 或 PKCS1 都可）
 *   ALIPAY_PUBLIC_KEY = 支付宝公钥（PEM，SPKI）
 *   ALIPAY_NOTIFY_URL = 异步通知地址（可选，默认按当前 host 推导）
 *   ALIPAY_GATEWAY = 网关地址（默认正式 https://openapi.alipay.com/gateway.do）
 *   ALIPAY_SANDBOX = "1" 时走沙箱网关
 *   （以上变量也接受官方 Skill 的 AIPAY_* 命名，二选一即可）
 */
/* 与前端 main.js 的校验保持一致：本地部分 @ 域名.后缀（此前要求两段后缀，前端放行的 a@b.com 会被后端拒绝） */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 200;
const MAX_LIST = 1000;
const DEFAULT_GATEWAY = 'https://openapi.alipay.com/gateway.do';
/* 新版沙箱网关地址（官方「环境升级说明」：新版沙箱与旧版完全独立，
   旧沙箱 APPID 不能在新版沙箱调用）。控制台若显示不同地址，用 ALIPAY_GATEWAY 覆盖。 */
const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

/* ------------------------------------------------------------------ */
/* 支付：支付宝 Vibe Pay 网页支付                                       */
/* ------------------------------------------------------------------ */

const PAY_METHOD = 'alipay.trade.page.pay';
const QUERY_METHOD = 'alipay.trade.query';
const SIGN_TYPE = 'RSA2';

/* 支付宝签名串：参数按 key 字典序，k=v 用 & 连接；值原样，不做 URL 编码。 */
function signString(params, skip) {
  const keys = Object.keys(params).filter(function (k) {
    return k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== null && params[k] !== '' && (!skip || skip.indexOf(k) < 0);
  });
  keys.sort();
  return keys.map(function (k) { return k + '=' + params[k]; }).join('&');
}

function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* PKCS1（"BEGIN RSA PRIVATE KEY"）转 PKCS8：WebCrypto 只收 pkcs8。 */
function pkcs1ToPkcs8(der) {
  const bytes = [];
  const lenBytes = function (n) {
    if (n < 0x80) return [n];
    const out = [];
    let v = n;
    while (v > 0) { out.unshift(v & 0xff); v = v >> 8; }
    return [0x80 | out.length].concat(out);
  };
  const seq = function (content) { return [0x30].concat(lenBytes(content.length), content); };
  const version = [0x02, 0x01, 0x00];
  const algId = seq([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const octet = [0x04].concat(lenBytes(der.length), Array.from(der));  // OCTET STRING 直接装 RSAPrivateKey
  return new Uint8Array(seq(version.concat(algId, octet)));
}

async function importPrivateKey(pem) {
  let der = pemToDer(pem);
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) der = pkcs1ToPkcs8(der);
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function importPublicKey(pem) {
  const der = pemToDer(pem);
  return crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function rsaSign(pem, text) {
  const key = await importPrivateKey(pem);
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(text));
  return b64(sig);
}

async function rsaVerify(pem, text, signatureB64) {
  const key = await importPublicKey(pem);
  const bin = atob(signatureB64);
  const sig = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) sig[i] = bin.charCodeAt(i);
  return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, new TextEncoder().encode(text));
}

/* 读环境变量：本项目用 ALIPAY_*；支付宝官方 Skill 用 AIPAY_*，两套都认。 */
const PAY_ENV_ALIAS = {
  ALIPAY_APP_ID: 'AIPAY_APP_ID',
  ALIPAY_PRIVATE_KEY: 'AIPAY_PRIVATE_KEY',
  ALIPAY_PUBLIC_KEY: 'AIPAY_PUBLIC_KEY',
  ALIPAY_GATEWAY: 'AIPAY_GATEWAY',
  ALIPAY_NOTIFY_URL: 'AIPAY_NOTIFY_URL',
  ALIPAY_SANDBOX: 'AIPAY_SANDBOX'
};

function payEnv(env, name) {
  if (env && env[name]) return env[name];
  const alias = PAY_ENV_ALIAS[name];
  return alias && env ? env[alias] : undefined;
}

function paymentConfigured(env) {
  return !!(payEnv(env, 'ALIPAY_APP_ID') && payEnv(env, 'ALIPAY_PRIVATE_KEY') && payEnv(env, 'ALIPAY_PUBLIC_KEY'));
}

function gatewayOf(env) {
  const g = payEnv(env, 'ALIPAY_GATEWAY');
  if (g) return g;
  return payEnv(env, 'ALIPAY_SANDBOX') === '1' ? SANDBOX_GATEWAY : DEFAULT_GATEWAY;
}

/* 网关要求的 timestamp 是北京时间（yyyy-MM-dd HH:mm:ss）。
   直接用 toISOString() 会得到 UTC，与北京时间差 8 小时，可能被判为非法请求。 */
function shanghaiNow() {
  return new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

/* 订单里的档位与金额不在代码里写死：从 /pricing.json 读，单一事实来源。 */
async function loadPricing(request, env) {
  const res = await env.ASSETS.fetch(new Request(new URL('/pricing.json', new URL(request.url).origin).toString()));
  if (!res.ok) return null;
  try { return await res.json(); } catch (e) { return null; }
}

function pickPlan(pricing, planId) {
  if (!pricing || !pricing.plans) return null;
  for (const p of pricing.plans) if (p.id === planId) return p;
  return null;
}

function orderNo() {
  const d = new Date();
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  const stamp = String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  return 'DC' + stamp + Math.random().toString(36).slice(2, 10);
}

function licenseKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return s.slice(0, 8) + '-' + s.slice(8, 16) + '-' + s.slice(16, 24);
}

async function handleCheckout(request, env, url) {
  if (request.method !== 'POST') return json({ ok: false, error: '方法不被允许' }, 405);
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }
  const planId = String(body.planId || '').trim();
  const email = String(body.email || '').trim();
  if (!planId) return json({ ok: false, error: '缺少 planId' }, 400);
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: '邮箱格式不正确' }, 400);
  }
  if (!paymentConfigured(env)) {
    // 不假装成功：明确告诉前端支付通道尚未开通，前端据此切到早鸟登记。
    return json({ ok: false, code: 'payment_not_configured', error: '支付通道尚未开通' }, 503);
  }
  const pricing = await loadPricing(request, env);
  const plan = pickPlan(pricing, planId);
  if (!plan) return json({ ok: false, error: '没有这个档位' }, 404);
  if (!plan.price || plan.price <= 0) {
    return json({ ok: false, code: 'free_plan', error: '这个档位不需要付款' }, 400);
  }
  if (!env.LEADS) return json({ ok: false, error: '未配置 KV 绑定 LEADS' }, 503);

  const no = orderNo();
  /* 计价周期：默认月付；档位配了 annual_price 才允许年付。
     价格一律来自 pricing.json，这里不写死任何金额。 */
  const period = String(body.period || 'month').trim() === 'year' && plan.annual_price ? 'year' : 'month';
  const amount = Number(period === 'year' ? plan.annual_price : plan.price).toFixed(2);
  const subject = 'DiffCycle ' + plan.name + (period === 'year' ? ' 年付' : plan.period === 'month' ? ' 月付' : ' 买断');
  const biz = {
    out_trade_no: no,
    product_code: 'FAST_INSTANT_TRADE_PAY',
    total_amount: amount,
    subject: subject,
    body: plan.name + ' · ' + (plan.ai_fix_credits ? plan.ai_fix_credits.included + ' 次 AI 修复额度 / ' + (plan.ai_fix_credits.period === 'month' ? '月' : plan.ai_fix_credits.period) : '私有部署')
  };
  const params = {
    app_id: payEnv(env, 'ALIPAY_APP_ID'),
    method: PAY_METHOD,
    charset: 'utf-8',
    sign_type: SIGN_TYPE,
    version: '1.0',
    format: 'JSON',
    timestamp: shanghaiNow(),
    notify_url: payEnv(env, 'ALIPAY_NOTIFY_URL') || (url.origin + '/api/pay-notify'),
    return_url: url.origin + '/thanks',
    biz_content: JSON.stringify(biz)
  };
  const paramsStr = signString(params);
  let sign;
  try {
    sign = await rsaSign(payEnv(env, 'ALIPAY_PRIVATE_KEY'), paramsStr);
  } catch (e) {
    return json({ ok: false, error: '签名失败：私钥不可用' }, 500);
  }
  const query = Object.keys(params).sort().map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  const payUrl = gatewayOf(env) + '?' + query + '&sign=' + encodeURIComponent(sign);

  const rec = {
    id: no,
    kind: 'order',
    planId: plan.id,
    planName: plan.name,
    email: email,
    amount: amount,
    subject: subject,
    credits: plan.ai_fix_credits ? plan.ai_fix_credits.included : null,
    creditsPeriod: plan.ai_fix_credits ? plan.ai_fix_credits.period : null,
    period: period,
    seats: plan.seats || null,
    status: 'created',
    ts: new Date().toISOString()
  };
  try {
    await env.LEADS.put('order:' + no, JSON.stringify(rec));
  } catch (e) {
    return json({ ok: false, error: '写入失败：' + String((e && e.message) || e) }, 500);
  }
  return json({ ok: true, out_trade_no: no, amount: amount, subject: subject, payUrl: payUrl });
}

/* 发货：核对订单号与金额后发授权码。异步通知与主动查单共用，避免两条路径口径不一致。
   返回 'success' 表示处理完成（幂等），返回 'fail' 表示异常通知，必须忽略。 */
async function fulfillOrder(env, p) {
  const no = p.out_trade_no || '';
  if (!no) return 'fail';
  let rec = null;
  if (env.LEADS) {
    const raw = await env.LEADS.get('order:' + no);
    if (raw) { try { rec = JSON.parse(raw); } catch (e) { rec = null; } }
  }
  // 金额必须与订单一致，否则不发放。
  if (!rec || Number(rec.amount).toFixed(2) !== Number(p.total_amount).toFixed(2)) return 'fail';
  if (rec.status === 'paid') return 'success';
  rec.status = 'paid';
  rec.paidAt = new Date().toISOString();
  rec.tradeNo = p.trade_no || '';
  const key = licenseKey();
  rec.licenseKey = key;
  if (env.LEADS) {
    try {
      await env.LEADS.put('order:' + no, JSON.stringify(rec));
      await env.LEADS.put('license:' + key, JSON.stringify({
        id: key, planId: rec.planId, planName: rec.planName, email: rec.email,
        credits: rec.credits, creditsPeriod: rec.creditsPeriod, issuedAt: rec.paidAt
      }));
    } catch (e) {
      return 'fail';
    }
  }
  await notifyLead(env, { email: rec.email, source: 'payment:' + rec.planId, ts: rec.paidAt, id: no });
  return 'success';
}

/* 支付宝异步通知：验签 + 核对关键字段 + 发放权益。 */
async function handleNotify(request, env) {
  if (request.method !== 'POST') return new Response('fail', { status: 405 });
  const form = await request.formData();
  const params = {};
  for (const [k, v] of form.entries()) params[k] = String(v);
  const sign = params.sign || '';
  if (!sign) return new Response('fail', { status: 400 });
  const alipayPub = payEnv(env, 'ALIPAY_PUBLIC_KEY');
  if (!alipayPub) return new Response('fail', { status: 503 });
  let ok = false;
  try {
    ok = await rsaVerify(alipayPub, signString(params), sign);
  } catch (e) {
    ok = false;
  }
  if (!ok) return new Response('fail', { status: 400 });
  if (params.app_id !== payEnv(env, 'ALIPAY_APP_ID')) return new Response('fail', { status: 400 });
  if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') {
    return new Response('success', { status: 200 });
  }
  const r = await fulfillOrder(env, params);
  if (r !== 'success') return new Response('fail', { status: 400 });
  return new Response('success', { status: 200 });
}

/* 主动查单：官方要求「异步通知 + alipay.trade.query」双重保障，
   通知丢失时（例如商户侧短暂不可用）仍要能确认支付结果。 */
async function handlePayQuery(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: '方法不被允许' }, 405);
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }
  const no = String(body.out_trade_no || '').trim();
  if (!no) return json({ ok: false, error: '缺少 out_trade_no' }, 400);
  if (!paymentConfigured(env)) return json({ ok: false, code: 'payment_not_configured', error: '支付通道尚未开通' }, 503);
  let resp = null;
  try {
    resp = await alipayQuery(env, no);
  } catch (e) {
    return json({ ok: false, error: '查询失败：' + String((e && e.message) || e) }, 502);
  }
  if (!resp) return json({ ok: false, error: '查询没有返回结果' }, 502);
  if (resp.code && resp.code !== '10000') {
    return json({ ok: false, error: '查询未成功', code: resp.code, msg: resp.msg || null }, 502);
  }
  const status = resp.trade_status || 'UNKNOWN';
  if (status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED') {
    const r = await fulfillOrder(env, {
      out_trade_no: resp.out_trade_no || no,
      total_amount: resp.total_amount,
      trade_no: resp.trade_no || ''
    });
    if (r !== 'success') return json({ ok: false, error: '订单核对未通过' }, 409);
  }
  let local = null;
  if (env.LEADS) {
    const raw = await env.LEADS.get('order:' + no);
    if (raw) { try { local = JSON.parse(raw); } catch (e) { local = null; } }
  }
  return json({
    ok: true,
    out_trade_no: no,
    trade_status: status,
    trade_no: resp.trade_no || null,
    total_amount: resp.total_amount || null,
    local_status: local ? local.status : null,
    license_key: local && local.licenseKey ? local.licenseKey : null
  });
}

/* 调用支付宝统一收单交易查询接口（alipay.trade.query）。 */
async function alipayQuery(env, outTradeNo) {
  const params = {
    app_id: payEnv(env, 'ALIPAY_APP_ID'),
    method: QUERY_METHOD,
    charset: 'utf-8',
    sign_type: SIGN_TYPE,
    version: '1.0',
    format: 'JSON',
    timestamp: shanghaiNow(),
    biz_content: JSON.stringify({ out_trade_no: outTradeNo })
  };
  const sign = await rsaSign(payEnv(env, 'ALIPAY_PRIVATE_KEY'), signString(params));
  const query = Object.keys(params).sort().map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  const res = await fetch(gatewayOf(env) + '?' + query + '&sign=' + encodeURIComponent(sign), {
    method: 'GET', headers: { 'Accept': 'application/json' }
  });
  const body = await res.json();
  return body.alipay_trade_query_response || null;
}

async function handleOrder(request, env, url) {
  const no = url.searchParams.get('trade_no') || '';
  if (!no) return json({ ok: false, error: '缺少 trade_no' }, 400);
  if (!env.LEADS) return json({ ok: false, error: '未配置 KV 绑定 LEADS' }, 503);
  const raw = await env.LEADS.get('order:' + no);
  if (!raw) return json({ ok: false, error: '没有这笔订单' }, 404);
  let rec = {};
  try { rec = JSON.parse(raw); } catch (e) { return json({ ok: false, error: '订单数据损坏' }, 500); }
  return json({
    ok: true,
    order: {
      out_trade_no: rec.id, status: rec.status, planId: rec.planId, planName: rec.planName,
      amount: rec.amount, subject: rec.subject, paidAt: rec.paidAt || null
    }
  });
}

/* 授权查询：CLI / MCP 用 license key 换额度与到期信息。 */
async function handleLicense(request, env, url) {
  if (request.method !== 'POST') return json({ ok: false, error: '方法不被允许' }, 405);
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }
  const key = String(body.key || '').trim().toUpperCase();
  if (!key) return json({ ok: false, error: '缺少 key' }, 400);
  if (!env.LEADS) return json({ ok: false, error: '未配置 KV 绑定 LEADS' }, 503);
  const raw = await env.LEADS.get('license:' + key);
  if (!raw) return json({ ok: false, error: '授权不存在' }, 404);
  let rec = {};
  try { rec = JSON.parse(raw); } catch (e) { return json({ ok: false, error: '授权数据损坏' }, 500); }
  return json({ ok: true, license: rec });
}

/* ------------------------------------------------------------------ */
/* 原有：登记与联系                                                   */
/* ------------------------------------------------------------------ */

/* 联系邮箱只在运行时从服务端变量返回，代码库与前端 JS 里都不出现。 */
async function handleContact(request, env) {
  if (request.method !== 'GET') return json({ ok: false, error: '方法不被允许' }, 405);
  if (!env.LEAD_MAIL) return json({ ok: false, error: '未配置 LEAD_MAIL' }, 404);
  return json({ ok: true, email: env.LEAD_MAIL });
}

/* 可选：把新线索推到企业微信 / 飞书群机器人。 */
async function notifyLead(env, rec) {
  const hook = env.LEAD_WEBHOOK;
  if (!hook) return;
  const text = '新早鸟登记\n邮箱：' + rec.email + '\n来源：' + rec.source + '\n时间：' + rec.ts;
  let payload;
  if (hook.indexOf('qyapi.weixin.qq.com') >= 0) {
    payload = { msgtype: 'text', text: { content: text } };
  } else if (hook.indexOf('open.feishu.cn') >= 0) {
    payload = { msg_type: 'text', content: { text: text } };
  } else {
    payload = { text: text };
  }
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    /* 通知失败不影响登记结果 */
  }
}

async function handleLeads(request, env, url) {
  const origin = request.headers.get('Origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { host = ''; }
    if (host && host !== url.host) return json({ ok: false, error: '来源不被允许' }, 403);
  }
  if (request.method === 'GET') {
    if (!env.LEADS_TOKEN) return json({ ok: false, error: '未配置 LEADS_TOKEN' }, 404);
    const token = url.searchParams.get('token') || request.headers.get('x-leads-token') || '';
    if (token !== env.LEADS_TOKEN) return json({ ok: false, error: '令牌不正确' }, 403);
    if (!env.LEADS) return json({ ok: false, error: '未配置 KV 绑定 LEADS' }, 503);
    const listed = await env.LEADS.list({ prefix: 'lead:', limit: MAX_LIST });
    const leads = [];
    for (const k of listed.keys) {
      const raw = await env.LEADS.get(k.name);
      if (!raw) continue;
      try { leads.push(JSON.parse(raw)); } catch (e) { /* 跳过坏数据 */ }
    }
    leads.sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });
    if ((url.searchParams.get('format') || '') === 'csv') {
      const head = 'email,source,ts,id';
      const rows = leads.map(function (l) {
        return [l.email, l.source, l.ts, l.id].map(function (v) {
          return '"' + String(v === undefined ? '' : v).replace(/"/g, '""') + '"';
        }).join(',');
      });
      return new Response([head].concat(rows).join('\r\n'), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    return json({ ok: true, count: leads.length, leads: leads });
  }
  if (request.method !== 'POST') return json({ ok: false, error: '方法不被允许' }, 405);
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }
  const email = String(body.email || '').trim();
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: '邮箱格式不正确' }, 400);
  }
  if (!env.LEADS) return json({ ok: false, error: '未配置 KV 绑定 LEADS' }, 503);
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const rec = {
    id: id,
    email: email,
    source: String(body.source || 'web').slice(0, 40),
    plan: String(body.plan || '').slice(0, 20),
    ts: new Date().toISOString(),
    ua: String(request.headers.get('user-agent') || '').slice(0, 200)
  };
  try {
    await env.LEADS.put('lead:' + id, JSON.stringify(rec));
  } catch (e) {
    return json({ ok: false, error: '写入失败：' + String((e && e.message) || e) }, 500);
  }
  await notifyLead(env, rec);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/early-access') return await handleLeads(request, env, url);
      if (url.pathname === '/api/contact') return await handleContact(request, env);
      if (url.pathname === '/api/checkout') return await handleCheckout(request, env, url);
      if (url.pathname === '/api/pay-notify') return await handleNotify(request, env);
      if (url.pathname === '/api/pay-query') return await handlePayQuery(request, env);
      if (url.pathname === '/api/order') return await handleOrder(request, env, url);
      if (url.pathname === '/api/license') return await handleLicense(request, env, url);
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return new Response('服务暂时不可用：' + String((e && e.message) || e), {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};

/* 供本地测试导入（Pages 只用 default 导出，多余的具名导出不影响运行）。 */
export { signString, pkcs1ToPkcs8, pemToDer, rsaSign, rsaVerify, paymentConfigured, orderNo, licenseKey };
