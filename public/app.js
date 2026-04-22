function qs(id) {
  return document.getElementById(id);
}

function showTab(which) {
  const adminTab = qs("adminTab");
  const agentTab = qs("agentTab");
  const tabs = document.querySelectorAll(".tab");

  tabs.forEach((t) => t.classList.remove("active"));

  if (which === "admin") {
    adminTab.classList.remove("hidden");
    agentTab.classList.add("hidden");
    tabs[0].classList.add("active");
  } else {
    agentTab.classList.remove("hidden");
    adminTab.classList.add("hidden");
    tabs[1].classList.add("active");
  }
}

async function loginAdmin() {
  const user = qs("adminUser").value.trim();
  const pass = qs("adminPass").value.trim();

  const res = await fetch("/api/login", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ user, pass, role: "admin" })
  });

  const data = await res.json();
  if (!res.ok) return qs("loginMsg").textContent = data.error;
  location.href = data.redirect;
}

async function loginAgent() {
  const profileSlug = qs("agentProfile").value.trim();
  const pass = qs("agentPass").value.trim();

  const res = await fetch("/api/login", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ profileSlug, pass, role: "agent" })
  });

  const data = await res.json();
  if (!res.ok) return qs("loginMsg").textContent = data.error;
  location.href = data.redirect;
}

async function createProfile() {
  const payload = {
    name: qs("p_name").value,
    agentName: qs("p_agentName").value,
    agentPhone: qs("p_agentPhone").value,
    agentPass: qs("p_agentPass").value,
    twilioNumber: qs("p_twilioNumber").value
  };

  const res = await fetch("/api/profiles", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  qs("adminMsg").textContent = data.ok ? "Perfil creado correctamente" : data.error;
  if (data.ok) {
    qs("p_name").value = "";
    qs("p_agentName").value = "";
    qs("p_agentPhone").value = "";
    qs("p_twilioNumber").value = "";
    loadProfiles();
  }
}

async function loadProfiles() {
  const box = qs("profilesList");
  if (!box) return;

  const res = await fetch("/api/profiles");
  const data = await res.json();

  box.innerHTML = "";
  data.forEach((p) => {
    const div = document.createElement("div");
    div.className = "profile-item";
    div.innerHTML = `
      <strong>${p.name}</strong><br>
      Telefonista: ${p.agentName || "-"}<br>
      Número Twilio: ${p.twilioNumber || "-"}<br>
      Slug: ${p.slug}<br>
      Clave telefonista: ${p.agentPass}<br>
      Link telefonista: <a href="/agent.html?profile=${p.slug}" target="_blank">abrir</a>
    `;
    box.appendChild(div);
  });
}

function getProfileFromUrl() {
  const params = new URLSearchParams(location.search);
  return params.get("profile") || "";
}

async function loadAgentMessages() {
  const profile = getProfileFromUrl();
  const chatBox = qs("chatBox");
  if (!chatBox) return;

  const res = await fetch(`/api/messages?profile=${encodeURIComponent(profile)}`);
  const data = await res.json();

  chatBox.innerHTML = "";
  data.forEach(renderMessage);

  const title = qs("agentTitle");
  if (title) title.textContent = `Telefonista - ${profile}`;
}

function renderMessage(m) {
  const chatBox = qs("chatBox");
  if (!chatBox) return;

  const div = document.createElement("div");
  div.className = `msg-item ${m.direction === "incoming" ? "msg-in" : "msg-out"}`;
  div.innerHTML = `
    <strong>${m.direction === "incoming" ? "Cliente" : "Telefonista"}</strong><br>
    De: ${m.from}<br>
    Para: ${m.to}<br>
    Mensaje: ${m.body}<br>
    Fecha: ${new Date(m.createdAt).toLocaleString()}
  `;
  chatBox.appendChild(div);
}

async function sendMessage() {
  const profileSlug = getProfileFromUrl();
  const to = qs("sendTo").value.trim();
  const body = qs("sendBody").value.trim();

  const res = await fetch("/api/messages/send", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ profileSlug, to, body })
  });

  const data = await res.json();
  qs("agentMsg").textContent = data.ok ? "Mensaje enviado" : data.error;

  if (data.ok) {
    qs("sendBody").value = "";
    loadAgentMessages();
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function enablePushForAgent() {
  const profileSlug = getProfileFromUrl();
  const msgBox = qs("agentMsg");

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    msgBox.textContent = "Este dispositivo no soporta push.";
    return;
  }

  const settingsRes = await fetch("/api/settings");
  const settings = await settingsRes.json();

  if (!settings.vapidPublicKey) {
    msgBox.textContent = "Faltan configurar claves push en el servidor.";
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    msgBox.textContent = "Debes permitir notificaciones.";
    return;
  }

  const registration = await navigator.serviceWorker.register("/sw.js");

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(settings.vapidPublicKey)
    });
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      profileSlug,
      subscription
    })
  });

  const data = await res.json();
  msgBox.textContent = data.ok
    ? "Notificaciones activadas correctamente."
    : (data.error || "No se pudo activar push.");
}

window.addEventListener("DOMContentLoaded", () => {
  if (location.pathname.includes("admin.html")) {
    loadProfiles();
  }

  if (location.pathname.includes("agent.html")) {
    loadAgentMessages();

    const socket = io();
    const profile = getProfileFromUrl();
    socket.emit("join:profile", profile);

    socket.on("message:new", (msg) => {
      if (msg.profileSlug === profile) {
        renderMessage(msg);
      }
    });

    const enableBtn = document.createElement("button");
    enableBtn.textContent = "ACTIVAR NOTIFICACIONES";
    enableBtn.style.marginTop = "10px";
    enableBtn.onclick = enablePushForAgent;

    const box = document.querySelector(".card");
    if (box) box.appendChild(enableBtn);
  }
});