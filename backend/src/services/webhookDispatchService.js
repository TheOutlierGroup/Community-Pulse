import { createHmac } from 'crypto';
import * as WebhookEndpoint from '../models/WebhookEndpoint.js';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 4000, 8000];
const DISPATCH_TIMEOUT_MS = 10000;

function signPayload(signingSecret, body) {
  return createHmac('sha256', signingSecret).update(body).digest('hex');
}

async function attemptDeliver(endpoint, eventName, payloadBody, payloadObj, attempt) {
  const sig = signPayload(endpoint.signing_secret, payloadBody);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  let responseStatus = null;
  let errorDetail = null;
  let delivered = false;
  const dispatchedAt = new Date();

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pulse-Event': eventName,
        'X-Pulse-Signature': `sha256=${sig}`,
        'X-Pulse-Attempt': String(attempt),
      },
      body: payloadBody,
      signal: controller.signal,
    });
    responseStatus = res.status;
    delivered = res.ok;
    if (!res.ok) errorDetail = `HTTP ${res.status}`;
  } catch (err) {
    errorDetail = err.name === 'AbortError' ? 'timeout' : String(err.message || err);
  } finally {
    clearTimeout(timer);
  }

  await WebhookEndpoint.logDispatch(endpoint.id, eventName, payloadObj, {
    attempt,
    status: delivered ? 'delivered' : attempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
    responseStatus,
    errorDetail,
    dispatchedAt,
  });

  return delivered;
}

async function deliverWithRetry(endpoint, eventName, payloadObj) {
  const payloadBody = JSON.stringify(payloadObj);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 2]));
    }
    const ok = await attemptDeliver(endpoint, eventName, payloadBody, payloadObj, attempt);
    if (ok) return;
  }
}

/**
 * Fire outbound webhooks for `eventName` to all active subscribed endpoints
 * for the given organization. Fully asynchronous — never throws, never blocks
 * the caller. Individual delivery failures are logged to webhook_dispatch_log.
 */
export function dispatchEvent(organizationId, eventName, data = {}) {
  const payload = {
    event: eventName,
    organization_id: organizationId,
    created_at: new Date().toISOString(),
    data,
  };

  // Intentionally not awaited — fire and forget
  WebhookEndpoint.listActiveEndpointsForEvent(organizationId, eventName)
    .then((endpoints) => Promise.allSettled(endpoints.map((ep) => deliverWithRetry(ep, eventName, payload))))
    .catch((err) => console.error('[webhook] dispatch error', eventName, err?.message));
}
