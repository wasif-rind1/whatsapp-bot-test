"use strict";
require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const Groq = require("groq-sdk");
const pino = require("pino");
const chalk = require("chalk");
const qrcode = require("qrcode-terminal");
const NodeCache = require("node-cache");
const fs = require("fs");

const CONFIG = {
  groqKey: process.env.GROQ_API_KEY || "",
  model: "llama-3.1-8b-instant",
  systemPrompt: "You are a helpful WhatsApp assistant made by Wasif Rind. When someone asks who made you or who you are, tell them you were created by Wasif Rind. Be concise and friendly.",
  maxHistory: 10,
  authFolder: "./auth_info_baileys",
};

if (!CONFIG.groqKey) {
  console.error("\n[ERROR] GROQ_API_KEY is not set in .env file!\n");
  process.exit(1);
}

const groq = new Groq({ apiKey: CONFIG.groqKey });
const conversations = new Map();

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
  const sock = makeWASocket({ version, logger: pino({ level: "silent" }), printQRInTerminal: true, auth: state, msgRetryCounterCache: new NodeCache() });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) { setTimeout(() => startBot(), 3000); }
    }
    if (connection === "open") { console.log("Connected to WhatsApp! Bot is ready!"); }
  });
  sock.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
    if (type !== "notify") return;
    for (const msg of msgs) {
      try {
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === "status@broadcast") continue;
        const jid = msg.key.remoteJid;
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
