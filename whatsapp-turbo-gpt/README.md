# WhatsApp Turbo GPT Bot — v2.0.0

WhatsApp chatbot powered by **OpenAI GPT-4o** and **Baileys** (Node.js).

---

## What was fixed & updated

| Issue | Old | Fixed |
|---|---|---|
| OpenAI SDK | v3 (`Configuration`/`OpenAIApi` – deprecated) | v4 (new `OpenAI` class) |
| Baileys package | `@adiwajshing/baileys` (abandoned) | `@whiskeysockets/baileys` (active fork) |
| API key | Hardcoded in `key.json` | `.env` file (secure) |
| Connection events | Broken with new Baileys | Fixed (`connection.update`) |
| Credential saving | Missing `creds.update` handler | Added |
| Chat history | Shared `chat_history.json` (buggy) | Per-user in-memory Map |
| Reconnect logic | None | Auto-reconnects on disconnect |
| QR code display | Used old event | Fixed with `connection.update` |
| Pino logger | v7 (outdated) | v9 |
| Error handling | Bot would crash on API error | Graceful try/catch per message |
| Unused packages | `crypto`, `fs`, `util`, `inshorts-news-api` | Removed |

---

## Installation

### 1. Clone the repo
```bash
git clone https://github.com/harshitethic/whatsapp-turbo-gpt
cd whatsapp-turbo-gpt
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up your API key
```bash
cp .env.example .env
```
Then open `.env` and paste your OpenAI API key:
```
OPENAI_API_KEY=sk-your-key-here
```
Get your key at: https://platform.openai.com/api-keys

### 4. Run the bot
```bash
node index.js
```

### 5. Scan the QR code
- Open WhatsApp on your phone
- Go to **Settings → Linked Devices → Link a Device**
- Scan the QR code shown in the terminal

---

## Configuration (`.env` options)

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | Model to use (`gpt-4o`, `gpt-3.5-turbo`, etc.) |
| `MAX_TOKENS` | `1000` | Max tokens per reply |
| `SYSTEM_PROMPT` | Helpful assistant | Customize bot personality |
| `MAX_HISTORY` | `10` | Messages to remember per user |
| `BOT_NAME` | `WhatsApp GPT Bot` | Display name in terminal |

---

## Notes

- Session is saved in `auth_info_baileys/` folder. Delete it to log out.
- The bot replies to **all** incoming messages. To restrict to specific numbers, add a whitelist check in `index.js`.
- WhatsApp does not officially support bots — use responsibly.

---

## Requirements

- Node.js **v18+**
- An OpenAI account with API credits
