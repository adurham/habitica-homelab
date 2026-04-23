# Self-host patches — `adurham/habitica-homelab`

This fork of [`awinterstein/habitica`](https://github.com/awinterstein/habitica)
(which rebases `HabitRPG/habitica`) carries the code patches needed to run a
private Habitica instance. All self-host work lives on the `self-host-local`
branch, which rebases onto `awinterstein/habitica:self-host` nightly.

This doc describes **what this fork changes vs. upstream**. Deployment (Proxmox
LXC, Ansible, Tailscale Serve, env wiring) lives in the consumer's infra repo,
not here.

## CI

| Workflow | Purpose |
| --- | --- |
| `.github/workflows/build.yml` | Build + push `ghcr.io/adurham/habitica-server` on every `self-host-local` push. Uses built-in `GITHUB_TOKEN`. |
| `.github/workflows/rebase-upstream.yml` | Nightly (02:38 UTC) rebase onto `awinterstein/habitica:self-host`, which rebases onto `HabitRPG/habitica:release` ~1 h earlier. |
| `.github/workflows/test.yml` | Upstream test suite. |

Deleted `release.yml` — we don't cut GitHub releases from this fork.

## 1. Web Push (VAPID) — `fe70477`

The official Habitica mobile apps are hardcoded to `habitica.com` and won't
talk to a self-hosted server. Upstream's push path only implements APNs + FCM,
both of which require Apple/Google developer creds tied to those apps. This
adds a parallel Web Push path that works for PWAs on iOS 16.4+, Chrome,
Firefox, and Edge — no developer account needed.

**Server**
- `website/server/models/webPushSubscription.js` — new model.
- `website/server/models/user/schema.js` — `webPushSubscriptions` field on User.
- `website/server/controllers/api-v3/pushNotifications.js` —
  `POST /user/web-push/subscribe`, `POST /user/web-push/unsubscribe`.
- `website/server/controllers/api-v3/status.js` — `GET /status/web-push`
  returns `{enabled, publicKey}` so the client bootstraps VAPID without the
  private key ever reaching the browser.
- `website/server/libs/pushNotifications.js` — `sendWebPushNotification`
  fans out alongside APNs/FCM in `sendNotification`. 410/404 from the push
  service removes the stale subscription from Mongo (self-healing).
- `package.json` — adds `web-push` v3.6.7.

**Client**
- `website/client/public/sw.js` — push + notificationclick handlers.
- `website/client/src/main.js` — registers `/sw.js` on window load.
- `website/client/src/libs/webPush.js` — `isSupported / getStatus /
  subscribe / unsubscribe / currentSubscription` helpers.
- `website/client/src/pages/settings/notificationSettings.vue` —
  **Browser push notifications** toggle row. Renders whenever the server
  has VAPID configured, even on iOS Safari without PWA install — in that
  case the row shows a "Add to Home Screen" hint and the toggle is
  disabled until `PushManager` becomes available.

**Required env**
```
WEB_PUSH_VAPID_PUBLIC_KEY=<base64url>
WEB_PUSH_VAPID_PRIVATE_KEY=<base64url>
WEB_PUSH_VAPID_SUBJECT=mailto:admin@example.com
```

Generate a keypair with `npx web-push generate-vapid-keys`. Rotating the
keypair invalidates all existing subscriptions (users re-opt-in from the
settings row).

**Gotcha — Apple APNs `topic`:** `web.push.apple.com` rejects
`webpush.sendNotification(sub, payload, { topic: "..." })` with
`BadWebPushTopic`. Leave `topic` unset. `TTL` and `urgency` are accepted.
A 201 with an `apns-id` header means the gateway has queued for delivery —
delivery to device depends on OS-side permissions and Focus mode.

## 2. Service worker scope fix — `5da780a`

Webpack writes `sw.js` into `website/client/dist/` (root of the built bundle).
The default static middleware only serves `/static/*`, so `/sw.js` 404'd.
Added an explicit Express route in `website/server/middlewares/static.js`
that serves the file with:

- `Service-Worker-Allowed: /` — required for the SW's registration scope to
  cover the whole app, not a subtree.
- `Cache-Control: no-cache` — SW updates roll out on next page load
  instead of getting pinned for a year like the rest of `/static/*`.

## 3. iOS Safari row visibility — `e3209d6`

`webPush.isSupported()` checks `'serviceWorker' in navigator && 'PushManager'
in window && 'Notification' in window`. On iOS Safari pre-PWA-install,
`PushManager` is absent, so the check fails. The original
`notificationSettings.vue` `mounted()` gated the server status probe behind
that check — so the row vanished, hiding the very hint users needed ("Add
to Home Screen, then come back").

Fix: probe the server regardless of browser support. Only call the
browser-side subscription API when `PushManager` is actually present. The
toggle stays disabled in unsupported environments, but the row and its
install hint render.

## 4. Mobile / PWA fixes

All PWA polish lives in `website/client/src/assets/scss/page.scss` and a
handful of per-component files, gated on `@media (max-width: 576px)`.

| Commit | Subject |
| --- | --- |
| `cc5ad63` | Initial round — sidebar, header menu, memberDetails, viewport meta. |
| `c9e55de` | Settings page width (was fixed 751 px → overflow); login overflow. |
| `a415730` | Force 16 px font on inputs so iOS Safari stops auto-zooming. |
| `6f02310` | `autocapitalize="none"` on username / email inputs. |
| `f4d6cfb` | Email + Push toggle columns stack side-by-side on narrow viewports. |
| `c061059` | Web Push row UX + page-wide `overflow-x: hidden` safety net. |
| `3660413` | Round 4 — header dropdowns (auto-close on route change, only inner toggle stops propagation), chat action chevrons, home hero. |
| `500e958` | Static pages (contact / faq / overview), shops, messages audit. |
| `03fe11b` | Featured shop items overflow + customizations sidebar + group-plans. |
| `848bfa4` | Force single-row layout for quests shop featured items. |
| `c0b7ceb` | Bump `.dropdown-item` vertical padding to 12 px on phones (48 pt touch targets — Apple HIG minimum is 44 pt). Fixes mis-taps on Settings / Subscription / Profile in the user dropdown. |

Non-obvious patterns:
- `tr:has(td.email_push_col)` for notification-settings 3-cell rows so the
  label spans full width and the two toggles sit side-by-side under their
  column headers on mobile.
- `.standard-page` sets `max-width: 100vw; overflow-x: hidden` as a
  page-level safety net — individual children (esp. shop featured banners)
  sometimes render wider than the viewport, and catching it at the page
  root is cheaper than hunting every child.
- `customMenuDropdown.vue` watches `$route` to auto-close on navigation
  and only the inner toggle div stops click propagation — the outer
  wrapper does not, so iOS synthetic clicks on dropdown items propagate
  cleanly to `router-link`.
