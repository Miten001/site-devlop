"""Mocked end-to-end flow for the Telegram handlers.

Run from the repository root with: python telegram-bot/tests/mocked_flow_test.py
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
from config import (  # noqa: E402
    DEAD_TASK_MAX_STRIKES,
    DEAD_TASK_SKIP_LIMIT,
    MAX_GROUPS_PER_USER,
    REFERRAL_BONUS,
    SIGNUP_BONUS,
    VIEW_TIMER_SECONDS,
)

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


def make_callback(user, data):
    q = MagicMock()
    q.from_user = user
    q.data = data
    q.answer = AsyncMock()
    q.edit_message_text = AsyncMock()
    q.edit_message_reply_markup = AsyncMock()
    q.message = MagicMock()
    q.message.reply_text = AsyncMock()
    return q, MagicMock(spec=Update, callback_query=q)


def make_context():
    ctx = MagicMock()
    ctx.bot = AsyncMock()
    ctx.bot.id = 999
    ctx.bot.username = "flexfam_test_bot"
    ctx.user_data = {}
    ctx.bot_data = {}
    ctx.args = []
    return ctx


def chat_member(status):
    cm = MagicMock()
    cm.status = status
    if status == "restricted":
        cm.is_member = True
    return cm


async def main() -> None:
    admin = make_user(1, "Admin")
    joiner = make_user(2, "Joiner", "joiner1")

    # ── /start, zero signup and referral only ───────────────────────────
    ctx = make_context()
    await handlers.cmd_start(make_update(admin), ctx)
    assert DB.balance(1) == SIGNUP_BONUS == 0
    ctx = make_context()
    ctx.args = ["ref_1"]
    await handlers.cmd_start(make_update(joiner), ctx)
    assert DB.balance(2) == 0
    assert DB.balance(1) == REFERRAL_BONUS
    print("✅ start: signup=0, referral=25")

    # ── add Group through type chooser ──────────────────────────────────
    DB.add_points(1, 75)
    add_ctx = make_context()
    assert await handlers.add_start(make_update(admin, "➕ Add Task"), add_ctx) == handlers.ASK_TYPE
    q, upd = make_callback(admin, "addtype:group")
    assert await handlers.add_type_button(upd, add_ctx) == handlers.ASK_LINK
    chat = MagicMock(id=-100777, type="supergroup", title="Test Group", username="test_group")
    add_ctx.bot.get_chat = AsyncMock(return_value=chat)
    add_ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("administrator"))
    assert await handlers.add_link_received(make_update(admin, "t.me/test_group"), add_ctx) == handlers.ASK_PAYOUT
    q, upd = make_callback(admin, "payout:10")
    assert await handlers.add_payout_button(upd, add_ctx) == handlers.ConversationHandler.END
    group = DB.get_group(-100777)
    assert group["task_type"] == "group" and group["post_link"] is None
    print("✅ add: Group chooser + getChatMember admin verification")

    # ── serve, fake-claim reject, verified claim, fee zero ──────────────
    serve_ctx = make_context()
    serve_ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("left"))
    await handlers.serve_task(serve_ctx, 2)
    text = serve_ctx.bot.send_message.await_args.args[1]
    assert "Test Group" in text and "+10" in text
    print("✅ serve: group task shown")

    q, upd = make_callback(joiner, "earn:claim:-100777")
    reject_ctx = make_context()
    reject_ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("left"))
    await handlers.cb_earn(upd, reject_ctx)
    assert q.answer.await_args.kwargs["show_alert"] is True
    print("✅ claim: not joined rejected")

    q, upd = make_callback(joiner, "earn:claim:-100777")
    claim_ctx = make_context()
    claim_ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("member"))
    owner_before, joiner_before = DB.balance(1), DB.balance(2)
    await handlers.cb_earn(upd, claim_ctx)
    assert DB.balance(2) == joiner_before + 10
    assert DB.balance(1) == owner_before - 10  # no 20% fee
    print("✅ claim: joined verified, exactly payout deducted")

    # ── featured onboarding ────────────────────────────────────────────
    featured_user = make_user(3, "FeaturedUser")
    featured_ctx = make_context()
    await handlers.cmd_start(make_update(featured_user), featured_ctx)
    feature_message = featured_ctx.bot.send_message.await_args.args[1]
    assert "Featured" in feature_message
    featured_q, featured_update = make_callback(featured_user, "featured:claim")
    featured_ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("member"))
    await handlers.cb_featured(featured_update, featured_ctx)
    assert DB.balance(3) == 10
    assert not DB.featured_should_show(3, 2, now=10**12)
    assert all(row["owner_id"] != 0 for row in DB.task_candidates(2))
    print("✅ featured: shown first, paid by system, excluded from rotation")

    # ── View task: strict post link, upfront funding, timer ─────────────
    owner_before = DB.balance(1)
    view_ctx = make_context()
    assert await handlers.add_start(make_update(admin, "➕ Add Task"), view_ctx) == handlers.ASK_TYPE
    q, upd = make_callback(admin, "addtype:view")
    await handlers.add_type_button(upd, view_ctx)
    channel = MagicMock(id=-100555, type="channel", title="Post Channel", username="post_channel")
    view_ctx.bot.get_chat = AsyncMock(return_value=channel)
    assert await handlers.add_link_received(make_update(admin, "t.me/post_channel/123"), view_ctx) == handlers.ASK_PAYOUT
    candidate_id = view_ctx.user_data["candidate"]["group_id"]
    assert candidate_id < 0 and view_ctx.user_data["candidate"]["post_link"].endswith("/123")
    q, upd = make_callback(admin, "payout:10")
    await handlers.add_payout_button(upd, view_ctx)
    assert DB.balance(1) == owner_before - 10  # reserved at add time
    view_task = DB.get_group(candidate_id)
    assert view_task["task_type"] == "view"

    view_serve = make_context()
    await handlers.serve_task(view_serve, 2)
    assert view_serve.bot.send_message.await_count == 1
    view_q, view_update = make_callback(joiner, f"earn:start:{candidate_id}")
    await handlers.cb_earn(view_update, make_context())
    # Above context has its own bot, but the durable timer is in SQLite.
    early_q, early_update = make_callback(joiner, f"earn:claim:{candidate_id}")
    early_ctx = make_context()
    await handlers.cb_earn(early_update, early_ctx)
    assert early_q.answer.await_args.kwargs["show_alert"] is True
    DB.clear_timer(candidate_id, 2)
    DB.start_timer(candidate_id, 2, started_at=__import__("time").time() - VIEW_TIMER_SECONDS - 1)
    late_q, late_update = make_callback(joiner, f"earn:claim:{candidate_id}")
    late_ctx = make_context()
    await handlers.cb_earn(late_update, late_ctx)
    assert DB.get_group(candidate_id)["total_received"] == 1
    assert DB.balance(1) == owner_before - 10
    print("✅ view: synthetic task, timer gate, early reject, late reward")

    # ── Bot Start task: add + forwarded-message verification ────────────
    bot_owner = make_user(4, "BotOwner")
    bot_ctx = make_context()
    await handlers.cmd_start(make_update(bot_owner), bot_ctx)
    DB.add_points(4, 50)
    add_bot_ctx = make_context()
    assert await handlers.add_start(make_update(bot_owner, "➕ Add Task"), add_bot_ctx) == handlers.ASK_TYPE
    q, upd = make_callback(bot_owner, "addtype:bot")
    assert await handlers.add_type_button(upd, add_bot_ctx) == handlers.ASK_LINK
    # Invalid username → stays in ASK_LINK; our own bot is rejected too.
    assert await handlers.add_link_received(make_update(bot_owner, "not a bot"), add_bot_ctx) == handlers.ASK_LINK
    assert await handlers.add_link_received(make_update(bot_owner, "@flexfam_test_bot"), add_bot_ctx) == handlers.ASK_LINK
    assert await handlers.add_link_received(make_update(bot_owner, "@promo_helper_bot"), add_bot_ctx) == handlers.ASK_PAYOUT
    bot_gid = add_bot_ctx.user_data["candidate"]["group_id"]
    assert bot_gid < 0 and add_bot_ctx.user_data["candidate"]["task_type"] == "bot"
    q, upd = make_callback(bot_owner, "payout:10")
    assert await handlers.add_payout_button(upd, add_bot_ctx) == handlers.ConversationHandler.END
    assert DB.get_group(bot_gid)["task_type"] == "bot"
    print("✅ add: Bot Start task via @username")

    def make_forward(user, bot_username, is_bot=True, age=0):
        upd = make_update(user)
        origin = MagicMock()
        sender = MagicMock()
        sender.is_bot = is_bot
        sender.username = bot_username
        origin.sender_user = sender
        date = MagicMock()
        date.timestamp = lambda: __import__("time").time() - age
        origin.date = date
        upd.effective_message.forward_origin = origin
        return upd

    verifier = make_user(3, "FeaturedUser")
    # Forward from a human → rejected.
    human_fwd = make_forward(verifier, None, is_bot=False)
    await handlers.on_forwarded(human_fwd, make_context())
    assert "forward" in human_fwd.effective_message.reply_text.await_args.args[0].lower()
    # Forward from an unknown bot → no task.
    unknown_fwd = make_forward(verifier, "some_other_bot")
    await handlers.on_forwarded(unknown_fwd, make_context())
    assert "active task" in unknown_fwd.effective_message.reply_text.await_args.args[0]
    # Owner forwarding own bot's reply → rejected.
    own_fwd = make_forward(bot_owner, "promo_helper_bot")
    await handlers.on_forwarded(own_fwd, make_context())
    assert "your own task" in own_fwd.effective_message.reply_text.await_args.args[0]
    # Stale forward → rejected.
    stale_fwd = make_forward(verifier, "promo_helper_bot", age=handlers.BOT_FORWARD_MAX_AGE + 5)
    await handlers.on_forwarded(stale_fwd, make_context())
    assert "too old" in stale_fwd.effective_message.reply_text.await_args.args[0]
    # Fresh forward from the task bot → verified and paid.
    owner_before, verifier_before = DB.balance(4), DB.balance(3)
    good_fwd = make_forward(verifier, "Promo_Helper_Bot")  # case-insensitive
    await handlers.on_forwarded(good_fwd, make_context())
    assert DB.balance(3) == verifier_before + 10
    assert DB.balance(4) == owner_before - 10
    assert DB.get_group(bot_gid)["total_received"] == 1
    # Second forward from the same user → already claimed.
    dup_fwd = make_forward(verifier, "promo_helper_bot")
    await handlers.on_forwarded(dup_fwd, make_context())
    assert DB.balance(3) == verifier_before + 10
    # Inline ✅ claim on a bot task only nudges to forward.
    hint_q, hint_upd = make_callback(verifier, f"earn:claim:{bot_gid}")
    await handlers.cb_earn(hint_upd, make_context())
    assert "forward" in hint_q.answer.await_args.args[0].lower()
    print("✅ bot start: forwarded-message verification (reject/verify/dup)")

    # ── no task limit: an owner may add many tasks ──────────────────────
    assert MAX_GROUPS_PER_USER == 0
    DB.add_points(1, 500)
    for i in range(12):
        assert DB.add_group(-9000 - i, 1, f"Bulk {i}", f"bulk_{i}", None, 5)
    assert DB.count_groups_of(1) > 10
    # The Add Task conversation must still open well past the old limit of 10.
    add_intro_update = make_update(admin, "➕ Add Task")
    assert await handlers.add_start(add_intro_update, make_context()) == handlers.ASK_TYPE
    intro_text = add_intro_update.effective_message.reply_text.await_args.args[0]
    assert "No task limit" in intro_text
    assert "max" not in intro_text.lower()
    print("✅ limit: unlimited tasks per user, intro shows the no-limit note")

    # ── dead-task warning system through the skip button ────────────────
    dead_owner = make_user(5, "DeadOwner")
    await handlers.cmd_start(make_update(dead_owner), make_context())
    DB.add_points(5, 300)
    assert DB.add_group(-7001, 5, "Dead Task One", "dead_one", None, 5)

    async def skip_task(gid, user=joiner):
        """Press ⏭ Skip on a specific task.

        The membership mock answers "left" so that serving the *next* task
        does not silently record a pre-existing membership for the skipper.
        """
        q, upd = make_callback(user, f"earn:skip:{gid}")
        ctx = make_context()
        ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("left"))
        await handlers.cb_earn(upd, ctx)
        return ctx

    for _ in range(DEAD_TASK_SKIP_LIMIT - 1):
        await skip_task(-7001)
    assert DB.get_group(-7001)["active"] == 1
    assert DB.skip_streak(-7001) == DEAD_TASK_SKIP_LIMIT - 1
    assert DB.strikes_of(5) == 0

    warn_ctx = await skip_task(-7001)
    assert DB.get_group(-7001)["active"] == 0
    assert DB.strikes_of(5) == 1
    owner_calls = [c for c in warn_ctx.bot.send_message.await_args_list
                   if c.args and c.args[0] == 5]
    assert owner_calls and "auto-paused" in owner_calls[0].args[1]
    assert "1/3" in owner_calls[0].args[1]
    # The warning itself offers Resume / Change Payout / Delete.
    warn_markup = owner_calls[0].kwargs["reply_markup"]
    warn_actions = [b.callback_data
                    for row in warn_markup.inline_keyboard for b in row]
    assert warn_actions == ["grp:-7001:toggle", "grp:-7001:payout", "grp:-7001:del"]
    print("✅ dead task: auto-paused, strike 1/3, warning has action buttons")

    # Tapping ▶️ Resume Task straight from the warning clears the streak.
    resume_q, resume_upd = make_callback(dead_owner, warn_actions[0])
    await handlers.cb_group(resume_upd, make_context())
    assert DB.get_group(-7001)["active"] == 1 and DB.skip_streak(-7001) == 0
    assert DB.get_group(-7001)["auto_paused"] == 0
    assert "resumed" in resume_q.answer.await_args.args[0].lower()
    # The refreshed card must pass its markup by keyword, never positionally.
    edit_call = resume_q.edit_message_text.await_args
    assert len(edit_call.args) == 1, "task card markup must not be positional"
    assert edit_call.kwargs["parse_mode"] == "HTML"
    assert edit_call.kwargs["reply_markup"] is not None
    print("✅ resume: streak reset from the warning button, card re-rendered")

    # Someone else cannot act on the warning's buttons.
    intruder_q, intruder_upd = make_callback(joiner, "grp:-7001:toggle")
    await handlers.cb_group(intruder_upd, make_context())
    assert intruder_q.answer.await_args.kwargs.get("show_alert") is True
    assert DB.get_group(-7001)["active"] == 1  # unchanged
    print("✅ dead-task buttons: ownership enforced")

    # A completion also resets the streak.
    for _ in range(3):
        await skip_task(-7001)
    assert DB.skip_streak(-7001) == 3
    claim_q, claim_upd = make_callback(joiner, "earn:claim:-7001")
    done_ctx = make_context()
    done_ctx.bot.get_chat_member = AsyncMock(return_value=chat_member("member"))
    await handlers.cb_earn(claim_upd, done_ctx)
    assert DB.get_group(-7001)["total_received"] == 1
    assert DB.skip_streak(-7001) == 0
    print("✅ completion: skip streak reset")

    # Strikes 2 and 3 → every task of the owner is paused and admins alerted.
    third = make_user(6, "ThirdParty")
    assert DB.add_group(-7002, 5, "Dead Task Two", "dead_two", None, 5)
    assert DB.add_group(-7003, 5, "Dead Task Three", "dead_three", None, 5)
    assert DB.add_group(-7004, 5, "Untouched Task", "untouched", None, 5)
    for _ in range(DEAD_TASK_SKIP_LIMIT):
        await skip_task(-7002, third)
    assert DB.strikes_of(5) == 2 and DB.get_group(-7004)["active"] == 1
    for _ in range(DEAD_TASK_SKIP_LIMIT - 1):
        final_ctx = await skip_task(-7003, third)
    final_ctx = await skip_task(-7003, third)
    assert DB.strikes_of(5) == DEAD_TASK_MAX_STRIKES
    assert DB.get_group(-7004)["active"] == 0  # all tasks paused
    assert DB.get_group(-7001)["active"] == 0
    sent = [(c.args[0], c.args[1]) for c in final_ctx.bot.send_message.await_args_list]
    owner_texts = [t for uid, t in sent if uid == 5]
    admin_texts = [t for uid, t in sent if uid == 1]
    assert any("All of your tasks have been paused" in t for t in owner_texts)
    assert admin_texts and "Dead-task alert" in admin_texts[0]
    assert "3/3" in admin_texts[0]
    print("✅ strikes: 3/3 pauses all tasks + admin alert")

    # /clearstrikes forgives the owner.
    clear_upd = make_update(admin, "/clearstrikes 5")
    clear_ctx = make_context()
    clear_ctx.args = ["5"]
    await handlers.cmd_clearstrikes(clear_upd, clear_ctx)
    assert DB.strikes_of(5) == 0
    assert "cleared" in clear_upd.effective_message.reply_text.await_args.args[0]
    print("✅ admin: /clearstrikes resets warning strikes")

    # ── leave reversal only for group/channel ───────────────────────────
    DB.add_group(-100888, 1, "Leave Group", "leave_group", None, 5)
    DB.add_points(1, 20)
    ok, info = DB.award_join(-100888, 2)
    assert ok
    joiner_before = DB.balance(2)
    owner_before = DB.balance(1)
    leave_ctx = make_context()
    async def leave_status(gid, user_id):
        return chat_member("left" if gid == -100888 else "member")
    leave_ctx.bot.get_chat_member = AsyncMock(side_effect=leave_status)
    await handlers.leave_check_job(leave_ctx)
    assert DB.get_group(-100888)["total_received"] == 0
    assert DB.balance(2) == joiner_before - info["payout"]
    assert DB.balance(1) == owner_before + info["cost"]
    assert DB.get_group(candidate_id)["total_received"] == 1
    print("✅ leave job: group reversed, view untouched")

    # ── broadcast then ban ──────────────────────────────────────────────
    broadcast_ctx = make_context()
    broadcast_ctx.user_data["await"] = "broadcast"
    await handlers.on_text(make_update(admin, "Hello FlexFam"), broadcast_ctx)
    assert broadcast_ctx.bot is not None
    ban_ctx = make_context()
    ban_ctx.user_data["await"] = "ban"
    await handlers.on_text(make_update(admin, "2"), ban_ctx)
    assert DB.is_banned(2)
    blocked = make_update(joiner, "💰 Earn Points")
    await handlers.on_text(blocked, make_context())
    assert "banned" in blocked.effective_message.reply_text.await_args.args[0].lower()
    print("✅ admin: broadcast + ban block")

    DB.close()
    print("\n🎉 MOCKED FLOW TEST PASS")


if __name__ == "__main__":
    asyncio.run(main())
