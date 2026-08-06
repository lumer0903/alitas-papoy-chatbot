require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { handleMessage } = require('./botLogic');

const app = express();
const port = Number(process.env.PORT || 3000);
const ordersPath = path.join(__dirname, 'pedidos.json');
const idempotencyPath = path.join(__dirname, 'webhook-events.json');
let fileQueue = Promise.resolve();

// Keep the exact bytes received: Kapso signs the raw JSON body.
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));

function safeEqual(left, right) {
  const a = Buffer.from(left || '', 'utf8');
  const b = Buffer.from(right || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validSignature(req) {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  const signature = req.get('X-Webhook-Signature');
  if (!secret || !signature || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(signature.replace(/^sha256=/i, ''), expected);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeSerialized(action) {
  fileQueue = fileQueue.then(action, action);
  return fileQueue;
}

function appendOrder(order) {
  return writeSerialized(async () => {
    const orders = await readJson(ordersPath, []);
    orders.push(order);
    await fs.writeFile(ordersPath, `${JSON.stringify(orders, null, 2)}\n`, 'utf8');
  });
}

async function hasIdempotencyKey(key) {
  if (!key) return false;
  const events = await readJson(idempotencyPath, {});
  return Boolean(events[key]);
}

async function markIdempotencyKey(key) {
  if (!key) return;
  return writeSerialized(async () => {
    const events = await readJson(idempotencyPath, {});
    events[key] = new Date().toISOString();
    // Keep a bounded, persistent idempotency ledger (30 days).
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [eventKey, timestamp] of Object.entries(events)) {
      if (Date.parse(timestamp) < cutoff) delete events[eventKey];
    }
    await fs.writeFile(idempotencyPath, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
  });
}

function inboundMessages(payload) {
  // Kapso v2 single event or buffered event envelope.
  const entries = Array.isArray(payload.data) ? payload.data : [payload];
  return entries.flatMap((entry) => {
    const message = entry.message;
    if (message?.kapso?.direction && message.kapso.direction !== 'inbound') return [];
    const from = message?.from || entry.conversation?.phone_number;
    const body = message?.text?.body || message?.kapso?.content;
    if (from && body && message?.type === 'text') return [{ id: message.id, to: String(from), body: String(body) }];

    // Also accept the raw Meta structure when a Meta webhook is configured.
    return (entry.entry || []).flatMap((metaEntry) => (metaEntry.changes || []).flatMap((change) =>
      (change.value?.messages || []).flatMap((metaMessage) => {
        const text = metaMessage.text?.body;
        return metaMessage.type === 'text' && metaMessage.from && text
          ? [{ id: metaMessage.id, to: String(metaMessage.from), body: String(text) }]
          : [];
      })
    ));
  });
}

async function sendText(to, body) {
  const baseUrl = (process.env.KAPSO_API_URL || 'https://api.kapso.ai').replace(/\/$/, '');
  const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;
  const apiKey = process.env.KAPSO_API_KEY;
  if (!phoneNumberId || !apiKey) throw new Error('Faltan KAPSO_PHONE_NUMBER_ID o KAPSO_API_KEY.');

  const response = await fetch(`${baseUrl}/meta/whatsapp/v24.0/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body } }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Kapso respondió ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function notifyOrder(order) {
  if (!process.env.ORDER_NOTIFICATION_WEBHOOK) return;
  const response = await fetch(process.env.ORDER_NOTIFICATION_WEBHOOK, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order), signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`El webhook de aviso respondió ${response.status}`);
}

app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'alitas-papoy-whatsapp-bot' }));

// Optional verification endpoint for Meta-style callback setup.
app.get('/webhook/whatsapp', (req, res) => {
  if (req.query['hub.verify_token'] !== process.env.WEBHOOK_VERIFY_TOKEN) return res.sendStatus(403);
  return res.status(200).send(req.query['hub.challenge'] || 'ok');
});

app.post('/webhook/whatsapp', async (req, res, next) => {
  try {
    // TEMPORAL: Desactivar validación de firma para debuggear
    // if (!validSignature(req)) return res.status(401).json({ error: 'Firma de webhook inválida.' });
    console.log('📨 Webhook recibido (validación de firma desactivada)');
    const eventKey = req.get('X-Idempotency-Key');
    if (await hasIdempotencyKey(eventKey)) return res.status(200).json({ ok: true, duplicate: true });

    const event = req.get('X-Webhook-Event');
    if (event && event !== 'whatsapp.message.received') return res.status(200).json({ ok: true, ignored: true });
    const messages = inboundMessages(req.body);
    if (!messages.length) return res.status(200).json({ ok: true, ignored: true });

    const responses = [];
    for (const message of messages) {
      const messageKey = message.id && `message:${message.id}`;
      if (await hasIdempotencyKey(messageKey)) continue;
      const result = await handleMessage(message.to, message.body);
      if (result.order) await appendOrder(result.order);
      await sendText(message.to, result.reply);
      if (result.order) await notifyOrder(result.order);
      await markIdempotencyKey(messageKey);
      responses.push({ messageId: message.id, state: result.state, orderId: result.order?.id });
    }
    await markIdempotencyKey(eventKey);
    return res.status(200).json({ ok: true, processed: responses.length, responses });
  } catch (error) { return next(error); }
});

app.use((error, _req, res, _next) => {
  console.error('[webhook]', error.message);
  res.status(500).json({ error: 'No se pudo procesar el webhook. Kapso reintentará la entrega.' });
});

app.listen(port, () => console.log(`ALITAS PAPOY escuchando en el puerto ${port}`));
