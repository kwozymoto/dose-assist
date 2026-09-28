/* WhenDose reminder server (Cloudflare Worker + Durable Object).

   A dumb clock. For each phone it holds a list of (time, ciphertext) and
   sends each ciphertext to that phone's push service when its time comes.

   What it knows: a push endpoint (a random URL the browser made) and when
   to send. What it cannot know: anything in the messages. The phone
   encrypts every notification to its own push keys before sending the
   schedule here (js/webpush.js in the app), and this worker never holds
   those keys. No names, medicines, doses or children reach it.

     PUT    /v1/schedule   {endpoint, items: [{id, fireAt, body}]}  replace the whole schedule
     DELETE /v1/schedule   {endpoint}                               forget this phone

   Knowing the endpoint is the only authorisation: the same thing that lets
   a push service reach the phone. Endpoints are unguessable and only the
   phone has its own. */

import { DurableObject } from 'cloudflare:workers';
import { validEndpoint, validItems, sha256hex, vapidAuth, dueItems, unb64url } from './lib.js';

const MAX_REQUEST = 400000;
const RETRY_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export default {
  /** @param {Request} req @param {any} env */
  async fetch(req, env) {
    const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0] || '',
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!origins.includes(origin)) return reply(403, { error: 'origin not allowed' });
    if (new URL(req.url).pathname !== '/v1/schedule') return reply(404, { error: 'not found' });
    if (req.method !== 'PUT' && req.method !== 'DELETE') return reply(405, { error: 'method not allowed' });

    const text = await req.text();
    if (text.length > MAX_REQUEST) return reply(413, { error: 'too large' });
    let body;
    try { body = JSON.parse(text); } catch { return reply(400, { error: 'bad json' }); }
    if (!validEndpoint(body?.endpoint)) return reply(400, { error: 'endpoint is not a known push service' });

    const stub = env.DEVICES.get(env.DEVICES.idFromName(await sha256hex(body.endpoint)));
    if (req.method === 'DELETE') {
      await stub.clear();
      return reply(200, { deleted: true });
    }
    const checked = validItems(body.items, Date.now());
    if ('error' in checked) return reply(400, { error: checked.error });
    await stub.replace(body.endpoint, checked.items);
    return reply(200, { ok: true, items: checked.items.length });
  },
};

export class DeviceSchedule extends DurableObject {
  /** @param {string} endpoint @param {{id: string, fireAt: number, body: string}[]} items */
  async replace(endpoint, items) {
    await this.ctx.storage.put('endpoint', endpoint);
    await this.ctx.storage.put('items', items);
    await this.arm(items);
  }

  async clear() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** @param {{fireAt: number, attempts?: number}[]} items */
  async arm(items) {
    if (items.length === 0) { await this.ctx.storage.deleteAlarm(); return; }
    const next = Math.min(...items.map((i) => (i.attempts ? Date.now() + RETRY_MS : i.fireAt)));
    await this.ctx.storage.setAlarm(Math.max(next, Date.now()));
  }

  async alarm() {
    const endpoint = await this.ctx.storage.get('endpoint');
    /** @type {{id: string, fireAt: number, body: string, attempts?: number}[]} */
    const items = (await this.ctx.storage.get('items')) ?? [];
    if (!endpoint || items.length === 0) return;
    const { due, later } = dueItems(items, Date.now());
    const keep = [...later];
    const jwk = JSON.parse(this.env.VAPID_PRIVATE_JWK);
    /** @type {number[]} */
    const statuses = [];
    for (const it of due) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidAuth(endpoint, jwk, this.env.VAPID_SUBJECT, Date.now()),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '3600',
          Urgency: 'high',
          Topic: it.id.slice(0, 32),
        },
        body: unb64url(it.body),
      });
      statuses.push(res.status);
      if (res.status === 404 || res.status === 410) {
        // The phone unsubscribed or the subscription expired: forget it all.
        console.log(`alarm: push service said ${res.status}; schedule cleared`);
        await this.clear();
        return;
      }
      if ((res.status === 429 || res.status >= 500) && (it.attempts ?? 0) < MAX_ATTEMPTS) {
        keep.push({ ...it, attempts: (it.attempts ?? 0) + 1 });
      }
    }
    // Counts and status codes only. Nothing about content is known here to log.
    console.log(`alarm: sent ${due.length} (${statuses.join(', ')}), ${keep.length} waiting`);
    await this.ctx.storage.put('items', keep);
    await this.arm(keep);
  }
}
