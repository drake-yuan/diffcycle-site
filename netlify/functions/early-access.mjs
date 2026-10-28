export default async function handler(req) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token');
    if (!process.env.LEADS_TOKEN) return json({ ok: false, error: 'LEADS_TOKEN not set' }, 404);
    if (token !== process.env.LEADS_TOKEN) return json({ ok: false, error: 'bad token' }, 403);
    return json({ ok: false, error: 'Netlify deploy has no KV: check Forms panel or group bot' }, 501);
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const email = String(body.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'invalid email' }, 400);
  const rec = { email, source: String(body.source || 'web'), ts: new Date().toISOString() };
  const stored = [];
  const failed = [];
  try {
    const host = req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const form = new URLSearchParams({ 'form-name': 'lead', email, source: rec.source });
    const r = await fetch(proto + '://' + host + '/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    if (r.ok) stored.push('netlify-forms'); else failed.push('netlify-forms');
  } catch { failed.push('netlify-forms'); }
  const hook = (process.env.LEAD_WEBHOOK || '').trim();
  if (hook) {
    const text = 'new signup\nemail: ' + rec.email + '\nsource: ' + rec.source + '\ntime: ' + rec.ts;
    let ok = false;
    const payloads = [
      { name: 'wecom', body: { msgtype: 'text', text: { content: text } } },
      { name: 'feishu', body: { msg_type: 'text', content: { text } } }
    ];
    for (const p of payloads) {
      try {
        const r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.body) });
        if (!r.ok) continue;
        const t = await r.text();
        let good = true;
        try { const j = JSON.parse(t); if (typeof j.errcode === 'number' && j.errcode !== 0) good = false; if (typeof j.code === 'number' && j.code !== 0) good = false; } catch {}
        if (good) { stored.push('webhook:' + p.name); ok = true; break; }
      } catch {}
    }
    if (!ok) failed.push('webhook');
  }
  if (!stored.length) return json({ ok: false, error: 'submit failed, please email us directly' }, 502);
  return json({ ok: true, stored, failed, email: rec.email });
}