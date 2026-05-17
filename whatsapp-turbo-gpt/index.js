/**
 * WhatsApp Turbo GPT Bot  –  v2.0.0
 * Original: harshitethic/whatsapp-turbo-gpt
 * Updated & fixed: modern Baileys + OpenAI v4 SDK
 *
 * FIXES:
 *  - Upgraded from openai v3 (Configuration/OpenAIApi) → v4 (new OpenAI class)
 *  - Upgraded from @adiwajshing/baileys → @whiskeysockets/baileys (official fork)
 *  - Fixed connection event handling (now uses 'connection.update' properly)
 *  - Fixed credential saving (now uses 'creds.update')
 *  - Replaced hardcoded API key with .env (dotenv)
 *  - Fixed message extraction (supports text, extendedText, conversation)
 *  - Fixed chat history: per-user in-memory Map instead of a shared JSON file
 *  - Added graceful error handling so the bot doesn't crash on API errors
 *  - Removed broken/outdated packages (crypto, fs, util, inshorts-news-api)
 *  - Fixed QR code display (newer Baileys uses 'connection.update' event)
 *  - Added reconnect logic on disconnect
 */

'use strict';

require('dotenv').config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidDecode,
  proto,
  getContentType,
} = require('@whiskeysockets/baileys');

const OpenAI = require('openai');
const pino   = require('pino');
const chalk  = require('chalk');
const figlet = require('figlet');
const qrcode = require('qrcode-terminal');
const NodeCache = require('node-cache');
const path   = require('path');
const fs     = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG = {
  openaiKey   : process.env.OPENAI_API_KEY   || '',
  model       : process.env.OPENAI_MODEL     || 'gpt-4o',
  maxTokens   : parseInt(process.env.MAX_TOKENS  || '1000', 10),
  systemPrompt: process.env.SYSTEM_PROMPT    || 'You are a helpful WhatsApp assistant. Be concise and friendly.',
  maxHistory  : parseInt(process.env.MAX_HISTORY || '10', 10),
  botName     : process.env.BOT_NAME         || 'WhatsApp GPT Bot',
  authFolder  : './auth_info_baileys',
};

// ─── Validate env ──────────────────────────────────────────────────────────

if (!CONFIG.openaiKey || CONFIG.openaiKey.startsWith('sk-xxx')) {
  console.error(chalk.red('\n[ERROR] OPENAI_API_KEY is not set in your .env file!\n'));
  console.error(chalk.yellow('  1. Copy .env.example to .env'));
  console.error(chalk.yellow('  2. Add your key from https://platform.openai.com/api-keys\n'));
  process.exit(1);
}

// ─── OpenAI client ─────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: CONFIG.openaiKey });

// ─── Conversation history per JID ──────────────────────────────────────────
//     Map<jid, Array<{role, content}>>

const conversations = new Map();

function getHistory(jid) {
  if (!conversations.has(jid)) conversations.set(jid, []);
  return conversations.get(jid);
}

function addToHistory(jid, role, content) {
  const hist = getHistory(jid);
  hist.push({ role, content });
  // Keep only the last N exchanges to avoid token overflow
  if (hist.length > CONFIG.maxHistory * 2) {
    hist.splice(0, 2); // remove oldest user+assistant pair
  }
}

// ─── OpenAI chat completion ─────────────────────────────────────────────────

async function getAIReply(jid, userMessage) {
  addToHistory(jid, 'user', userMessage);

  const messages = [
    { role: 'system', content: CONFIG.systemPrompt },
    ...getHistory(jid),
  ];

  const response = await openai.chat.completions.create({
    model     : CONFIG.model,
    messages,
    max_tokens: CONFIG.maxTokens,
  });

  const reply = response.choices[0]?.message?.content?.trim() || '(no response)';
  addToHistory(jid, 'assistant', reply);
  return reply;
}

// ─── Extract text from any WhatsApp message type ───────────────────────────

function extractMessageText(msg) {
  const content = msg?.message;
  if (!content) return null;

  return (
    content.conversation                                     ||
    content.extendedTextMessage?.text                        ||
    content.imageMessage?.caption                            ||
    content.videoMessage?.caption                            ||
    content.buttonsResponseMessage?.selectedButtonId         ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  );
}

// ─── Banner ────────────────────────────────────────────────────────────────

function printBanner() {
  console.clear();
  console.log(
    chalk.cyan(
      figlet.textSync('WA-GPT Bot', { horizontalLayout: 'fitted' })
    )
  );
  console.log(chalk.green(`  ${CONFIG.botName} – powered by ${CONFIG.model}`));
  console.log(chalk.gray('  ─────────────────────────────────────────\n'));
}

// ─── Main bot function ─────────────────────────────────────────────────────

async function startBot() {
  printBanner();

  // Ensure auth folder exists
  if (!fs.existsSync(CONFIG.authFolder)) {
    fs.mkdirSync(CONFIG.authFolder, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.authFolder);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(chalk.blue(`  Using Baileys v${version.join('.')} (isLatest: ${isLatest})\n`));

  const sock = makeWASocket({
    version,
    logger          : pino({ level: 'silent' }), // change to 'debug' for verbose logs
    printQRInTerminal: false,                     // we print manually for nicer formatting
    auth            : state,
    msgRetryCounterCache: new NodeCache(),
    generateHighQualityLinkPreview: true,
  });

  // ── Save credentials on update ────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection events ─────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(chalk.yellow('\n  Scan this QR code with WhatsApp:\n'));
      qrcode.generate(qr, { small: true });
      console.log(chalk.gray('\n  (WhatsApp → Linked Devices → Link a Device)\n'));
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        chalk.red(`\n  Connection closed. Reason: ${statusCode}`),
        shouldReconnect
          ? chalk.yellow('→ Reconnecting...')
          : chalk.red('→ Logged out. Delete auth_info_baileys/ and restart.')
      );

      if (shouldReconnect) {
        setTimeout(() => startBot(), 3000);
      }
    }

    if (connection === 'open') {
      console.log(chalk.green('\n  ✅ Connected to WhatsApp!\n'));
      console.log(chalk.cyan('  Bot is ready. Send a message to start chatting.\n'));
    }
  });

  // ── Incoming messages ─────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;

    for (const msg of msgs) {
      try {
        // Ignore own messages, status broadcasts, and empty messages
        if (msg.key.fromMe)                         continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const jid  = msg.key.remoteJid;
        const text = extractMessageText(msg);

        if (!text || text.trim() === '') continue;

        const sender = msg.pushName || jid.split('@')[0];
        console.log(chalk.gray(`  [${new Date().toLocaleTimeString()}] `), chalk.white(`${sender}: `), chalk.cyan(text));

        // Show "typing…" indicator
        await sock.sendPresenceUpdate('composing', jid);

        // Get reply from OpenAI
        const reply = await getAIReply(jid, text);

        // Stop "typing" and send reply
        await sock.sendPresenceUpdate('paused', jid);
        await sock.sendMessage(jid, { text: reply }, { quoted: msg });

        console.log(chalk.gray('  [BOT] '), chalk.green(reply.slice(0, 80) + (reply.length > 80 ? '...' : '')));

      } catch (err) {
        console.error(chalk.red('  [ERROR] Failed to process message:'), err.message);

        // Tell the user something went wrong (don't crash)
        try {
          await sock.sendMessage(msg.key.remoteJid, {
            text: '⚠️ Sorry, something went wrong. Please try again in a moment.',
          });
        } catch (_) { /* ignore send failure */ }
      }
    }
  });
}

// ─── Entry point ───────────────────────────────────────────────────────────

startBot().catch((err) => {
  console.error(chalk.red('\n[FATAL]'), err);
  process.exit(1);
});
