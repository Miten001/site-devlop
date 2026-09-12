"""Hinglish message templates (HTML parse mode)."""

WELCOME = (
    "👋 Namaste {name}!\n\n"
    "Yeh <b>FlexFam Sub4Sub</b> bot hai 🚀\n\n"
    "💰 Dusron ke groups/channels join karke <b>POINTS</b> kamao\n"
    "📣 Points laga kar apne task me <b>MEMBERS / VIEWS</b> pao\n\n"
    "🔗 Dost ko refer karo: <b>+{ref_bonus} points</b>\n\n"
    "Neeche ke menu buttons se shuru karo 👇"
).format

WELCOME_BACK = (
    "👋 Wapas aaye {name}! 💎 Balance: <b>{balance} points</b>\n\n"
    "Menu se kaam chuno 👇"
).format

REF_JOINED = (
    "🎉 Aapke referral <b>{name}</b> ne bot join kiya!\n"
    "💰 +{bonus} points — Balance: <b>{balance}</b>"
).format

BANNED = "🚫 Aap is bot se ban ho chuke ho. Koi sawaal ho to admin se contact karo."

EARN_INTRO = (
    "🎯 <b>Earn Points</b>\n\n"
    "Available tasks: <b>{count}</b>\n\n"
    "'Get Task' dabao — group/channel join ya post task complete karke points kamao! 💰"
).format

TASK = (
    "📢 <b>Is {kind} ko join karo:</b>\n\n"
    "<b>{title}</b>\n"
    "🔗 {link}\n\n"
    "💰 Reward: <b>+{payout} points</b>\n\n"
    "Pehle join karo, phir <b>✅ Joined</b> dabao — main Telegram se verify karunga!"
).format

POST_TASK = (
    "📌 <b>{kind} task</b>\n\n"
    "<b>{title}</b>\n"
    "🔗 {link}\n\n"
    "💰 Reward: <b>+{payout} points</b>\n"
    "⏱ Link open karke <b>Start Timer</b> dabao. Timer ke baad claim karna!"
).format

TIMER_STARTED = "⏱ Timer start ho gaya! {seconds} seconds baad claim kar sakte ho."
TIMER_CLAIM_READY = (
    "✅ Timer complete! Ab <b>Claim Points</b> dabao.\n\n"
    "💰 Reward: <b>+{payout} points</b>"
).format
TIMER_NOT_STARTED = "⏱ Pehle <b>Start Timer</b> dabao."
TIMER_EARLY = "⏳ Abhi {seconds} seconds baaki hain. Jaldi claim nahi kar sakte!"

CLAIM_OK = (
    "🎉 <b>Shabaas!</b> +{payout} points added!\n\n💎 Balance: <b>{balance}</b>"
).format

NOT_JOINED = "❌ Aap abhi tak us group/channel me join nahi hue! Pehle link se join karo, phir '✅ Joined' dabao."
TASK_EXPIRED = "⚠️ Yeh task expire ho gaya. Naya task try karo!"

NO_TASKS = (
    "😕 Abhi aapke liye koi task available nahi hai!\n\n"
    "• Thodi der baad 'Get Task' try karo\n"
    "• 🔗 Referral se points kamao\n"
    "• Ya khud ➕ Add Task karke members/views lo"
).format

OWNER_NEW_MEMBER = (
    "👥 <b>+1 Member!</b>\n\n"
    "{name} ne aapka task complete kiya:\n📣 {title}\n\n"
    "💰 -{cost} points\n💎 Balance: <b>{balance}</b>"
).format

FEATURED = (
    "🌟 <b>Featured FlexFam Group</b>\n\n"
    "<b>FlexFam</b> join karo aur <b>+{payout} points</b> pao!\n\n"
    "Ye onboarding reward sirf ek baar milega. Join karke ✅ Joined dabao."
).format
FEATURED_CLAIM_OK = (
    "🌟 Featured group verified!\n\n"
    "🎉 +{payout} points added!\n💎 Balance: <b>{balance}</b>"
).format

# ── Add task ────────────────────────────────────────────────────────────
ADD_INTRO = (
    "➕ <b>Add Task</b>\n\n"
    "Task type choose karo:\n"
    "👥 Group / 📣 Channel — real Telegram membership verify hoga\n"
    "👁 View / ❤️ Reaction — post open karke {timer}s timer complete karo\n\n"
    "⚠️ Limit: max {max_groups} tasks per user\n"
    "💎 Aapka balance: <b>{balance}</b>"
).format

ADD_LINK_PROMPT = (
    "{emoji} <b>{label} task</b>\n\n"
    "{instruction}\n\n"
    "<i>/cancel — cancel karne ke liye</i>"
).format

ADD_LINK_INVALID = (
    "❌ Yeh valid public group/channel link nahi lag raha.\n\n"
    "Aise bhejo: <code>t.me/aapka_group</code> ya <code>@aapka_group</code>."
).format

ADD_POST_INVALID = (
    "❌ Valid post link bhejo: <code>t.me/channel_name/123</code>\n"
    "(channel name aur message ID zaroori hai; double slash nahi.)"
).format

ADD_TYPE_MISMATCH = "❌ Chosen task type aur Telegram chat type match nahi karte. Dobara link bhejo."
ADD_NOT_FOUND = "❌ Group/channel nahi mila! Link check karo aur bot ko zaroori access do."
ADD_NOT_ADMIN = (
    "⚠️ Main <b>{title}</b> me admin nahi hun!\n\n"
    "Mujhe admin banao, phir link dobara bhejo ya ✅ Verify dabao."
).format
ADD_ALREADY = "😕 Yeh task pehle se add hua hai (aapne ya kisi aur ne)."
ADD_LIMIT = (
    "⚠️ Aap already {count} tasks add kar chuke ho (max {max_groups}).\n\n"
    "📣 My Groups se purana delete karke naya add kar sakte ho."
).format
ADD_ASK_PAYOUT = (
    "✅ <b>{kind}</b> mil gaya: <b>{title}</b>\n\n"
    "💰 Har completion par member ko <b>{min_payout}–{max_payout}</b> points milenge.\n"
    "Fee: <b>{fee_percent}%</b> (production me fee zero hai).\n"
    "{funding_note}"
).format
ADD_FUNDS_REQUIRED = (
    "❌ Is View/Reaction task ka <b>{cost} points</b> reward add karte waqt reserve hota hai.\n"
    "Aapka balance: <b>{balance}</b>. Pehle points kamao."
).format
ADD_DONE = (
    "🎉 <b>Task add ho gaya!</b>\n\n"
    "📣 {title}\n"
    "🔗 {link}\n"
    "💰 Payout: <b>{payout} pts</b> (cost: <b>{cost} pts</b>)\n\n"
    "Ab yeh task dusre users ko '💰 Earn Points' me dikhega."
).format
ADD_CANCELLED = "❌ Add Task cancel ho gaya."
PAYOUT_INVALID = (
    "❌ Payout {min_payout} se {max_payout} ke beech hona chahiye."
).format

# ── My tasks ────────────────────────────────────────────────────────────
MY_GROUPS_EMPTY = "😕 Aapne abhi koi task add nahi kiya.\n\n➕ Add Task se shuru karo!"
GROUP_INFO = (
    "📣 <b>{title}</b>\n"
    "🔗 {link}\n\n"
    "🏷 Type: <b>{task_type}</b>\n"
    "💰 Payout: <b>{payout} pts</b> (cost: {cost})\n"
    "👥 Completions: <b>{received}</b>\n"
    "{status} {balance_note}"
).format
GRP_PAUSED = "⏸ Paused — task me nahi dikhega."
GRP_ACTIVE = "🟢 Active — Earn Points me dikhega."
GRP_LOW_BAL = "⚠️ Balance kam hai ({balance}) — task show nahi hoga!"
GRP_OK_BAL = "💎 Balance: {balance}"
GROUP_TOGGLE_DONE = "✅ Done!"
GROUP_DELETED = "🗑 Task delete ho gaya."
GROUP_PAYOUT_ASK = "💸 Naya payout bhejo ({min}–{max} ke beech):"
GROUP_PAYOUT_DONE = "✅ Payout update ho gaya: <b>{payout} pts</b> (cost: {cost})".format
NOT_YOUR_GROUP = "⚠️ Yeh task aapka nahi hai!"

# ── legacy daily / referral / balance ──────────────────────────────────
BONUS_OK = "🎁 Bonus +{amount} points\n\n💎 Balance: <b>{balance}</b>".format
BONUS_WAIT = "⏳ Bonus cooldown.\n\n💎 Balance: <b>{balance}</b>".format
REFERRAL = (
    "🔗 <b>Aapka Referral Link</b>\n\n{link}\n\n"
    "Har naya user: <b>+{bonus} points</b> aapko!\n\n"
    "👥 Total referrals: <b>{count}</b>"
).format
BALANCE = (
    "💎 <b>{name}</b> ka hisaab\n\n"
    "💰 Balance: <b>{balance} points</b>\n"
    "📣 Tasks added: <b>{groups}</b>\n"
    "🔗 Tasks completed: <b>{joins}</b>\n"
    "👥 Referrals: <b>{refs}</b>\n\n"
    "Platform fee: <b>{fee_percent}%</b>."
).format

HELP = (
    "ℹ️ <b>FlexFam Sub4Sub — Kaise kaam karta hai</b>\n\n"
    "💰 <b>POINTS KAMAO</b>\n"
    "• Earn Points → join/view task complete karo → points pao\n"
    "• Referral → har dost par +{ref_bonus} points\n\n"
    "📣 <b>TASK ADD KARO</b>\n"
    "• Add Task → Group/Channel ya View/Reaction chuno\n"
    "• Group/Channel membership Telegram API se verify hoti hai\n"
    "• View/Reaction me post kholo → 30 second timer → claim\n\n"
    "⚠️ Group/channel chhodne par 72h me points wapas liye ja sakte hain.\n"
    "View/reaction completions par leave reversal nahi hota."
).format

# ── Admin / misc ────────────────────────────────────────────────────────
ADMIN_ONLY = "⚠️ Yeh sirf admins ke liye hai."
ADMIN_PANEL = "🛠 <b>Admin Panel</b>\n\nUsers: <b>{users}</b> | Tasks: <b>{groups}</b> | Joins: <b>{joins}</b>".format
ADMIN_STATS = (
    "📊 <b>Stats</b>\n\n"
    "👤 Users: <b>{users}</b> (banned: {banned})\n"
    "📣 Tasks: <b>{groups}</b> (active: {active_groups})\n"
    "🤝 Total completions: <b>{joins}</b>\n"
    "💎 Total points: <b>{points}</b>"
).format
ADMIN_BROADCAST_ASK = "📣 Broadcast message bhejo (text) — sab users ko jayega. /cancel se cancel."
ADMIN_BAN_ASK = "🚫 Ban karne wale user ka ID bhejo (number). /cancel se cancel."
ADMIN_UNBAN_ASK = "✅ Unban karne wale user ka ID bhejo (number). /cancel se cancel."
ADMIN_BROADCAST_DONE = "✅ Broadcast done! {ok}/{total} users ko gaya.".format
ADMIN_BAN_DONE = "🚫 User {uid} ban ho gaya.".format
ADMIN_UNBAN_DONE = "✅ User {uid} unban ho gaya.".format
ADMIN_USER_NOT_FOUND = "❌ User nahi mila."
CANCELLED = "❌ Cancel ho gaya."
UNKNOWN = "🤔 Menu ke buttons use karo ya /help dabao."
ERROR = "😵 Kuch error aa gaya. Thodi der baad try karo."
LEAVE_REVERSED = (
    "⚠️ Aapne <b>{title}</b> chhod diya — {payout} points wapas liye gaye!\n\n"
    "💎 Balance: <b>{balance}</b>"
).format
LEAVE_REFUND = (
    "♻️ <b>Refund!</b> Ek member ne <b>{title}</b> chhod diya.\n"
    "💰 +{cost} points wapas — Balance: <b>{balance}</b>"
).format
GROUP_AUTO_PAUSED = (
    "⏸ <b>{title}</b> automatically pause ho gaya (bot ka access gaya ya balance khatam).\n"
    "Balance: <b>{balance}</b> — top-up karke 📣 My Groups se resume karo."
).format
