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
- music clip generation: publishes a Studio deep link after each server-side
  clip request succeeds;
- daily digest cron: publishes to active web push subscriptions when configured.

The Studio batch is still orchestrated by browser requests. If the browser
exits before submitting or keeping those requests alive, Murmur has no durable
server-side batch job to finish. A future queue can promote the existing music
publisher call from per-clip best effort to durable batch completion.
