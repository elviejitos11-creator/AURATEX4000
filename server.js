const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const twilio = require("twilio");
const webpush = require("web-push");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 4000;
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

const profilesFile = path.join(DATA_DIR, "profiles.json");
const messagesFile = path.join(DATA_DIR, "messages.json");
const settingsFile = path.join(DATA_DIR, "settings.json");
const pushSubscriptionsFile = path.join(DATA_DIR, "pushSubscriptions.json");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

function ensureFile(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), "utf8");
  }
}
require('dotenv').config();
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

ensureFile(profilesFile, []);
ensureFile(messagesFile, []);
ensureFile(pushSubscriptionsFile, []);
ensureFile(settingsFile, {
  appName: "AURATEX",
  adminUser: "admin",
  adminPass: "1234"
});

/* =========================================================
   AQUI VAS A PEGAR TU SID Y TU TOKEN DE TWILIO
   SOLO REEMPLAZA LOS TEXTOS ENTRE COMILLAS
   ========================================================= */
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
/* =========================================================
   CLAVES PUSH
   SI TODAVIA NO LAS TIENES, DEJALAS ASI POR AHORA
   ========================================================= */

const VAPID_PUBLIC_KEY = "PEGA_AQUI_TU_VAPID_PUBLIC_KEY";
const VAPID_PRIVATE_KEY = "PEGA_AQUI_TU_VAPID_PRIVATE_KEY";

if (
  VAPID_PUBLIC_KEY !== "PEGA_AQUI_TU_VAPID_PUBLIC_KEY" &&
  VAPID_PRIVATE_KEY !== "PEGA_AQUI_TU_VAPID_PRIVATE_KEY"
) {
  webpush.setVapidDetails(
    "mailto:admin@auratex.local",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

let twilioClient = null;
if (
  TWILIO_ACCOUNT_SID !== "PEGA_AQUI_TU_ACCOUNT_SID" &&
  TWILIO_AUTH_TOKEN !== "PEGA_AQUI_TU_AUTH_TOKEN"
) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function now() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function sendPushToProfile(profileSlug, payload) {
  if (
    VAPID_PUBLIC_KEY === "PEGA_AQUI_TU_VAPID_PUBLIC_KEY" ||
    VAPID_PRIVATE_KEY === "PEGA_AQUI_TU_VAPID_PRIVATE_KEY"
  ) {
    return;
  }

  let subscriptions = readJson(pushSubscriptionsFile);
  const profileSubs = subscriptions.filter((s) => s.profileSlug === profileSlug);

  const invalidEndpoints = [];

  for (const sub of profileSubs) {
    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
    } catch (error) {
      console.log("Push fallo:", error.statusCode || error.message);
      if (error.statusCode === 404 || error.statusCode === 410) {
        invalidEndpoints.push(sub.subscription.endpoint);
      }
    }
  }

  if (invalidEndpoints.length > 0) {
    subscriptions = subscriptions.filter(
      (s) => !invalidEndpoints.includes(s.subscription.endpoint)
    );
    writeJson(pushSubscriptionsFile, subscriptions);
  }
}

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.get("/api/settings", (req, res) => {
  const settings = readJson(settingsFile);
  res.json({
    ...settings,
    vapidPublicKey:
      VAPID_PUBLIC_KEY !== "PEGA_AQUI_TU_VAPID_PUBLIC_KEY" ? VAPID_PUBLIC_KEY : ""
  });
});

app.post("/api/login", (req, res) => {
  const { user, pass, role, profileSlug } = req.body;
  const settings = readJson(settingsFile);
  const profiles = readJson(profilesFile);

  if (role === "admin") {
    if (user === settings.adminUser && pass === settings.adminPass) {
      return res.json({ ok: true, role: "admin", redirect: "/admin.html" });
    }
    return res.status(401).json({ ok: false, error: "Credenciales admin incorrectas" });
  }

  if (role === "agent") {
    const profile = profiles.find(
      (p) => p.slug === profileSlug && p.agentPass === pass && p.active
    );

    if (!profile) {
      return res.status(401).json({ ok: false, error: "Acceso de telefonista incorrecto" });
    }

    return res.json({
      ok: true,
      role: "agent",
      redirect: `/agent.html?profile=${profile.slug}`,
      profile
    });
  }

  res.status(400).json({ ok: false, error: "Rol no valido" });
});

app.get("/api/profiles", (req, res) => {
  const profiles = readJson(profilesFile);
  res.json(profiles);
});

app.post("/api/profiles", (req, res) => {
  const profiles = readJson(profilesFile);

  const name = (req.body.name || "").trim();
  const agentName = (req.body.agentName || "").trim();
  const agentPhone = (req.body.agentPhone || "").trim();
  const agentPass = (req.body.agentPass || "1234").trim();
  const twilioNumber = (req.body.twilioNumber || "").trim();

  if (!name) {
    return res.status(400).json({ ok: false, error: "Nombre del perfil requerido" });
  }

  let slug = slugify(name);
  if (!slug) slug = createId("perfil");

  if (profiles.some((p) => p.slug === slug)) {
    slug = `${slug}-${Math.floor(Math.random() * 999)}`;
  }

  const profile = {
    id: createId("profile"),
    name,
    slug,
    agentName,
    agentPhone,
    agentPass,
    twilioNumber,
    active: true,
    createdAt: now()
  };

  profiles.push(profile);
  writeJson(profilesFile, profiles);

  res.json({ ok: true, profile });
});

app.put("/api/profiles/:slug", (req, res) => {
  const profiles = readJson(profilesFile);
  const idx = profiles.findIndex((p) => p.slug === req.params.slug);

  if (idx === -1) {
    return res.status(404).json({ ok: false, error: "Perfil no encontrado" });
  }

  profiles[idx] = {
    ...profiles[idx],
    name: req.body.name ?? profiles[idx].name,
    agentName: req.body.agentName ?? profiles[idx].agentName,
    agentPhone: req.body.agentPhone ?? profiles[idx].agentPhone,
    agentPass: req.body.agentPass ?? profiles[idx].agentPass,
    twilioNumber: req.body.twilioNumber ?? profiles[idx].twilioNumber,
    active: typeof req.body.active === "boolean" ? req.body.active : profiles[idx].active
  };

  writeJson(profilesFile, profiles);
  res.json({ ok: true, profile: profiles[idx] });
});

app.get("/api/messages", (req, res) => {
  const messages = readJson(messagesFile);
  const profile = req.query.profile || "";
  if (!profile) return res.json(messages);
  res.json(messages.filter((m) => m.profileSlug === profile));
});

app.post("/api/messages/send", async (req, res) => {
  try {
    const { profileSlug, to, body } = req.body;

    if (!profileSlug || !to || !body) {
      return res.status(400).json({ ok: false, error: "Faltan datos" });
    }

    const profiles = readJson(profilesFile);
    const messages = readJson(messagesFile);
    const profile = profiles.find((p) => p.slug === profileSlug);

    if (!profile) {
      return res.status(404).json({ ok: false, error: "Perfil no encontrado" });
    }

    let twilioSid = null;

    if (twilioClient && profile.twilioNumber) {
      const response = await twilioClient.messages.create({
        body,
        from: profile.twilioNumber,
        to
      });
      twilioSid = response.sid;
    }

    const msg = {
      id: createId("msg"),
      profileSlug,
      from: profile.twilioNumber || "telefonista",
      to,
      body,
      direction: "outgoing",
      createdAt: now(),
      twilioSid
    };

    messages.push(msg);
    writeJson(messagesFile, messages);

    io.emit("message:new", msg);

    res.json({ ok: true, msg });
  } catch (error) {
    console.log("Error enviando mensaje:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/push/subscribe", (req, res) => {
  const { profileSlug, subscription } = req.body;

  if (!profileSlug || !subscription || !subscription.endpoint) {
    return res.status(400).json({ ok: false, error: "Suscripcion invalida" });
  }

  const subscriptions = readJson(pushSubscriptionsFile);

  const exists = subscriptions.find(
    (s) =>
      s.profileSlug === profileSlug &&
      s.subscription &&
      s.subscription.endpoint === subscription.endpoint
  );

  if (!exists) {
    subscriptions.push({
      id: createId("push"),
      profileSlug,
      subscription,
      createdAt: now()
    });
    writeJson(pushSubscriptionsFile, subscriptions);
  }

  res.json({ ok: true });
});

app.post("/webhook/incoming", async (req, res) => {
  const from = req.body.From || "";
  const to = req.body.To || "";
  const body = req.body.Body || "";

  const profiles = readJson(profilesFile);
  const messages = readJson(messagesFile);

  const profile = profiles.find((p) => p.twilioNumber === to);

  const msg = {
    id: createId("msg"),
    profileSlug: profile ? profile.slug : "sin-perfil",
    from,
    to,
    body,
    direction: "incoming",
    createdAt: now()
  };

  messages.push(msg);
  writeJson(messagesFile, messages);

  io.emit("message:new", msg);

  if (profile) {
    await sendPushToProfile(profile.slug, {
      title: "Nuevo mensaje",
      body: `${from}: ${body || "Te escribieron"}`,
      url: `/agent.html?profile=${profile.slug}`
    });
  }

  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");
});

io.on("connection", (socket) => {
  socket.on("join:profile", (profileSlug) => {
    socket.join(profileSlug);
  });
});

server.listen(PORT, () => {
  console.log("====================================");
  console.log(`AURATEX corriendo en http://localhost:${PORT}`);
  console.log("Admin: http://localhost:4000/login.html");
  console.log("Webhook Twilio: /webhook/incoming");
  console.log("====================================");
});