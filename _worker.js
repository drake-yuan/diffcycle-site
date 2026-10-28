/* Cloudflare Pages 高级模式（_worker.js）
 * 作用：把「免费开始」登记写入 Workers KV，可选推送到机器人 Webhook；其余请求原样交给静态资源。
 * 绑定：LEADS = KV namespace（线索存储）；LEADS_TOKEN = 读取线索用的令牌（后台变量或密文）。
 * 可选：LEAD_WEBHOOK = 企业微信/飞书机器人 Webhook；LEAD_MAIL = 对外联系邮箱（只存服务端，不进代码库）。
 * 不依赖任何第三方服务，不需要在浏览器暴露任何密钥。
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 200;
const MAX_LIST = 1000;

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
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return new Response('服务暂时不可用：' + String((e && e.message) || e), {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};