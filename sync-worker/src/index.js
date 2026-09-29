/* WhenDose sync server (Cloudflare Worker + one Durable Object per family).

   A mailbox for sealed boxes. Each linked phone sends its changes, sealed
   with the family's key on the phone (js/synccrypto.js), and fetches the
   ones it has not seen. This server holds only the sealed blobs, which phone
   sent each (a random id), when, and a hash of the family's access token.
   It never has the key, so it cannot read a name, a medicine or a dose.

     POST /v1/sync/:fid/push       {dev, blobs: [sealed]}      -> {last}
     GET  /v1/sync/:fid/pull?after=N                           -> {items: [{seq, dev, blob}], last, more}

   Authorization: Bearer <token>. The first request for a family sets its
   token; after that only the same token is accepted. Family ids are 128
   random bits, and the token is an HMAC of the family key. */

import { DurableObject } from 'cloudflare:workers';
import { validFid, validDev, validBlobs, bearer, sha256hex, sameHex, pageOf, MAX_FAMILY_CHARS, MAX_BLOBS_PER_PUSH, MAX_BLOB_CHARS } from './lib.js';

const MAX_REQUEST = MAX_BLOBS_PER_PUSH * MAX_BLOB_CHARS + 4096;

export default {
  /** @param {Request} req @param {any} env */
  async fetch(req, env) {
    const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0] || '',
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!origins.includes(origin)) return reply(403, { error: 'origin not allowed' });

    const url = new URL(req.url);
    const m = /^\/v1\/sync\/([^/]+)\/(push|pull)$/.exec(url.pathname);
    if (!m || !validFid(m[1])) return reply(404, { error: 'not found' });
    const token = bearer(req.headers.get('Authorization'));
    if (!token) return reply(401, { error: 'no token' });
    const tokenHash = await sha256hex(token);
    const family = env.FAMILIES.get(env.FAMILIES.idFromName(m[1]));

    if (m[2] === 'pull') {
      if (req.method !== 'GET') return reply(405, { error: 'method not allowed' });
      const after = Number(url.searchParams.get('after') ?? 0);
      if (!Number.isInteger(after) || after < 0) return reply(400, { error: 'bad cursor' });
      const r = await family.pull(tokenHash, after);
      return 'error' in r ? reply(r.status, { error: r.error }) : reply(200, r);
    }

    if (req.method !== 'POST') return reply(405, { error: 'method not allowed' });
    const text = await req.text();
    if (text.length > MAX_REQUEST) return reply(413, { error: 'too large' });
    let body;
    try { body = JSON.parse(text); } catch { return reply(400, { error: 'bad json' }); }
    if (!validDev(body?.dev)) return reply(400, { error: 'bad device id' });
    const checked = validBlobs(body.blobs);
    if ('error' in checked) return reply(400, { error: checked.error });
    const r = await family.push(tokenHash, body.dev, checked.blobs);
    return 'error' in r ? reply(r.status, { error: r.error }) : reply(200, r);
  },
};

export class Family extends DurableObject {
  /** @param {any} ctx @param {any} env */
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, dev TEXT NOT NULL, blob TEXT NOT NULL, at INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  /** The first token sets the family; after that it must match. @param {string} tokenHash */
  authorise(tokenHash) {
    const row = [...this.sql.exec("SELECT v FROM meta WHERE k = 'token'")][0];
    if (!row) { this.sql.exec("INSERT INTO meta (k, v) VALUES ('token', ?)", tokenHash); return true; }
    return sameHex(String(row.v), tokenHash);
  }

  /** @param {string} tokenHash @param {string} dev @param {string[]} blobs */
  async push(tokenHash, dev, blobs) {
    if (!this.authorise(tokenHash)) return { error: 'wrong token', status: 403 };
    const used = Number([...this.sql.exec('SELECT COALESCE(SUM(LENGTH(blob)), 0) AS n FROM changes')][0].n);
    const adding = blobs.reduce((s, b) => s + b.length, 0);
    if (used + adding > MAX_FAMILY_CHARS) return { error: 'family storage full', status: 413 };
    const at = Date.now();
    for (const b of blobs) this.sql.exec('INSERT INTO changes (dev, blob, at) VALUES (?, ?, ?)', dev, b, at);
    return { last: Number([...this.sql.exec('SELECT MAX(seq) AS s FROM changes')][0].s) };
  }

  /** @param {string} tokenHash @param {number} after */
  async pull(tokenHash, after) {
    if (!this.authorise(tokenHash)) return { error: 'wrong token', status: 403 };
    const rows = [...this.sql.exec('SELECT seq, dev, blob FROM changes WHERE seq > ? ORDER BY seq LIMIT 501', after)]
      .map((r) => ({ seq: Number(r.seq), dev: String(r.dev), blob: String(r.blob) }));
    const page = pageOf(rows);
    const last = page.items.length ? page.items[page.items.length - 1].seq : after;
    return { items: page.items, last, more: page.more };
  }
}
