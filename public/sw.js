/**
 * Tunearr service worker.
 *
 * Push delivery only: it renders notifications and routes clicks back into the
 * app. Nothing is precached on purpose — Tunearr updates by pulling a new image,
 * and a stale asset cache would outlive the deploy that replaced it.
 */

const DEFAULT_TITLE = "Tunearr";
const DEFAULT_ICON = "/logo192.png";

function readPayload(event) {
  if (!event.data) {
    return { title: DEFAULT_TITLE, body: "" };
  }

  try {
    return event.data.json();
  } catch {
    return { title: DEFAULT_TITLE, body: event.data.text() };
  }
}

function findClient(clientList, url) {
  const target = new URL(url, self.location.origin).href;
  return (
    clientList.find((client) => client.url === target) ?? clientList[0] ?? null
  );
}

async function openTarget(url) {
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  const existing = findClient(clientList, url);
  if (existing) {
    await existing.focus();
    if ("navigate" in existing) {
      await existing.navigate(url);
    }
    return;
  }

  await self.clients.openWindow(url);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = readPayload(event);

  event.waitUntil(
    self.registration.showNotification(payload.title ?? DEFAULT_TITLE, {
      body: payload.body ?? "",
      icon: payload.icon ?? DEFAULT_ICON,
      badge: DEFAULT_ICON,
      tag: payload.eventId,
      data: { url: payload.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTarget(event.notification.data?.url ?? "/"));
});
