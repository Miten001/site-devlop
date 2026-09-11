"""Saare message templates (Hinglish, HTML parse mode).

Values (bonuses, payout limits, fee %) callers se aate hain — config.py me set hote hain.
Templates `str.format` callables hain: `texts.TASK(title=..., link=..., payout=...)`.
"""

WELCOME = (
    "👋 Namaste {name}!\n\n"
    "Yeh <b>FlexFam Sub4Sub</b> bot hai 🚀\n\n"
    "💰 Dusron ke groups join karke <b>POINTS</b> kamao\n"
    "📣 Points laga kar apne group me <b>MEMBERS</b> pao\n\n"
    "🎁 Signup bonus: <b>+{signup_bonus} points</b>\n"
    "🔗 Dost ko refer karo: <b>+{ref_bonus} points</b>\n"
    "🎁 Roz ka bonus: <b>+{daily_bonus} points</b>\n\n"
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
    "'Get Task' dabao — ek group dikhega, use join karke points kamao! 💰"
).format

TASK = (
    "📢 <b>Is group ko join karo:</b>\n\n"
    "<b>{title}</b>\n"
    "🔗 {link}\n\n"
    "💰 Reward: <b>+{payout} points</b>\n\n"
    "Pehle group join karo, phir <b>✅ Joined</b> dabao — main verify karke points de dunga!"
).format

CLAIM_OK = (
    "🎉 <b>Shabaas!</b> +{payout} points added!\n\n💎 Balance: <b>{balance}</b>"
).format

NOT_JOINED = "❌ Aap abhi tak us group me join nahi hue! Pehle '🔗 Join Group' se join karo, phir '✅ Joined' dabao."

TASK_EXPIRED = "⚠️ Yeh task expire ho gaya. Naya task try karo!"

NO_TASKS = (
    "😕 Abhi aapke liye koi task available nahi hai!\n\n"
    "• Thodi der baad 'Get Task' try karo\n"
    "• 🎁 Daily Bonus / 🔗 Referral se points kamao\n"
    "• Ya khud ➕ Add Group karke members lo"
).format

OWNER_NEW_MEMBER = (
    "👥 <b>+1 Member!</b>\n\n"
    "{name} ne aapka group join kiya:\n📣 {title}\n\n"
    "💰 -{cost} points\n💎 Balance: <b>{balance}</b>"
).format

# ── Add group ───────────────────────────────────────────────────────────
ADD_INTRO = (
    "📣 <b>Apna Group Add Karo</b>\n\n"
    "1️⃣ Mereko apne group me <b>ADMIN</b> banao (warna join verify nahi hoga)\n"
    "2️⃣ Phir group ka public link bhejo — jaise <code>t.me/aapka_group</code>\n\n"
    "🔒 <b>Private group</b> hai? Bot ko admin banao aur neeche <b>✅ Verify</b> dabao.\n\n"
    "⚠️ Limit: max {max_groups} groups per user\n"
    "💎 Aapka balance: <b>{balance}</b>\n\n"
    "<i>/cancel — cancel karne ke liye</i>"
).format

ADD_LINK_INVALID = (
    "❌ Yeh valid group link nahi lag raha.\n\n"
    "Aise bhejo: <code>t.me/aapka_group</code> ya <code>@aapka_group</code>\n\n"
    "Private group hai to bot ko admin add karo aur ✅ Verify dabao."
).format

ADD_NOT_FOUND = (
    "❌ Group nahi mila! Bot us group me admin hai kya? Link check karo, "
    "bot ko admin banao, aur phir se bhejo."
).format

ADD_NOT_ADMIN = (
    "⚠️ Main <b>{title}</b> me admin nahi hun!\n\n"
    "Group settings → Administrators → mereko admin banao, "
    "phir link dobara bhejo ya ✅ Verify dabao."
).format

ADD_ALREADY = "😕 Yeh group pehle se add hua hai (aapne ya kisi aur ne)."

ADD_LIMIT = (
    "⚠️ Aap already {count} groups add kar chuke ho (max {max_groups}).\n\n"
    "📣 My Groups se purana delete karke naya add kar sakte ho."
).format

ADD_ASK_PAYOUT = (
    "✅ Group mil gaya: <b>{title}</b>\n\n"
    "💰 <b>Payout set karo</b> — har join par member ko itne points milenge:\n\n"
    "• Member ko milega: <b>payout</b> points\n"
    "• Aapse katenge: <b>payout + {fee_percent}% fee</b> points per join\n"
    "• Allowed: {min_payout} – {max_payout} (ya khud number type karo)"
).format

ADD_DONE = (
    "🎉 <b>Group add ho gaya!</b>\n\n"
    "📣 {title}\n"
    "🔗 {link}\n"
    "💰 Payout: <b>{payout} pts/join</b> (aapka cost: <b>{cost} pts/join</b>)\n\n"
    "Ab aapka group dusre users ko '💰 Earn Points' me dikhega. "
    "Balance khatam hoga to group automatically pause ho jayega — "
    "task karke balance badhate raho! 💪"
).format

ADD_CANCELLED = "❌ Add Group cancel ho gaya."

PAYOUT_INVALID = (
    "❌ Payout {min_payout} se {max_payout} ke beech hona chahiye. "
    "Number type karo ya buttons use karo."
).format

# ── My groups ───────────────────────────────────────────────────────────
MY_GROUPS_EMPTY = (
    "😕 Aapne abhi koi group add nahi kiya.\n\n➕ Add Group se shuru karo!"
).format

GROUP_INFO = (
    "📣 <b>{title}</b>\n"
    "🔗 {link}\n\n"
    "💰 Payout: <b>{payout} pts/join</b> (aapka cost: {cost})\n"
    "👥 Members mile: <b>{received}</b>\n"
    "{status} {balance_note}"
).format

GRP_PAUSED = "⏸ Paused — task me nahi dikhega.".format
GRP_ACTIVE = "🟢 Active — Earn Points me dikhega.".format
GRP_LOW_BAL = "⚠️ Balance kam hai ({balance}) — top-up karo warna task show nahi hoga!".format
GRP_OK_BAL = "💎 Balance: {balance}".format

GROUP_TOGGLE_DONE = "✅ Done!"
GROUP_DELETED = "🗑 Group delete ho gaya."
GROUP_PAYOUT_ASK = (
    "💸 Naya payout bhejo ({min}–{max} ke beech):"
).format
GROUP_PAYOUT_DONE = (
    "✅ Payout update ho gaya: <b>{payout} pts/join</b> (aapka cost: {cost})"
).format

NOT_YOUR_GROUP = "⚠️ Yeh group aapka nahi hai!"

# ── Bonus / referral / balance ──────────────────────────────────────────
BONUS_OK = (
    "🎁 <b>Daily Bonus!</b> +{amount} points\n\n💎 Balance: <b>{balance}</b>\n\n"
    "Kal phir aana 😄"
).format

BONUS_WAIT = (
    "⏳ Aaj ka bonus le chuke ho! {h}h {m}m baad phir milega.\n\n💎 Balance: <b>{balance}</b>"
).format

REFERRAL = (
    "🔗 <b>Aapka Referral Link</b>\n\n{link}\n\n"
    "Har naya jo is link se aayega: <b>+{bonus} points</b> aapko!\n\n"
    "👥 Total referrals: <b>{count}</b>"
).format

BALANCE = (
    "💎 <b>{name}</b> ka hisaab\n\n"
    "💰 Balance: <b>{balance} points</b>\n"
    "📣 Groups added: <b>{groups}</b>\n"
    "🔗 Groups joined (tasks): <b>{joins}</b>\n"
    "👥 Referrals: <b>{refs}</b>\n\n"
    "Payouts me {fee_percent}% platform fee hai — joiner ko poora payout milta hai."
).format

# ── Help ────────────────────────────────────────────────────────────────
HELP = (
    "ℹ️ <b>FlexFam Sub4Sub — Kaise kaam karta hai</b>\n\n"
    "💰 <b>POINTS KAMAO</b>\n"
    "• 💰 Earn Points → group join karo → ✅ Joined dabao → points pao\n"
    "• 🎁 Daily Bonus → rozana +{daily_bonus} points\n"
    "• 🔗 Referral → har dost par +{ref_bonus} points\n\n"
    "📣 <b>MEMBERS PAO</b>\n"
    "• ➕ Add Group → bot ko group me admin banao → payout set karo\n"
    "• Dusra users aapka group join karenge\n"
    "• Har join par aapse <b>payout + {fee_percent}% fee</b> katenge\n\n"
    "⚠️ <b>RULES</b>\n"
    "• Points lene ke baad group chhoda? Points wapas kat jayenge (checking auto hai)\n"
    "• Bot ko group me ADMIN hona zaroori hai — warna verify nahi hoga\n"
    "• Fake/spam groups = permanent ban 🚫\n\n"
    "Shubh kamai! 🚀"
).format

# ── Admin ───────────────────────────────────────────────────────────────
ADMIN_ONLY = "⚠️ Yeh sirf admins ke liye hai."
ADMIN_PANEL = "🛠 <b>Admin Panel</b>\n\nUsers: <b>{users}</b> | Groups: <b>{groups}</b> | Joins: <b>{joins}</b>".format
ADMIN_STATS = (
    "📊 <b>Stats</b>\n\n"
    "👤 Users: <b>{users}</b> (banned: {banned})\n"
    "📣 Groups: <b>{groups}</b> (active: {active_groups})\n"
    "🤝 Total joins: <b>{joins}</b>\n"
    "💎 Total points in circulation: <b>{points}</b>"
).format
ADMIN_BROADCAST_ASK = "📣 Broadcast message bhejo (text) — sab users ko jayega. /cancel se cancel."
ADMIN_BAN_ASK = "🚫 Ban karne wale user ka ID bhejo (number). /cancel se cancel."
ADMIN_UNBAN_ASK = "✅ Unban karne wale user ka ID bhejo (number). /cancel se cancel."
ADMIN_BROADCAST_DONE = "✅ Broadcast done! {ok}/{total} users ko gaya.".format
ADMIN_BAN_DONE = "🚫 User {uid} ban ho gaya.".format
ADMIN_UNBAN_DONE = "✅ User {uid} unban ho gaya.".format
ADMIN_USER_NOT_FOUND = "❌ User nahi mila."

# ── Misc ────────────────────────────────────────────────────────────────
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
