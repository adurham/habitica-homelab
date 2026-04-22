import axios from 'axios';

// Web Push subscribe/unsubscribe helpers (self-host addition).
//
// The flow:
//   1. getStatus() → calls /api/v3/status/web-push for the VAPID public key.
//   2. currentSubscription() → asks the already-registered SW for its PushSubscription, if any.
//   3. subscribe() → requests permission, subscribes via PushManager, POSTs to server.
//   4. unsubscribe() → unsubscribes via PushManager, POSTs endpoint to server for removal.

export const isSupported = () => (
  typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
);

function urlBase64ToUint8Array (base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getStatus () {
  const { data } = await axios.get('/api/v3/status/web-push');
  return data.data;
}

export async function currentSubscription () {
  if (!isSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function serializeSubscription (sub) {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

export async function subscribe (label = '') {
  if (!isSupported()) throw new Error('Web Push not supported in this browser.');

  const status = await getStatus();
  if (!status.enabled || !status.publicKey) {
    throw new Error('Web Push is not configured on this server.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission denied.');

  const reg = await navigator.serviceWorker.ready;

  // Re-use any existing subscription for this browser. PushManager.subscribe
  // is idempotent if called with the same applicationServerKey.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(status.publicKey),
    });
  }

  const body = { ...serializeSubscription(sub), label };
  await axios.post('/api/v3/user/web-push/subscribe', body);
  return sub;
}

export async function unsubscribe () {
  if (!isSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try {
    await axios.post('/api/v3/user/web-push/unsubscribe', { endpoint: sub.endpoint });
  } finally {
    // Always tear down the browser-side subscription even if the server call
    // failed — keeps the toggle honest.
    await sub.unsubscribe();
  }
}
