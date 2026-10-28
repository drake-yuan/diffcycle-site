// bundle rebuild 20261028-144949
export default async function handler(req) {
  const email = (process.env.LEAD_MAIL || '').trim();
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
  if (!email) return json({ ok: false, error: 'LEAD_MAIL not set [v2 2026-10-28]' }, 404);
  return json({ ok: true, email, build: '2026-10-28' });
}




