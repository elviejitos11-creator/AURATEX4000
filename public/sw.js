self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {
    title: "AURATEX",
    body: "Nuevo mensaje",
    url: "/login.html"
  };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (error) {}

  event.waitUntil(
    self.registration.showNotification(data.title || "AURATEX", {
      body: data.body || "Nuevo mensaje",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: {
        url: data.url || "/login.html"
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/login.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});