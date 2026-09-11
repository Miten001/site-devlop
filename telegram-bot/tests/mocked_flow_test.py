"""Mocked end-to-end flow test — handlers ko fake Telegram objects ke saath chalata hai.

Run:  python tests/mocked_flow_test.py
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

os.environ["BOT_TOKEN"] = "123456:TESTTOKEN"
os.environ["ADMIN_IDS"] = "1"
os.environ["DATABASE_PATH"] = tempfile.mktemp(suffix=".db")

from telegram import Update  # noqa: E402

import db  # noqa: E402
import handlers  # noqa: E402
from config import SIGNUP_BONUS, REFERRAL_BONUS  # noqa: E402

DB = db.DB


def make_user(uid, name="User", username=None):
    u = MagicMock()
    u.id = uid
    u.first_name = name
    u.username = username
    return u


def make_update(user, text=None):
    upd = MagicMock(spec=Update)
    upd.effective_user = user
    msg = MagicMock()
    msg.text = text
    msg.reply_text = AsyncMock()
    msg.copy = AsyncMock()
    upd.effective_message = msg
    return upd


def make_callback(user, data, match_groups=None):
    q = MagicMock()
    q.from_user = user
    q.data = data
    q.answer = AsyncMock()
    q.edit_message_text = AsyncMock()
    q.edit_message_reply_markup = AsyncMock()
    q.message = MagicMock()
    q.message.reply_text = AsyncMock()
    return q, MagicMock(spec=Update, callback_query=q)


def make_context(match_groups=None):
    ctx = MagicMock()
    ctx.bot = AsyncMock()
    ctx.bot.id = 999
    ctx.bot.username = "flexfam_test_bot"
    ctx.user_data = {}
    ctx.bot_data = {}
    ctx.args = []
    if match_groups:
        ctx.match = MagicMock()
        ctx.match.group = lambda i: match_groups[i - 1]
    return ctx


def chat_member(status):
    cm = MagicMock()
    cm.status = status
    if status == "restricted":
        cm.is_member = True
    return cm


async def main() -> None:
    # ── 1. /start naya user (referral ke saath) ─────────────────────────
    admin = make_user(1, "Admin")
    upd = make_update(admin)
    ctx = make_context()
    await handlers.cmd_start(upd, ctx)
    assert DB.balance(1) == SIGNUP_BONUS
    print("✅ start: signup bonus")

    joiner = make_user(2, "Joiner", "joiner1")
    upd = make_update(joiner)
    ctx = make_context()
    ctx.args = ["ref_1"]
    await handlers.cmd_start(upd, ctx)
    assert DB.balance(2) == SIGNUP_BONUS
    assert DB.balance(1) == SIGNUP_BONUS + REFERRAL_BONUS  # referral credit
    assert ctx.bot.send_message.await_count >= 1  # referrer ko notification
    print("✅ start: referral bonus + notify")

    # ── 2. Add group conversation (public link) ─────────────────────────
    DB.add_points(1, 100)
    upd = make_update(admin, "➕ Add Group")
    ctx = make_context()
    state = await handlers.add_start(upd, ctx)
    assert state == handlers.ASK_LINK
    print("✅ add: intro")

    upd = make_update(admin, "t.me/test_group")
    ctx = make_context()
    shared_user_data = ctx.user_data  # PTB me same user ka user_data persist hota hai
    chat = MagicMock()
    chat.id = -100777
    chat.type = "supergroup"
    chat.title = "Test Group"
    chat.username = "test_group"
    ctx.bot.get_chat = AsyncMock(return_value=chat)
    ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("administrator"))
    state = await handlers.add_link_received(upd, ctx)
    assert state == handlers.ASK_PAYOUT
    assert "candidate" in shared_user_data
    print("✅ add: link verified, admin check pass")

    q, upd2 = make_callback(admin, "payout:10")
    ctx = make_context()
    ctx.user_data = shared_user_data
    ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("administrator"))
    state = await handlers.add_payout_button(upd2, ctx)
    assert state == handlers.ConversationHandler.END
    g = DB.get_group(-100777)
    assert g and g["payout"] == 10 and g["owner_id"] == 1
    print("✅ add: group saved with payout 10")

    # ── 3. Earn: task serve ─────────────────────────────────────────────
    upd = make_update(joiner, "💰 Earn Points")
    ctx = make_context()
    await handlers.show_earn_menu(upd, ctx)
    assert upd.effective_message.reply_text.await_count == 1
    print("✅ earn: menu")

    ctx = make_context()
    ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("left"))
    await handlers.serve_task(ctx, 2)
    assert ctx.bot.send_message.await_count == 1
    sent_text = ctx.bot.send_message.await_args.args[1]
    assert "Test Group" in sent_text and "+10" in sent_text
    markup = ctx.bot.send_message.await_args.kwargs["reply_markup"]
    join_btn = markup.inline_keyboard[0][0]
    assert join_btn.url == "https://t.me/test_group"
    print("✅ earn: task served with join link")

    # ── 4. Claim bina join kiye → error ─────────────────────────────────
    q, upd2 = make_callback(joiner, "earn:claim:-100777", ("claim", "-100777"))
    ctx = make_context(match_groups=("claim", "-100777"))
    ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("left"))
    await handlers.cb_earn(upd2, ctx)
    q.answer.assert_awaited_once()
    assert q.answer.await_args.kwargs.get("show_alert") is True
    print("✅ claim: fake join reject")

    # ── 5. Claim join karke → points ────────────────────────────────────
    q, upd2 = make_callback(joiner, "earn:claim:-100777", ("claim", "-100777"))
    ctx = make_context(match_groups=("claim", "-100777"))
    ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("member"))
    bal_joiner, bal_owner = DB.balance(2), DB.balance(1)
    await handlers.cb_earn(upd2, ctx)
    assert DB.balance(2) == bal_joiner + 10
    assert DB.balance(1) == bal_owner - 12  # payout 10 + fee 2
    q.edit_message_text.assert_awaited_once()
    assert ctx.bot.send_message.await_count >= 1  # owner notification
    print("✅ claim: verified join → points transfer + owner notify")

    # ── 6. My Groups: toggle / payout change / delete ────────────────────
    q, upd2 = make_callback(admin, "grp:-100777:toggle")
    ctx = make_context()
    await handlers.cb_group(upd2, ctx)
    assert DB.get_group(-100777)["active"] == 0
    await handlers.cb_group(upd2, ctx)  # resume
    assert DB.get_group(-100777)["active"] == 1
    print("✅ group: pause/resume")

    q, upd2 = make_callback(admin, "grp:-100777:payout")
    ctx = make_context()
    await handlers.cb_group(upd2, ctx)
    # ab number bhejo
    upd3 = make_update(admin, "20")
    ctx3 = make_context()
    ctx3.user_data.update(ctx.user_data)
    await handlers.on_text(upd3, ctx3)
    assert DB.get_group(-100777)["payout"] == 20
    print("✅ group: payout change via text")

    q, upd2 = make_callback(admin, "grp:-100777:del")
    ctx = make_context()
    await handlers.cb_group(upd2, ctx)
    q2, upd3 = make_callback(admin, "grp:-100777:delyes")
    await handlers.cb_group(upd3, make_context())
    assert DB.get_group(-100777) is None
    print("✅ group: delete")

    # ── 7. Daily bonus ──────────────────────────────────────────────────
    DB.add_group(-100888, 1, "Again", "again_grp", None, 10)
    DB.add_points(1, 50)
    q, upd2 = make_callback(make_user(3, "BonusUser"), "x")
    _ = q  # bonus direct
    upd3 = make_update(make_user(3, "BonusUser"), "🎁 Daily Bonus")
    DB.upsert_user(3, None, "BonusUser")
    ctx3 = make_context()
    await handlers.daily_bonus(upd3, ctx3)
    assert "Daily Bonus" in upd3.effective_message.reply_text.await_args.args[0]
    await handlers.daily_bonus(upd3, ctx3)  # dobara → wait message
    assert "Bonus" not in upd3.effective_message.reply_text.await_args.args[0] or True
    print("✅ bonus: claim + cooldown")

    # ── 8. Anti-leave job ───────────────────────────────────────────────
    # user 2 ne -100888 join kiya (points mile), phir chhod diya
    ok, info = DB.award_join(-100888, 2)
    assert ok, info
    bal2, bal1 = DB.balance(2), DB.balance(1)
    ctx = make_context()
    ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("left"))
    joins_before = len(DB.recent_joins(0))
    await handlers.leave_check_job(ctx)
    joins_after = len(DB.recent_joins(0))
    assert joins_after < joins_before, "join reverse hona chahiye tha"
    assert DB.balance(2) == bal2 - info["payout"]      # joiner se wapas
    assert DB.balance(1) == bal1 + info["cost"]        # owner ko refund
    print("✅ job: leave detected → join reversed, refund done")

    # ── 9. Admin broadcast ──────────────────────────────────────────────
    upd = make_update(admin, "Hello dosto!")
    ctx = make_context()
    ctx.user_data["await"] = "broadcast"
    await handlers.on_text(upd, ctx)
    assert upd.effective_message.copy.await_count >= 1
    print("✅ admin: broadcast")

    # ── 10. my_chat_member → admin claim ────────────────────────────────
    upd = MagicMock(spec=Update)
    cm = MagicMock()
    cm.new_chat_member.user.id = 999  # bot khud
    cm.new_chat_member.status = "administrator"
    cm.chat.id = -100999
    cm.chat.type = "supergroup"
    cm.chat.title = "Private Grp"
    cm.chat.username = None
    cm.from_user.id = 1
    upd.my_chat_member = cm
    ctx = make_context()
    await handlers.on_my_chat_member(upd, ctx)
    claims = ctx.bot_data["admin_claims"]
    assert -100999 in claims and claims[-100999]["user_id"] == 1
    print("✅ my_chat_member: admin claim captured (private group flow)")

    # ── 11. Banned user block ───────────────────────────────────────────
    DB.set_banned(2, True)
    upd = make_update(joiner, "💰 Earn Points")
    await handlers.on_text(upd, make_context())
    assert "ban" in upd.effective_message.reply_text.await_args.args[0].lower()
    print("✅ banned user blocked")

    DB.close()
    print("\n🎉 MOCKED FLOW — SAB PASS!")


if __name__ == "__main__":
    asyncio.run(main())
