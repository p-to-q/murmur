# Notifications

Murmur uses three notification layers that intentionally overlap:

1. The in-app inbox in `localStorage` keeps demo-safe history visible inside
   the product.
2. Foreground browser alerts use the Notifications API from the active page.
3. Background system alerts use Web Push, a service worker, and persisted
   browser subscriptions.

## Runtime Path

- `useBrowserNotification()` owns permission, local preference, service-worker
  registration, `PushManager.subscribe()`, and unsubscribe.
- `/api/notifications/push/public-key` returns the configured VAPID public key
  when Web Push is available.
- `/api/notifications/push/subscribe` upserts or disables the current browser's
  subscription for the authenticated user.
- `src/lib/platform/notifications-server.ts` publishes through `web-push`.
  Missing VAPID config returns a skipped result instead of breaking saves or
  local demos.
- `public/murmur-service-worker.js` receives push events, calls
  `showNotification()`, and routes notification clicks back into Murmur.

## Platform Coverage

- Chrome, Edge, Firefox, and Safari on desktop use standard Web Push where the
  browser and OS notification settings allow it.
- macOS Safari supports Web Push through Safari's standards-based service
  worker path.
- iOS and iPadOS require the web app to be installed to the Home Screen before
  Web Push is available.
- Native shells should not reuse browser Web Push blindly. Capacitor/iOS,
  Android, and WeChat MP need platform token adapters behind the same
  notification publisher boundary.

## Config

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

Set:

```bash
WEB_PUSH_PUBLIC_KEY=
WEB_PUSH_PRIVATE_KEY=
WEB_PUSH_SUBJECT=mailto:ops@example.com
```

`WEB_PUSH_SUBJECT` can also be an HTTPS URL. If it is absent, Murmur falls back
to `MURMUR_APP_URL`, then to a local mailto subject for development.

## Product Events

Currently connected events:

- notification test button: publishes to the current user's registered browsers;
- song save: publishes a Gallery deep link after the save succeeds;
- music clip generation: still publishes after each server-side clip request
  succeeds, but sibling clips of one Studio fan-out share a generation batch id
  (the browser sends `x-generation-batch-id` on every clip request). All pushes
  of a batch carry the same notification tag (`murmur-generation-<batchId>`)
  and inbox id (`song_generated:<batchId>`), so the OS shows one notification
  per batch — each clip silently replaces the previous — and the inbox keeps a
  single entry. When the batch settles, the client posts the final "N of M
  ready" summary under the same tag and id, replacing the per-clip placeholder;
- daily digest cron: publishes to active web push subscriptions when configured.

## Generation Batch Semantics (decision 2026-07, issue #166)

Batch generation is **foreground-orchestrated with hybrid notifications**:

- The browser fans one hum out into three parallel `/api/music/generate`
  requests and audio streams back into the live tab. This stays the primary
  low-latency creative path; the batch id adds no server state or latency.
- Notifications are batch-level from the user's point of view (shared batch
  tag plus the client's final batch summary), even though delivery stays
  per-clip best effort underneath.
- Closing the browser is **not** promised to finish work: a disconnected clip
  request is cancelled on the worker and refunded, so nothing completes — and
  nothing notifies — after the tab dies. Web push only bridges the
  hidden/suspended-tab gap while the requests stay alive.
- A durable server-side queue (`POST /api/music/batches`, durable clip
  storage, resume via `/studio?batch=...`) is deliberately deferred. If added,
  it would replace the collapsed per-clip pushes with a single durable
  batch-completion publish and make the browser-exit promise real.
