// bundle rebuild 20261028-144537
export default async function handler(req) {
  const email = (process.env.LEAD_MAIL || '').trim();
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
  if (!email) return json({ ok: false, error: 'LEAD_MAIL not set' }, 404);
  return json({ ok: true, email });
}



