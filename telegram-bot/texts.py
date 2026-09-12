"""English message templates (HTML parse mode)."""

WELCOME = (
    "👋 Hello {name}!\n\n"
    "This is the <b>FlexFam Sub4Sub</b> bot 🚀\n\n"
    "💰 Earn <b>POINTS</b> by joining other people's groups/channels\n"
    "📣 Spend those points to get <b>MEMBERS / VIEWS</b> on your own task\n\n"
    "🔗 Refer a friend: <b>+{ref_bonus} points</b>\n\n"
    "Use the menu buttons below to get started 👇"
).format

WELCOME_BACK = (
    "👋 Welcome back {name}! 💎 Balance: <b>{balance} points</b>\n\n"
    "Pick something from the menu 👇"
).format

REF_JOINED = (
    "🎉 Your referral <b>{name}</b> just joined the bot!\n"
    "💰 +{bonus} points — Balance: <b>{balance}</b>"
).format

BANNED = "🚫 You have been banned from this bot. Contact an admin if you have questions."

EARN_INTRO = (
    "🎯 <b>Earn Points</b>\n\n"
    "Available tasks: <b>{count}</b>\n\n"
    "Tap 'Get Task' — complete a group/channel join or a post task and earn points! 💰"
).format

TASK = (
    "📢 <b>Join this {kind}:</b>\n\n"
    "<b>{title}</b>\n"
    "🔗 {link}\n\n"
    "💰 Reward: <b>+{payout} points</b>\n\n"
    "Join first, then tap <b>✅ Joined</b> — I will verify it with Telegram!"
).format

POST_TASK = (
    "📌 <b>{kind} task</b>\n\n"
    "<b>{title}</b>\n"
    "🔗 {link}\n\n"
    "💰 Reward: <b>+{payout} points</b>\n"
    "⏱ Open the link and tap <b>Start Timer</b>. Claim once the timer is done!"
).format

BOT_TASK = (
    "🤖 <b>Bot Start task</b>\n\n"
    "<b>{title}</b>\n"
    "🔗 {link}\n\n"
    "💰 Reward: <b>+{payout} points</b>\n\n"
    "1️⃣ Open the bot with the link above and tap <b>/start</b>\n"
    "2️⃣ <b>Forward the reply</b> that bot sends you back here\n"
    "3️⃣ I will verify the forwarded message and pay you! ✅"
).format

FORWARD_NOT_BOT = (
    "❌ This message was not forwarded from a bot.\n\n"
    "Send /start to the task bot, then <b>forward its reply here</b>."
)
FORWARD_NO_TASK = (
    "😕 No active task found for this bot (@{username}).\n\n"
    "💰 Get a task from Earn Points first, then forward that bot's message."
).format
FORWARD_OWN_TASK = "⚠️ You cannot complete your own task!"
FORWARD_TOO_OLD = (
    "⌛️ This forwarded message is too old. Send /start to the bot now and "
    "forward its fresh reply."
)
BOT_CLAIM_OK = (
    "🤖 <b>Bot Start verified!</b>\n\n"
    "🎉 +{payout} points added!\n💎 Balance: <b>{balance}</b>"
).format
BOT_CLAIM_HINT = "🤖 Send /start to the bot and forward its reply here — that is the verification."

TIMER_STARTED = "⏱ Timer started! You can claim after {seconds} seconds."
TIMER_CLAIM_READY = (
    "✅ Timer complete! Now tap <b>Claim Points</b>.\n\n"
    "💰 Reward: <b>+{payout} points</b>"
).format
TIMER_NOT_STARTED = "⏱ Tap <b>Start Timer</b> first."
TIMER_EARLY = "⏳ {seconds} seconds left. You cannot claim early!"

CLAIM_OK = (
    "🎉 <b>Well done!</b> +{payout} points added!\n\n💎 Balance: <b>{balance}</b>"
).format

NOT_JOINED = (
    "❌ You have not joined that group/channel yet! Join with the link first, "
    "then tap '✅ Joined'."
)
TASK_EXPIRED = "⚠️ This task has expired. Try a new one!"

NO_TASKS = (
    "😕 No tasks are available for you right now!\n\n"
    "• Try 'Get Task' again in a little while\n"
    "• 🔗 Earn points with referrals\n"
    "• Or ➕ Add Task yourself to get members/views"
).format

OWNER_NEW_MEMBER = (
    "👥 <b>+1 Member!</b>\n\n"
    "{name} completed your task:\n📣 {title}\n\n"
    "💰 -{cost} points\n💎 Balance: <b>{balance}</b>"
).format

FEATURED = (
    "🌟 <b>Featured FlexFam Group</b>\n\n"
    "Join <b>FlexFam</b> and get <b>+{payout} points</b>!\n\n"
    "This onboarding reward is given only once. Join and tap ✅ Joined."
).format
FEATURED_CLAIM_OK = (
    "🌟 Featured group verified!\n\n"
    "🎉 +{payout} points added!\n💎 Balance: <b>{balance}</b>"
).format

# ── Add task ────────────────────────────────────────────────────────────
ADD_INTRO = (
    "➕ <b>Add Task</b>\n\n"
    "Choose a task type:\n"
    "👥 Group / 📣 Channel — real Telegram membership is verified\n"
    "👁 View / ❤️ Reaction — open the post and complete a {timer}s timer\n"
    "🤖 Bot Start — the user sends /start to your bot and forwards its reply\n\n"
    "{limit_note}\n"
    "💎 Your balance: <b>{balance}</b>"
).format
ADD_LIMIT_NOTE = "⚠️ Limit: max {max_groups} tasks per user".format
ADD_UNLIMITED_NOTE = "♾ No task limit — add as many tasks as you want"

ADD_LINK_PROMPT = (
    "{emoji} <b>{label} task</b>\n\n"
    "{instruction}\n\n"
    "<i>/cancel — to cancel</i>"
).format

ADD_LINK_INVALID = (
    "❌ That does not look like a valid public group/channel link.\n\n"
    "Send it like this: <code>t.me/your_group</code> or <code>@your_group</code>."
).format

ADD_POST_INVALID = (
    "❌ Send a valid post link: <code>t.me/channel_name/123</code>\n"
    "(the channel name and message ID are required; no double slash.)"
).format

ADD_BOT_INVALID = (
    "❌ Send a valid bot username, for example <code>@example_bot</code>.\n"
    "(A bot username always ends with <b>bot</b>.)"
)
ADD_BOT_SELF = "❌ You cannot create a task for this bot itself! 😅"
ADD_TYPE_MISMATCH = (
    "❌ The chosen task type does not match the Telegram chat type. Send the link again."
)
ADD_NOT_FOUND = "❌ Group/channel not found! Check the link and give the bot the access it needs."
ADD_NOT_ADMIN = (
    "⚠️ I am not an admin in <b>{title}</b>!\n\n"
    "Make me an admin, then send the link again or tap ✅ Verify."
).format
ADD_ALREADY = "😕 This task has already been added (by you or by someone else)."
ADD_LIMIT = (
    "⚠️ You have already added {count} tasks (max {max_groups}).\n\n"
    "Delete an old one from My Groups to add a new one."
).format
ADD_ASK_PAYOUT = (
    "✅ <b>{kind}</b> found: <b>{title}</b>\n\n"
    "💰 Members will get <b>{min_payout}–{max_payout}</b> points per completion.\n"
    "Fee: <b>{fee_percent}%</b> (the fee is zero in production).\n"
    "{funding_note}"
).format
ADD_FUNDS_REQUIRED = (
    "❌ The <b>{cost} points</b> reward of this View/Reaction task is reserved when you add it.\n"
    "Your balance: <b>{balance}</b>. Earn some points first."
).format
ADD_DONE = (
    "🎉 <b>Task added!</b>\n\n"
    "📣 {title}\n"
    "🔗 {link}\n"
    "💰 Payout: <b>{payout} pts</b> (cost: <b>{cost} pts</b>)\n\n"
    "Other users will now see this task under '💰 Earn Points'."
).format
ADD_CANCELLED = "❌ Add Task cancelled."
PAYOUT_INVALID = (
    "❌ The payout must be between {min_payout} and {max_payout}."
).format

# ── Add task: link prompts ──────────────────────────────────────────────
ADD_BOT_INSTRUCTION = (
    "Send your bot's @username, for example <code>@example_bot</code>.\n"
    "A user will send /start to that bot and forward its reply to me — "
    "that is the real verification."
)
ADD_POST_INSTRUCTION = (
    "Send the public link of the post, for example <code>t.me/channel_name/123</code>."
)
ADD_CHAT_INSTRUCTION = (
    "Send a public link or @username. The bot must be an admin in that chat; "
    "then a real getChatMember verification will run."
)
ADD_PRIVATE_LINK = (
    "🔒 A private link cannot be verified. Make the bot an admin in the group, "
    "then send the public link."
)
ADD_NO_INVITE_LINK = "❌ I cannot create an invite link. Give the bot the invite permission."
ADD_NOT_ADMIN_YET = (
    "❌ I have not been made an admin in any group yet. Make the bot an admin first."
)

# ── Funding notes ───────────────────────────────────────────────────────
FUNDING_UPFRONT = "💳 The cost of the selected payout is reserved from your balance right away."
FUNDING_BOT = "💳 The Bot Start cost is charged on every verified /start."
FUNDING_PER_JOIN = "💳 The group/channel cost is charged on every verified completion."

# ── My tasks ────────────────────────────────────────────────────────────
MY_GROUPS_EMPTY = "😕 You have not added any task yet.\n\n➕ Start with Add Task!"
GROUP_INFO = (
    "📣 <b>{title}</b>\n"
    "🔗 {link}\n\n"
    "🏷 Type: <b>{task_type}</b>\n"
    "💰 Payout: <b>{payout} pts</b> (cost: {cost})\n"
    "👥 Completions: <b>{received}</b>\n"
    "{status} {balance_note}"
).format
# These four are called as templates by the task card renderer.
GRP_PAUSED = "⏸ Paused — it will not be shown as a task.".format
GRP_ACTIVE = "🟢 Active — it is shown under Earn Points.".format
GRP_AUTO_PAUSED_NOTE = (
    "⏸ Auto-paused after {skips} skips with zero completions — "
    "improve it and resume."
).format
GRP_LOW_BAL = "⚠️ Your balance is low ({balance}) — the task will not be shown!".format
GRP_OK_BAL = "💎 Balance: {balance}".format
GRP_UPFRONT_NOTE = "💳 The reward was reserved when the task was added"
GROUP_TOGGLE_DONE = "✅ Done!"
GROUP_RESUMED = "▶️ Resumed — the skip streak has been reset."
GROUP_DELETED = "🗑 Task deleted."
GROUP_PAYOUT_ASK = "💸 Send the new payout (between {min} and {max}):"
GROUP_PAYOUT_DONE = "✅ Payout updated: <b>{payout} pts</b> (cost: {cost})".format
NOT_YOUR_GROUP = "⚠️ This task is not yours!"

# ── Dead-task warnings ──────────────────────────────────────────────────
DEAD_TASK_PAUSED = (
    "⏸ <b>Task auto-paused</b>\n\n"
    "📣 {title}\n\n"
    "This task was skipped <b>{skips}</b> times in a row and never completed "
    "once, so it has been paused automatically.\n\n"
    "⚠️ Warning strike: <b>{strikes}/{max_strikes}</b>\n\n"
    "💡 Make the task more attractive — raise the payout or fix the link — "
    "then resume it from 📣 My Groups. Resuming resets the skip streak."
).format
DEAD_TASK_BLOCKED = (
    "🚫 <b>All of your tasks have been paused</b>\n\n"
    "You have reached <b>{strikes}/{max_strikes}</b> warning strikes because "
    "your tasks keep getting skipped without a single completion.\n\n"
    "📣 Paused tasks: <b>{paused}</b>\n\n"
    "💡 Review your tasks in 📣 My Groups, improve them and resume them one by "
    "one. The admins have been notified."
).format
DEAD_TASK_ADMIN_ALERT = (
    "🚨 <b>Dead-task alert</b>\n\n"
    "👤 Owner: <b>{owner}</b> (<code>{owner_id}</code>)\n"
    "⚠️ Strikes: <b>{strikes}/{max_strikes}</b>\n"
    "📣 Last dead task: {title}\n"
    "⏭ Skipped <b>{skips}</b> times with zero completions\n"
    "⏸ Tasks paused: <b>{paused}</b>"
).format
STRIKES_CLEARED = "✅ Warning strikes cleared for user {uid}.".format

# ── legacy daily / referral / balance ──────────────────────────────────
BONUS_OK = "🎁 Bonus +{amount} points\n\n💎 Balance: <b>{balance}</b>".format
BONUS_WAIT = "⏳ Bonus cooldown.\n\n💎 Balance: <b>{balance}</b>".format
REFERRAL = (
    "🔗 <b>Your Referral Link</b>\n\n{link}\n\n"
    "Every new user gives you <b>+{bonus} points</b>!\n\n"
    "👥 Total referrals: <b>{count}</b>"
).format
BALANCE = (
    "💎 <b>{name}</b>'s summary\n\n"
    "💰 Balance: <b>{balance} points</b>\n"
    "📣 Tasks added: <b>{groups}</b>\n"
    "🔗 Tasks completed: <b>{joins}</b>\n"
    "👥 Referrals: <b>{refs}</b>\n\n"
    "Platform fee: <b>{fee_percent}%</b>."
).format

HELP = (
    "ℹ️ <b>FlexFam Sub4Sub — How it works</b>\n\n"
    "💰 <b>EARN POINTS</b>\n"
    "• Earn Points → complete a join/view task → get points\n"
    "• Referral → +{ref_bonus} points per friend\n\n"
    "📣 <b>ADD A TASK</b>\n"
    "• Add Task → choose Group/Channel, View/Reaction or Bot Start\n"
    "• Group/channel membership is verified with the Telegram API\n"
    "• For View/Reaction open the post → 30 second timer → claim\n"
    "• For Bot Start send /start to the bot → forward its reply → verified\n\n"
    "⚠️ Leaving a group/channel can take the points back within 72h.\n"
    "View/reaction completions are never reversed.\n\n"
    "⏭ <b>DEAD TASKS</b>\n"
    "• A task skipped {skip_limit} times in a row with zero completions is "
    "paused automatically and its owner gets a warning strike\n"
    "• {max_strikes} strikes pause all of that owner's tasks\n"
    "• A completion, or resuming the task yourself, resets the skip streak"
).format

# ── Admin / misc ────────────────────────────────────────────────────────
ADMIN_ONLY = "⚠️ This is for admins only."
ADMIN_PANEL = "🛠 <b>Admin Panel</b>\n\nUsers: <b>{users}</b> | Tasks: <b>{groups}</b> | Joins: <b>{joins}</b>".format
ADMIN_STATS = (
    "📊 <b>Stats</b>\n\n"
    "👤 Users: <b>{users}</b> (banned: {banned})\n"
    "📣 Tasks: <b>{groups}</b> (active: {active_groups})\n"
    "🤝 Total completions: <b>{joins}</b>\n"
    "💎 Total points: <b>{points}</b>"
).format
ADMIN_BROADCAST_ASK = "📣 Send the broadcast message (text) — it goes to all users. /cancel to cancel."
ADMIN_BAN_ASK = "🚫 Send the ID of the user to ban (number). /cancel to cancel."
ADMIN_UNBAN_ASK = "✅ Send the ID of the user to unban (number). /cancel to cancel."
ADMIN_BROADCAST_DONE = "✅ Broadcast done! Delivered to {ok}/{total} users.".format
ADMIN_BROADCASTING = "📣 Broadcasting…"
ADMIN_BAN_DONE = "🚫 User {uid} has been banned.".format
ADMIN_UNBAN_DONE = "✅ User {uid} has been unbanned.".format
ADMIN_USER_NOT_FOUND = "❌ User not found."
ADMIN_NUMERIC_ID_ONLY = "❌ Send a numeric user ID only."
ADMIN_SETPOINTS_USAGE = "Usage: /setpoints <user_id> <amount>"
ADMIN_SETPOINTS_DONE = "✅ User {uid}'s balance is now <b>{amount}</b> points.".format
ADMIN_STRIKES_USAGE = "Usage: /clearstrikes <user_id>"
CANCELLED = "❌ Cancelled."
UNKNOWN = "🤔 Use the menu buttons or tap /help."
ERROR = "😵 Something went wrong. Please try again in a little while."
MAIN_MENU = "🏠 Main Menu 👇"
SKIPPING = "⏭ Skipping…"
CHECKING = "🔍 Checking…"
DELETED_TOAST = "🗑 Deleted"
CLAIM_TOAST = "🎉 +{payout} points!".format
FEATURED_TOAST = "🌟 +{payout} points!".format
LEAVE_REVERSED = (
    "⚠️ You left <b>{title}</b> — {payout} points have been taken back!\n\n"
    "💎 Balance: <b>{balance}</b>"
).format
LEAVE_REFUND = (
    "♻️ <b>Refund!</b> A member left <b>{title}</b>.\n"
    "💰 +{cost} points returned — Balance: <b>{balance}</b>"
).format
GROUP_AUTO_PAUSED = (
    "⏸ <b>{title}</b> was paused automatically (the bot lost access or your "
    "balance ran out).\n"
    "Balance: <b>{balance}</b> — top up and resume it from 📣 My Groups."
).format
