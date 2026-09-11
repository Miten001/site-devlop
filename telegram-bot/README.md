# 🤖 FlexFam Sub4Sub Bot (Telegram)

Telegram bot jisme users **ek dusre ke groups join karke points kamate hain**, aur wahi points laga kar **apne group me members** paate hain — sub for sub! 🔁

> Python 3.9+ · [python-telegram-bot v22](https://python-telegram-bot.org) · SQLite (zero-config)

---

## ✨ Features

| | |
|---|---|
| 💰 **Earn Points** | Task dikhao → group join karo → `✅ Joined` dabao → bot **khud verify** karta hai (Telegram API se) → points! |
| 📣 **Add Group** | Apna group promote karo — payout (5–50 pts/join) set karo, dusre users join karte rahenge |
| ✅ **Auto verification** | Bot group me **admin** rehta hai, isliye har join asli hai (fake claim fail ho jata hai) |
| 🔁 **Anti-leave protection** | Background job har 30 min joins re-check karta hai — group chhoda to **points wapas kat** jate hain aur owner ko **refund** milta hai |
| 🎁 **Daily bonus** | Roz +10 points |
| 🔗 **Referral system** | Har referral par +25 points (deep-link `?start=ref_`) |
| 💸 **Auto-pause** | Owner ka balance khatam ya bot ka access gaya → group automatically pause, owner ko notification |
| 🛠 **Admin panel** | Stats, broadcast, ban/unban, `/setpoints` |
| 🗄 **SQLite** | Koi extra DB server nahi chahiye — `data/bot.db` sab store karta hai |

### 💎 Points Economy

```
Naya user       → +50 signup bonus
Group join      → joiner ko +payout points
                → owner se katate hain payout + 20% fee points
Daily bonus     → +10 (24h cooldown)
Referral        → +25 per dost
Group chhodna   → payout wapas kat jata hai (72h window me checking)
```

Fee `.env` se badal sakte ho (`FEE_PERCENT`).

---

## 🚀 Setup (5 minute)

### 1. Bot banao
1. Telegram me [@BotFather](https://t.me/BotFather) ko `/newbot` bhejo
2. Naam + username do → **token** copy karo

### 2. Apna user ID lo
[@userinfobot](https://t.me/userinfobot) ko `/start` bhejo → jo ID aaye wo `ADMIN_IDS` me daalne hai.

### 3. Chalao

```bash
cd telegram-bot
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# .env edit karo — BOT_TOKEN aur ADMIN_IDS bharo

python bot.py
```

Bas! Bot live hai 🎉 — ab test karo:

1. Apne **test group** me bot ko **admin** banao
2. Bot me `➕ Add Group` → `t.me/your_test_group` link bhejo → payout chuno
3. Dusre account se `💰 Earn Points` → task aayega → join karke `✅ Joined` dabao
4. Points add ho gaye + owner ko member notification 🎊

> ⚠️ **Zaroori:** Bot ko us group me **ADMIN** hona chahiye jise promote karna hai — warna join verify nahi hoga. Private groups bhi support hain (bot admin banao → `✅ Verify` dabao).

---

## ☁️ Deploy

### Railway / Render (easiest)
1. Repo connect karo, **root directory**: `telegram-bot/`
2. Start command: `python bot.py` (ya Procfile `worker` type)
3. Env vars: `BOT_TOKEN`, `ADMIN_IDS`
4. Persistent disk mount karo path `telegram-bot/data` par (warna restart par DB reset hogi)

### Docker

```bash
docker build -t flexfam-bot ./telegram-bot
docker run -d --env-file telegram-bot/.env -v flexfam_data:/app/data flexfam-bot
```

### VPS (systemd)

```ini
# /etc/systemd/system/flexfam-bot.service
[Unit]
Description=FlexFam Sub4Sub Bot
After=network.target

[Service]
WorkingDirectory=/opt/flexfam/telegram-bot
EnvironmentFile=/opt/flexfam/telegram-bot/.env
ExecStart=/opt/flexfam/telegram-bot/.venv/bin/python bot.py
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## 🧩 Structure

```
telegram-bot/
├── bot.py          # entry point — run_polling
├── handlers.py     # saare commands/callbacks/conversation/job
├── db.py           # SQLite layer (users, groups, joins)
├── keyboards.py    # reply + inline keyboards
├── texts.py        # saare messages (Hinglish)
├── config.py       # .env se settings
└── data/bot.db     # database (auto-create)
```

## 🤖 User Flow (short)

```
/start → +50 pts → 💰 Earn Points → 🎯 Get Task
  → 🔗 Join Group → ✅ Joined → bot verify → +points 💰

➕ Add Group → bot ko group me admin banao → link/verify
  → payout chuno (5–50) → aapka group sabko task me dikhega
  → har naye member par points katenge, balance khatam = auto-pause
```

## ⚠️ Notes

- Telegram **bots directly members add nahi kar sakte** — isliye members **join link/task** se aate hain (yehi sub4sub ka standard tarika hai, aur ye Telegram rules ke andar hai).
- Agar points lene ke baad member group chhod de to system uske points wapas le leta hai — gaming-proof rakhne ke liye `LEAVE_CHECK_HOURS` adjust kar sakte ho.
- Spam/fake groups ke liye admin ban system hai (`🛠 Admin Panel`).
