# 🤖 FlexFam Sub4Sub Bot (Telegram)

Telegram bot jisme users **ek dusre ke groups join karke points kamate hain**, aur wahi points laga kar **apne group me members** paate hain — sub for sub! 🔁

> Python 3.9+ · [python-telegram-bot v22](https://python-telegram-bot.org) · SQLite (zero-config)

---

## ✨ Features

| | |
|---|---|
| 💰 **Earn Points** | Task dikhao → group/channel join, post view/reaction ya **Bot Start** karo → verify → points! |
| ➕ **Add Task** | Group, Channel, View, Reaction ya **Bot Start** task chuno; payout 5–50 set karo |
| ✅ **Auto verification** | Group/channel joins `getChatMember` se verify hote hain (member, administrator, creator) |
| ⏱ **View / Reaction** | `t.me/channel/123` post task → Start Timer → 30 seconds → claim |
| 🌟 **Featured onboarding** | Har naya user ko `https://t.me/flex_fam` pe ek baar +10 points; 2 din baad unclaimed task re-show |
| 🔁 **Anti-leave protection** | Background job group/channel joins re-check karta hai — chhodne par points wapas aur owner ko refund |
| 🔗 **Referral system** | Har referral par +25 points (deep-link `?start=ref_`) |
| 💸 **Auto-pause** | Owner ka balance khatam ya bot ka access gaya → group automatically pause, owner ko notification |
| ⏭ **Dead-task warning** | Jo task 15 baar lagataar skip ho aur ek bhi completion na ho → auto-pause + owner ko warning strike (1/3, 2/3…). 3 strikes par owner ke **saare** tasks pause + admins ko alert |
| ♾ **No task limit** | `MAX_GROUPS_PER_USER=0` (default) — user jitne chahe tasks add kar sakta hai |
| 🛠 **Admin panel** | Stats, broadcast, ban/unban, `/setpoints`, `/clearstrikes` |
| 🗄 **SQLite** | Koi extra DB server nahi chahiye — `data/bot.db` sab store karta hai |

### 💎 Points Economy

```
Naya user       → +0 signup bonus
Group/channel   → joiner ko +payout points, owner se sirf payout
Bot Start       → starter ko +payout points, owner se payout (fresh forwarded bot reply se verify)
View/reaction   → add karte waqt owner se payout reserve, timer ke baad +payout
Featured group  → system user (id 0) se +10 points, ek baar per user
Referral        → +25 per dost
Group/channel chhodna → payout wapas (72h window me checking)
View/reaction/bot-start → reversal nahi
```

### ⏭ Dead-task protection

```
Task skip hua             → skip streak +1
Task complete hua         → skip streak reset (task hamesha ke liye "alive")
Streak == 15 (0 comp.)    → task auto-pause + owner ko strike (1/3)
Owner ki 3 strikes        → owner ke saare tasks pause + admins ko alert
Owner ne task resume kiya → skip streak reset, auto-pause flag clear
Warning DM par buttons    → ▶️ Resume Task / 💸 Change Payout / 🗑 Delete
/clearstrikes <user_id>   → admin owner ki strikes maaf kar sakta hai
```

Tuning: `DEAD_TASK_SKIP_LIMIT` (default 15), `DEAD_TASK_MAX_STRIKES` (default 3).
`DEAD_TASK_SKIP_LIMIT=0` se ye poora system off ho jata hai.

Production fee `FEE_PERCENT=0` hai: owner se sirf payout katega. Limits aur
featured settings `.env` se override ki ja sakti hain.

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
2. Bot me `➕ Add Task` → Group/Channel/View/Reaction/Bot Start chuno → link/post link/bot username bhejo → payout chuno
3. Dusre account se `💰 Earn Points` → task aayega → join/complete karke claim karo
4. Group/channel membership Telegram API se verify hoti hai; View/Reaction me 30s timer ke baad reward milta hai 🎊

> ⚠️ **Zaroori:** Bot ko us group me **ADMIN** hona chahiye jise promote karna hai — warna join verify nahi hoga. Private groups bhi support hain (bot admin banao → `✅ Verify` dabao).

---

## ☁️ Deploy

### GitHub Actions pe FREE 24/7 (recommended — repo public hai)

Repo me `.github/workflows/telegram-bot.yml` already set hai! Bas:

1. **[Settings → Secrets and variables → Actions](https://github.com/Miten001/site-devlop/settings/secrets/actions)** kholo
2. **New repository secret** → Name: `BOT_TOKEN` → Value: apna bot token → Add
3. *(Optional, admin panel ke liye)* Ek aur secret: `ADMIN_IDS` = aapka Telegram user ID
4. Bas! Har 5 min cron khud check karta hai — 5 min ke andar bot live ho jata hai

**Kaise kaam karta hai:**
- Har run bot ko ~5.5 ghante chalata hai, phir agla scheduled run turant utha leta hai (24/7 chain)
- DB (users/points) har 10 min **encrypt** hokar `bot-state` branch pe sync hoti hai — key `BOT_TOKEN` se banti hai, isliye public repo me data safe
- Naya run start hone par DB restore hoti hai → points kabhi lost nahi hote
- ⚠️ Token change kiya toh purani DB decrypt nahi hogi (naye token ke saath fresh start)

### Railway / Render
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
├── texts.py        # saare messages (English)
├── config.py       # .env se settings
└── data/bot.db     # database (auto-create)
```

## 🤖 User Flow (short)

```
/start → +50 pts → 💰 Earn Points → 🎯 Get Task
  → 🔗 Join Group → ✅ Joined → bot verify → +points 💰

➕ Add Task → Group/Channel/View/Reaction chuno
  → payout chuno (5–50) → task sabko dikhega
  → group/channel completion par payout katega; View/Reaction reward add par reserve hota hai
```

## ⚠️ Notes

- Telegram **bots directly members add nahi kar sakte** — isliye members **join link/task** se aate hain (yehi sub4sub ka standard tarika hai, aur ye Telegram rules ke andar hai).
- Agar points lene ke baad member group chhod de to system uske points wapas le leta hai — gaming-proof rakhne ke liye `LEAVE_CHECK_HOURS` adjust kar sakte ho.
- Spam/fake groups ke liye admin ban system hai (`🛠 Admin Panel`).
