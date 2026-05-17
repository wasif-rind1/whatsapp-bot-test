import dotenv from "dotenv";
dotenv.config();
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import Groq from "groq-sdk";
import pino from "pino";
import qrcode from "qrcode-terminal";
import NodeCache from "node-cache";
import fs from "fs";
import http from "http";

const CONFIG = {
  groqKey: process.env.GROQ_API_KEY || "",
  model: "llama-3.1-8b-instant",
  systemPrompt: "You are a helpful WhatsApp assistant made by Wasif Rind. When someone asks who made you, tell them you were created by Wasif Rind.when someone message you first,always introduce yourself by saying 'wasif rind is currently offline i am his assistant bot - how can i help you?' Be concise and friendly.",
  maxHistory: 10,
  authFolder: "./auth_info_baileys",
};

if (!CONFIG.groqKey) { console.error("GROQ_API_KEY not set!"); process.exit(1); }

const groq = new Groq({ apiKey: CONFIG.groqKey });
const conversations = new Map();
let lastQR = "";

http.createServer((req, res) => {
  res.writeHead(200, {"Content-Type": "text/html"});
  if (lastQR) {
    res.end(`<html><body style="text-align:center;font-family:sans-serif"><h2>WhatsApp Bot QR Code</h2><p>Scan with WhatsApp to connect</p><img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(lastQR)}"/><p style="color:gray">Made by Wasif Rind</p></body></html>`);
  } else {
    res.end("<html><body style='text-align:center;font-family:sans-serif'><h2>Bot is already connected!</h2><p>No QR needed</p></body></html>");
  }
}).listen(process.env.PORT || 3000, () => {
  console.log("Web server started on port " + (process.env.PORT || 3000));
});

function getHistory(jid) {
  if (!conversations.has(jid)) conversations.set(jid, []);
  return conversations.get(jid);
}

async function getAIReply(jid, userMessage) {
  const history = getHistory(jid);
  history.push({ role: "user", content: userMessage });
  if (history.length > CONFIG.maxHistory * 2) history.splice(0, 2);
  const messages = [{ role: "system", content: CONFIG.systemPrompt }, ...history];
  const response = await groq.chat.completions.create({ model: CONFIG.model, messages, max_tokens: 1000 });
  const reply = response.choices[0]?.message?.content?.trim() || "Sorry, no response.";
  history.push({ role: "assistant", content: reply });
  return reply;
}

function extractMessageText(msg) {
  const content = msg?.message;
  if (!content) return null;
  return content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || null;
}

async function startBot() {
  console.log("WhatsApp Groq Bot Starting...");
  if (!fs.existsSync(CONFIG.authFolder)) fs.mkdirSync(CONFIG.authFolder, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.authFolder);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, logger: pino({ level: "silent" }), printQRInTerminal: false, auth: state, msgRetryCounterCache: new NodeCache() });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { lastQR = qr; console.log("QR code updated - open web URL to scan"); }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) { setTimeout(() => startBot(), 3000); }
    }
    if (connection === "open") { lastQR = ""; console.log("Connected to WhatsApp! Bot is ready!"); }
  });
  sock.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
    if (type !== "notify") return;
    for (const msg of msgs) {
      try {
        if (msg.key.fromMe == true) continue;
        if (msg.key.remoteJid === "status@broadcast") continue;
        const jid = msg.key.remoteJid;
        if (jid === "923272616116@s.whatsapp.net") continue;
        const text = extractMessageText(msg);
        if (!text || text.trim() === "") continue;
        const sender = msg.pushName || jid.split("@")[0];
        console.log(`[${new Date().toLocaleTimeString()}] ${sender}: ${text}`);
        await sock.sendPresenceUpdate("composing", jid);
        const reply = await getAIReply(jid, text);
        await sock.sendPresenceUpdate("paused", jid);
        await sock.sendMessage(jid, { text: reply }, { quoted: msg });
      } catch (err) {
        console.error("[ERROR]", err.message);
        try { await sock.sendMessage(msg.key.remoteJid, { text: "Sorry, something went wrong." }); } catch (_) {}
      }
    }
  });
}

startBot().catch((err) => { console.error("[FATAL]", err); process.exit(1); });
