self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" ? payload.title : "Murmur";
  const options = {
    body: typeof payload.body === "string" ? payload.body : undefined,
    icon: typeof payload.icon === "string" ? payload.icon : "/icon.png",
    badge: typeof payload.badge === "string" ? payload.badge : "/brand/murmur-app-icon-120-rounded.png",
    tag: typeof payload.tag === "string" ? payload.tag : "murmur-notification",
    renotify: false,
    data: payload.data && typeof payload.data === "object" ? payload.data : {},
  };

  event.waitUntil((async () => {
    await notifyOpenClients({
      title,
      body: options.body,
      href: typeof options.data.href === "string" ? options.data.href : undefined,
      kind: typeof options.data.kind === "string" ? options.data.kind : "system",
      sourceId:
        typeof options.data.sourceId === "string"
          ? options.data.sourceId
          : typeof options.data.songId === "string"
            ? options.data.songId
            : typeof options.data.requestId === "string"
              ? options.data.requestId
              : typeof options.data.publishId === "string"
                ? options.data.publishId
                : undefined,
      publishId: typeof options.data.publishId === "string" ? options.data.publishId : undefined,
      createdAt: Date.now(),
    });
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const target =
    typeof data.url === "string"
      ? data.url
      : typeof data.href === "string"
        ? data.href
        : "/";
  const url = safeSameOriginUrl(target);

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client && client.url.startsWith(self.location.origin)) {
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(url);
        }
        return;
      }
    }
    await clients.openWindow(url);
  })());
});

async function notifyOpenClients(payload) {
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (client.url.startsWith(self.location.origin)) {
      client.postMessage({ type: "murmur:notification", payload });
    }
  }
}

function safeSameOriginUrl(target) {
  try {
    const url = new URL(target, self.location.origin);
    if (url.origin !== self.location.origin) return self.location.origin + "/";
    return url.href;
  } catch {
    return self.location.origin + "/";
  }
}
