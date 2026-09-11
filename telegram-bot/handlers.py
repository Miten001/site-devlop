"""FlexFam Sub4Sub Bot — saare handlers (commands, callbacks, jobs)."""

import asyncio
import html
import logging
import re
import time

from telegram import (
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    Update,
)
from telegram.error import Forbidden, TelegramError
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    ChatMemberHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

import texts
from config import (
    ADMIN_IDS, DAILY_BONUS, FEE_PERCENT, LEAVE_CHECK_HOURS, MAX_GROUPS_PER_USER,
    MAX_PAYOUT, MIN_PAYOUT, REFERRAL_BONUS, SIGNUP_BONUS, cost_for,
)
from db import DB
import keyboards as kb

log = logging.getLogger(__name__)

# add-group conversation states
ASK_LINK, ASK_PAYOUT = range(2)

USERNAME_RE = re.compile(
    r"(?:https?://)?(?:t\.me/|telegram\.me/)?@?([A-Za-z][A-Za-z0-9_]{3,31})/?$",
    re.IGNORECASE,
)
PRIVATE_LINK_RE = re.compile(r"t\.me/(?:joinchat/|\+)", re.IGNORECASE)
MENU_BUTTONS = {
    kb.BTN_EARN, kb.BTN_ADD, kb.BTN_MY_GROUPS, kb.BTN_BALANCE,
    kb.BTN_BONUS, kb.BTN_REFERRAL, kb.BTN_HELP, kb.BTN_ADMIN,
}

CHAT_TYPES = {"group", "supergroup", "channel"}


# ── helpers ─────────────────────────────────────────────────────────────
def esc(s) -> str:
    return html.escape(str(s or ""), quote=False)


def is_member(cm) -> bool:
    """ChatMember object → kya yeh abhi group ka member hai?"""
    if cm.status in ("member", "administrator", "creator"):
        return True
    return cm.status == "restricted" and bool(getattr(cm, "is_member", False))


def group_link(g) -> str | None:
    if g["username"]:
        return f"https://t.me/{g['username']}"
    return g["invite_link"]


def main_menu(user_id: int) -> ReplyKeyboardMarkup:
    return kb.main_menu(is_admin=user_id in ADMIN_IDS)


async def safe_send(context, chat_id: int, text: str, **kw):
    try:
        return await context.bot.send_message(chat_id, text, **kw)
    except TelegramError:
        return None


# ── /start & basic commands ─────────────────────────────────────────────
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if DB.is_banned(user.id):
        return await update.effective_message.reply_text(texts.BANNED)

    # referral: /start ref_<referrer_id>
    ref_id = None
    if context.args and context.args[0].startswith("ref_"):
        try:
            rid = int(context.args[0][4:])
            ref_user = DB.get_user(rid)
            if rid != user.id and ref_user and not ref_user["banned"]:
                ref_id = rid
        except ValueError:
            pass

    is_new = DB.upsert_user(user.id, user.username, user.first_name, ref_id)

    if is_new:
        DB.add_points(user.id, SIGNUP_BONUS)
        if ref_id:
            DB.add_points(ref_id, REFERRAL_BONUS)
            await safe_send(
                context, ref_id,
                texts.REF_JOINED(
                    name=esc(user.first_name or user.username or "New user"),
                    bonus=REFERRAL_BONUS, balance=DB.balance(ref_id),
                ),
                parse_mode="HTML",
            )
        await update.effective_message.reply_text(
            texts.WELCOME(
                name=esc(user.first_name or "Friend"),
                signup_bonus=SIGNUP_BONUS, ref_bonus=REFERRAL_BONUS,
                daily_bonus=DAILY_BONUS,
            ),
            parse_mode="HTML", reply_markup=main_menu(user.id),
            disable_web_page_preview=True,
        )
    else:
        await update.effective_message.reply_text(
            texts.WELCOME_BACK(
                name=esc(user.first_name or "Friend"), balance=DB.balance(user.id)
            ),
            parse_mode="HTML", reply_markup=main_menu(user.id),
        )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        texts.HELP(daily_bonus=DAILY_BONUS, ref_bonus=REFERRAL_BONUS,
                   fee_percent=FEE_PERCENT),
        parse_mode="HTML", reply_markup=main_menu(update.effective_user.id),
        disable_web_page_preview=True,
    )


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop("await", None)
    context.user_data.pop("payout_gid", None)
    await update.effective_message.reply_text(
        texts.CANCELLED, reply_markup=main_menu(update.effective_user.id)
    )


# ── earn: task serve / claim / skip ─────────────────────────────────────
async def serve_task(context: ContextTypes.DEFAULT_TYPE, user_id: int,
                     edit_query=None) -> None:
    """Next available task dhoondo aur dikhao (edit ya send)."""
    for g in DB.task_candidates(user_id, limit=8):
        # live membership check
        try:
            cm = await context.bot.get_chat_member(g["group_id"], user_id)
        except Forbidden:
            # bot ko group se nikal diya — pause + owner ko batado
            DB.set_group_active(g["group_id"], False)
            await safe_send(
                context, g["owner_id"],
                texts.GROUP_AUTO_PAUSED(
                    title=esc(g["title"]), balance=DB.balance(g["owner_id"])
                ),
                parse_mode="HTML",
            )
            continue
        except TelegramError:
            continue

        if is_member(cm):
            # user pehle se member hai — silent mark (dobara task me nahi dikhega)
            DB.record_join(g["group_id"], user_id, g["payout"])
            continue

        link = group_link(g)
        if not link:
            continue

        text = texts.TASK(
            title=esc(g["title"]), link=link, payout=g["payout"]
        )
        markup = kb.task_keyboard(link, g["group_id"])
        if edit_query:
            try:
                await edit_query.edit_message_text(
                    text, parse_mode="HTML", reply_markup=markup,
                    disable_web_page_preview=True,
                )
                return
            except TelegramError:
                pass
        await context.bot.send_message(
            user_id, text, parse_mode="HTML", reply_markup=markup,
            disable_web_page_preview=True,
        )
        return

    # koi task nahi mila
    text = texts.NO_TASKS()
    if edit_query:
        try:
            await edit_query.edit_message_text(text, parse_mode="HTML")
            return
        except TelegramError:
            pass
    await context.bot.send_message(user_id, text, parse_mode="HTML")


async def show_earn_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    count = len(DB.task_candidates(update.effective_user.id, limit=50))
    await update.effective_message.reply_text(
        texts.EARN_INTRO(count=count), parse_mode="HTML",
        reply_markup=kb.earn_menu(count),
    )


async def cb_earn(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    user_id = q.from_user.id
    if DB.is_banned(user_id):
        await q.answer()
        return await q.edit_message_text(texts.BANNED)

    data = q.data  # "earn:get" | "earn:skip" | "earn:claim:<gid>"
    if data.startswith("earn:claim:"):
        gid = int(data.rsplit(":", 1)[1])
        return await claim_task(update, context, gid)

    if data == "earn:get":
        await q.answer()
        return await serve_task(context, user_id)

    if data == "earn:skip":
        await q.answer("⏭ Skipping…")
        return await serve_task(context, user_id, edit_query=q)


async def claim_task(update: Update, context: ContextTypes.DEFAULT_TYPE,
                     gid: int) -> None:
    q = update.callback_query
    user_id = q.from_user.id
    g = DB.get_group(gid)
    if not g or not g["active"]:
        await q.answer(texts.TASK_EXPIRED, show_alert=True)
        return

    # verify: user ne sach me join kiya?
    try:
        cm = await context.bot.get_chat_member(gid, user_id)
    except Forbidden:
        DB.set_group_active(gid, False)
        await safe_send(
            context, g["owner_id"],
            texts.GROUP_AUTO_PAUSED(
                title=esc(g["title"]), balance=DB.balance(g["owner_id"])
            ),
            parse_mode="HTML",
        )
        await q.answer(texts.TASK_EXPIRED, show_alert=True)
        return
    except TelegramError:
        await q.answer(texts.TASK_EXPIRED, show_alert=True)
        return

    if not is_member(cm):
        await q.answer(texts.NOT_JOINED, show_alert=True)
        return

    ok, info = DB.award_join(gid, user_id)
    if not ok:
        await q.answer(texts.TASK_EXPIRED, show_alert=True)
        return

    await q.answer(f"🎉 +{info['payout']} points!")
    try:
        await q.edit_message_text(
            texts.CLAIM_OK(payout=info["payout"], balance=info["joiner_balance"]),
            parse_mode="HTML", reply_markup=kb.after_join_keyboard(),
        )
    except TelegramError:
        pass

    # owner ko khushkhabri
    await safe_send(
        context, info["owner_id"],
        texts.OWNER_NEW_MEMBER(
            name=esc(q.from_user.first_name or q.from_user.username or "Someone"),
            title=esc(info["title"]), cost=info["cost"],
            balance=DB.balance(info["owner_id"]),
        ),
        parse_mode="HTML",
    )


# ── add group (conversation) ────────────────────────────────────────────
async def add_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if DB.is_banned(user_id):
        await update.effective_message.reply_text(texts.BANNED)
        return ConversationHandler.END
    if DB.count_groups_of(user_id) >= MAX_GROUPS_PER_USER:
        await update.effective_message.reply_text(
            texts.ADD_LIMIT(count=DB.count_groups_of(user_id),
                            max_groups=MAX_GROUPS_PER_USER),
            parse_mode="HTML", reply_markup=main_menu(user_id),
        )
        return ConversationHandler.END

    context.user_data.pop("candidate", None)
    await update.effective_message.reply_text(
        texts.ADD_INTRO(max_groups=MAX_GROUPS_PER_USER,
                        balance=DB.balance(user_id)),
        parse_mode="HTML", reply_markup=kb.add_group_verify_kb(),
        disable_web_page_preview=True,
    )
    return ASK_LINK


async def _finish_link(update_or_query, context, chat_info, user_id) -> int | None:
    """Chat resolve hone ke baad: admin check, link, dup-check → payout state."""
    gid = chat_info["group_id"]

    # bot admin hai?
    try:
        bot_cm = await context.bot.get_chat_member(gid, context.bot.id)
    except TelegramError:
        bot_cm = None
    if not bot_cm or bot_cm.status != "administrator":
        text = texts.ADD_NOT_ADMIN(title=esc(chat_info["title"]))
        if isinstance(update_or_query, Update):
            await update_or_query.effective_message.reply_text(text, parse_mode="HTML")
        else:
            await update_or_query.message.reply_text(text, parse_mode="HTML")
        return ASK_LINK

    # pehle se added?
    if DB.get_group(gid):
        text = texts.ADD_ALREADY
        if isinstance(update_or_query, Update):
            await update_or_query.effective_message.reply_text(text)
        else:
            await update_or_query.message.reply_text(text)
        return ConversationHandler.END

    # limit
    if DB.count_groups_of(user_id) >= MAX_GROUPS_PER_USER:
        text = texts.ADD_LIMIT(count=DB.count_groups_of(user_id),
                               max_groups=MAX_GROUPS_PER_USER)
        if isinstance(update_or_query, Update):
            await update_or_query.effective_message.reply_text(text, parse_mode="HTML")
        else:
            await update_or_query.message.reply_text(text, parse_mode="HTML")
        return ConversationHandler.END

    # join link: username ya fresh invite link
    invite_link = None
    if not chat_info.get("username"):
        try:
            invite_link = await context.bot.export_chat_invite_link(gid)
        except TelegramError:
            invite_link = None
        if not invite_link:
            text = ("❌ Invite link nahi bana pa raha.\n\nMujhe admin banao with "
                    "<b>'Invite users via link'</b> permission, phir link dobara bhejo.")
            if isinstance(update_or_query, Update):
                await update_or_query.effective_message.reply_text(text, parse_mode="HTML")
            else:
                await update_or_query.message.reply_text(text, parse_mode="HTML")
            return ASK_LINK

    context.user_data["candidate"] = {
        "group_id": gid,
        "title": chat_info["title"] or "Group",
        "username": chat_info.get("username"),
        "invite_link": invite_link,
    }
    text = texts.ADD_ASK_PAYOUT(
        title=esc(chat_info["title"] or "Group"), fee_percent=FEE_PERCENT,
        min_payout=MIN_PAYOUT, max_payout=MAX_PAYOUT,
    )
    markup = kb.payout_chooser([5, 10, 15, 20, 30, 50])
    if isinstance(update_or_query, Update):
        await update_or_query.effective_message.reply_text(
            text, parse_mode="HTML", reply_markup=markup)
    else:
        await update_or_query.message.reply_text(
            text, parse_mode="HTML", reply_markup=markup)
    return ASK_PAYOUT


async def add_link_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = (update.effective_message.text or "").strip()

    # menu button dabaya to conversation chhodo
    if text in MENU_BUTTONS:
        await cmd_cancel(update, context)
        return ConversationHandler.END

    if PRIVATE_LINK_RE.search(text):
        await update.effective_message.reply_text(
            "🔒 Private link se verify nahi hota.\n\nBot ko group me <b>ADMIN</b> "
            "banao, phir niche <b>✅ Bot admin hai — Verify karo</b> dabao.",
            parse_mode="HTML",
        )
        return ASK_LINK

    m = USERNAME_RE.match(text)
    if not m:
        await update.effective_message.reply_text(texts.ADD_LINK_INVALID, parse_mode="HTML")
        return ASK_LINK

    username = m.group(1)
    if username.lower() in {"joinchat", "share", "addstickers", "addtheme", "socks",
                            "proxy", "bot", "c", "s"}:
        await update.effective_message.reply_text(texts.ADD_LINK_INVALID, parse_mode="HTML")
        return ASK_LINK

    try:
        chat = await context.bot.get_chat(f"@{username}")
    except TelegramError:
        await update.effective_message.reply_text(texts.ADD_NOT_FOUND, parse_mode="HTML")
        return ASK_LINK

    if chat.type not in CHAT_TYPES:
        await update.effective_message.reply_text(texts.ADD_LINK_INVALID, parse_mode="HTML")
        return ASK_LINK

    chat_info = {
        "group_id": chat.id,
        "title": chat.title,
        "username": chat.username,
        "type": chat.type,
    }
    return await _finish_link(update, context, chat_info, user_id)


async def add_verify_admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """'✅ Bot admin hai' button — private groups ke liye.
    Bot jab admin banaya jata hai (my_chat_member update) tab claim save hota hai."""
    q = update.callback_query
    user_id = q.from_user.id
    await q.answer("🔍 Checking…")

    claims = context.bot_data.get("admin_claims", {})
    claim = None
    for c in claims.values():
        if c["user_id"] == user_id and time.time() - c["ts"] < 15 * 60:
            claim = c
            break

    if not claim:
        await q.message.reply_text(
            "❌ Mujhe abhi tak kisi group me admin nahi banaya gaya (aapki taraf se).\n\n"
            "1️⃣ Group me jao → Add Admin → mereko admin banao\n"
            "2️⃣ Phir wapas aake ye button dabao",
        )
        return ASK_LINK

    chat_info = {
        "group_id": claim["group_id"],
        "title": claim.get("title"),
        "username": claim.get("username"),
        "type": claim.get("type"),
    }
    return await _finish_link(q, context, chat_info, user_id)


async def _save_group(target, context, user_id: int, payout: int) -> int:
    cand = context.user_data.get("candidate")
    if not cand:
        if isinstance(target, Update):
            await target.effective_message.reply_text(texts.ADD_CANCELLED)
        else:
            await target.message.reply_text(texts.ADD_CANCELLED)
        return ConversationHandler.END

    added = DB.add_group(
        cand["group_id"], user_id, cand["title"],
        cand.get("username"), cand.get("invite_link"), payout,
    )
    if not added:
        text = texts.ADD_ALREADY
    else:
        link = group_link({"username": cand.get("username"),
                           "invite_link": cand.get("invite_link")})
        text = texts.ADD_DONE(
            title=esc(cand["title"]), link=link, payout=payout,
            cost=cost_for(payout),
        )

    context.user_data.pop("candidate", None)
    if isinstance(target, Update):
        await target.effective_message.reply_text(
            text, parse_mode="HTML", reply_markup=main_menu(user_id),
            disable_web_page_preview=True,
        )
    else:
        await target.message.reply_text(
            text, parse_mode="HTML", reply_markup=main_menu(user_id),
            disable_web_page_preview=True,
        )
    return ConversationHandler.END


async def add_payout_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    payout = int(q.data.split(":", 1)[1])
    await q.answer()
    if not (MIN_PAYOUT <= payout <= MAX_PAYOUT):
        await q.message.reply_text(
            texts.PAYOUT_INVALID(min_payout=MIN_PAYOUT, max_payout=MAX_PAYOUT)
        )
        return ASK_PAYOUT
    return await _save_group(q, context, q.from_user.id, payout)


async def add_payout_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (update.effective_message.text or "").strip()
    if text in MENU_BUTTONS:
        await cmd_cancel(update, context)
        return ConversationHandler.END
    try:
        payout = int(text)
    except ValueError:
        await update.effective_message.reply_text(
            texts.PAYOUT_INVALID(min_payout=MIN_PAYOUT, max_payout=MAX_PAYOUT)
        )
        return ASK_PAYOUT
    if not (MIN_PAYOUT <= payout <= MAX_PAYOUT):
        await update.effective_message.reply_text(
            texts.PAYOUT_INVALID(min_payout=MIN_PAYOUT, max_payout=MAX_PAYOUT)
        )
        return ASK_PAYOUT
    return await _save_group(update, context, update.effective_user.id, payout)


async def add_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop("candidate", None)
    await cmd_cancel(update, context)
    return ConversationHandler.END


def add_group_conversation() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex(f"^{kb.BTN_ADD}$") & filters.ChatType.PRIVATE,
                           add_start),
            CommandHandler("add", add_start),
        ],
        states={
            ASK_LINK: [
                CallbackQueryHandler(add_verify_admin, pattern=r"^addgrp:verify$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE,
                               add_link_received),
            ],
            ASK_PAYOUT: [
                CallbackQueryHandler(add_payout_button, pattern=r"^payout:\d+$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE,
                               add_payout_text),
            ],
        },
        fallbacks=[
            CommandHandler("cancel", add_cancel),
            MessageHandler(filters.Regex("^❌ Cancel$"), add_cancel),
        ],
        allow_reentry=True,
    )


# ── my groups ───────────────────────────────────────────────────────────
async def show_my_groups(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if DB.is_banned(user.id):
        return await update.effective_message.reply_text(texts.BANNED)

    groups = DB.groups_of(user.id)
    if not groups:
        return await update.effective_message.reply_text(
            texts.MY_GROUPS_EMPTY(), reply_markup=main_menu(user.id),
        )

    for g in groups:
        link = group_link(g)
        bal = DB.balance(g["owner_id"])
        note = (texts.GRP_LOW_BAL(balance=bal) if bal < cost_for(g["payout"])
                else texts.GRP_OK_BAL(balance=bal))
        await update.effective_message.reply_text(
            texts.GROUP_INFO(
                title=esc(g["title"]), link=link or "—", payout=g["payout"],
                cost=cost_for(g["payout"]), received=g["total_received"],
                status=texts.GRP_ACTIVE() if g["active"] else texts.GRP_PAUSED(),
                balance_note=note,
            ),
            parse_mode="HTML", reply_markup=kb.group_manage_kb(g["group_id"], bool(g["active"])),
            disable_web_page_preview=True,
        )


def _group_card(g) -> tuple[str, InlineKeyboardMarkup]:
    link = group_link(g)
    bal = DB.balance(g["owner_id"])
    note = (texts.GRP_LOW_BAL(balance=bal) if bal < cost_for(g["payout"])
            else texts.GRP_OK_BAL(balance=bal))
    return (
        texts.GROUP_INFO(
            title=esc(g["title"]), link=link or "—", payout=g["payout"],
            cost=cost_for(g["payout"]), received=g["total_received"],
            status=texts.GRP_ACTIVE() if g["active"] else texts.GRP_PAUSED(),
            balance_note=note,
        ),
        kb.group_manage_kb(g["group_id"], bool(g["active"])),
    )


async def cb_group(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    user_id = q.from_user.id
    _, gid_s, action = q.data.split(":", 2)
    gid = int(gid_s)
    g = DB.get_group(gid)

    if not g or g["owner_id"] != user_id:
        await q.answer(texts.NOT_YOUR_GROUP, show_alert=True)
        return

    if action == "toggle":
        DB.set_group_active(gid, not g["active"])
        g = DB.get_group(gid)
        await q.answer(texts.GROUP_TOGGLE_DONE)
        try:
            await q.edit_message_text(*_group_card(g), parse_mode="HTML",
                                      disable_web_page_preview=True)
        except TelegramError:
            pass
    elif action == "payout":
        await q.answer()
        context.user_data["await"] = "payout"
        context.user_data["payout_gid"] = gid
        await q.message.reply_text(
            texts.GROUP_PAYOUT_ASK(min=MIN_PAYOUT, max=MAX_PAYOUT)
        )
    elif action == "del":
        await q.answer()
        try:
            await q.edit_message_reply_markup(reply_markup=kb.confirm_delete_kb(gid))
        except TelegramError:
            pass
    elif action == "delyes":
        DB.delete_group(gid)
        await q.answer("🗑 Deleted")
        try:
            await q.edit_message_text(texts.GROUP_DELETED)
        except TelegramError:
            pass
    elif action == "delno":
        await q.answer()
        try:
            await q.edit_message_text(*_group_card(g), parse_mode="HTML",
                                      disable_web_page_preview=True)
        except TelegramError:
            pass


# ── bonus / referral / balance ──────────────────────────────────────────
async def daily_bonus(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if DB.is_banned(user.id):
        return await update.effective_message.reply_text(texts.BANNED)

    u = DB.get_user(user.id)
    remaining = 24 * 3600 - (time.time() - u["last_bonus"])
    if remaining > 0:
        h, m = int(remaining // 3600), int((remaining % 3600) // 60)
        return await update.effective_message.reply_text(
            texts.BONUS_WAIT(h=h, m=m, balance=DB.balance(user.id)),
            parse_mode="HTML",
        )

    DB.add_points(user.id, DAILY_BONUS)
    DB.mark_bonus(user.id)
    await update.effective_message.reply_text(
        texts.BONUS_OK(amount=DAILY_BONUS, balance=DB.balance(user.id)),
        parse_mode="HTML",
    )


async def referral(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if DB.is_banned(user.id):
        return await update.effective_message.reply_text(texts.BANNED)
    link = f"https://t.me/{context.bot.username}?start=ref_{user.id}"
    await update.effective_message.reply_text(
        texts.REFERRAL(link=link, bonus=REFERRAL_BONUS,
                       count=DB.count_referrals(user.id)),
        parse_mode="HTML", disable_web_page_preview=True,
    )


async def balance_card(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if DB.is_banned(user.id):
        return await update.effective_message.reply_text(texts.BANNED)
    u = DB.get_user(user.id)
    await update.effective_message.reply_text(
        texts.BALANCE(
            name=esc(u["first_name"] or u["username"] or "You"),
            balance=DB.balance(user.id),
            groups=DB.count_groups_of(user.id),
            joins=u["total_joins"],
            refs=DB.count_referrals(user.id),
            fee_percent=FEE_PERCENT,
        ),
        parse_mode="HTML",
    )


# ── admin ───────────────────────────────────────────────────────────────
def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS


async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not is_admin(user.id):
        return await update.effective_message.reply_text(texts.ADMIN_ONLY)
    s = DB.stats()
    await update.effective_message.reply_text(
        texts.ADMIN_PANEL(users=s["users"], groups=s["groups"], joins=s["joins"]),
        parse_mode="HTML", reply_markup=kb.admin_panel_kb(),
    )


async def cb_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    if not is_admin(q.from_user.id):
        return await q.answer(texts.ADMIN_ONLY, show_alert=True)
    action = q.data.split(":", 1)[1]
    await q.answer()

    if action == "stats":
        s = DB.stats()
        await q.message.reply_text(texts.ADMIN_STATS(**s), parse_mode="HTML")
    elif action == "broadcast":
        context.user_data["await"] = "broadcast"
        await q.message.reply_text(texts.ADMIN_BROADCAST_ASK)
    elif action == "ban":
        context.user_data["await"] = "ban"
        await q.message.reply_text(texts.ADMIN_BAN_ASK)
    elif action == "unban":
        context.user_data["await"] = "unban"
        await q.message.reply_text(texts.ADMIN_UNBAN_ASK)


async def do_broadcast(context: ContextTypes.DEFAULT_TYPE, message) -> int:
    ids = DB.all_user_ids()
    ok = 0
    for uid in ids:
        try:
            await message.copy(uid)
            ok += 1
        except TelegramError:
            pass
        await asyncio.sleep(0.08)  # flood limits
    return ok


async def cmd_setpoints(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not is_admin(user.id):
        return await update.effective_message.reply_text(texts.ADMIN_ONLY)
    try:
        uid, amount = int(context.args[0]), int(context.args[1])
    except (IndexError, ValueError):
        return await update.effective_message.reply_text("Usage: /setpoints <user_id> <amount>")
    if not DB.set_points(uid, amount):
        return await update.effective_message.reply_text(texts.ADMIN_USER_NOT_FOUND)
    await update.effective_message.reply_text(
        f"✅ User {uid} ka balance ab <b>{amount}</b> points.", parse_mode="HTML"
    )


# ── text dispatcher (menu + pending inputs) ─────────────────────────────
async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    msg = update.effective_message
    if DB.is_banned(user.id):
        return await msg.reply_text(texts.BANNED)

    awaiting = context.user_data.get("await")

    # admin ke pending actions
    if awaiting == "broadcast" and is_admin(user.id):
        context.user_data.pop("await", None)
        note = await msg.reply_text("📣 Broadcasting…")
        ok = await do_broadcast(context, msg)
        await note.edit_text(texts.ADMIN_BROADCAST_DONE(ok=ok, total=DB.stats()["users"]))
        return
    if awaiting in ("ban", "unban") and is_admin(user.id):
        context.user_data.pop("await", None)
        try:
            uid = int((msg.text or "").strip())
        except ValueError:
            return await msg.reply_text("❌ Sirf numeric user ID bhejo.")
        if not DB.set_banned(uid, awaiting == "ban"):
            return await msg.reply_text(texts.ADMIN_USER_NOT_FOUND)
        if awaiting == "ban":
            await msg.reply_text(texts.ADMIN_BAN_DONE(uid=uid))
        else:
            await msg.reply_text(texts.ADMIN_UNBAN_DONE(uid=uid))
        return
    if awaiting == "payout":
        gid = context.user_data.get("payout_gid")
        context.user_data.pop("await", None)
        context.user_data.pop("payout_gid", None)
        try:
            payout = int((msg.text or "").strip())
        except ValueError:
            payout = None
        if payout is None or not (MIN_PAYOUT <= payout <= MAX_PAYOUT):
            return await msg.reply_text(
                texts.PAYOUT_INVALID(min_payout=MIN_PAYOUT, max_payout=MAX_PAYOUT)
            )
        g = DB.get_group(gid)
        if not g or g["owner_id"] != user.id:
            return await msg.reply_text(texts.NOT_YOUR_GROUP)
        DB.set_group_payout(gid, payout)
        await msg.reply_text(
            texts.GROUP_PAYOUT_DONE(payout=payout, cost=cost_for(payout)),
            parse_mode="HTML",
        )
        return

    # menu buttons
    text = (msg.text or "").strip()
    if text == kb.BTN_EARN:
        return await show_earn_menu(update, context)
    if text == kb.BTN_MY_GROUPS:
        return await show_my_groups(update, context)
    if text == kb.BTN_BALANCE:
        return await balance_card(update, context)
    if text == kb.BTN_BONUS:
        return await daily_bonus(update, context)
    if text == kb.BTN_REFERRAL:
        return await referral(update, context)
    if text == kb.BTN_HELP:
        return await cmd_help(update, context)
    if text == kb.BTN_ADMIN:
        return await admin_panel(update, context)
    await msg.reply_text(texts.UNKNOWN, reply_markup=main_menu(user.id))


async def cb_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    await q.message.reply_text(
        "🏠 Main Menu 👇", reply_markup=main_menu(q.from_user.id)
    )


# ── bot ke chat membership updates (private group admin claims) ────────
async def on_my_chat_member(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cm = update.my_chat_member
    if not cm or (cm.new_chat_member.user.id != context.bot.id):
        return
    chat, status = cm.chat, cm.new_chat_member.status
    if chat.type not in CHAT_TYPES:
        return

    if status in ("administrator", "member"):
        claims = context.bot_data.setdefault("admin_claims", {})
        claims[chat.id] = {
            "group_id": chat.id,
            "title": chat.title or "Group",
            "username": chat.username,
            "type": chat.type,
            "user_id": cm.from_user.id,
            "ts": time.time(),
        }
    elif status in ("kicked", "left"):
        g = DB.get_group(chat.id)
        if g:
            DB.set_group_active(chat.id, False)
            await safe_send(
                context, g["owner_id"],
                texts.GROUP_AUTO_PAUSED(title=esc(g["title"]),
                                        balance=DB.balance(g["owner_id"])),
                parse_mode="HTML",
            )


# ── background job: group chhodne par points reverse ───────────────────
async def leave_check_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    since = time.time() - LEAVE_CHECK_HOURS * 3600
    for row in DB.recent_joins(since):
        try:
            cm = await context.bot.get_chat_member(row["group_id"], row["user_id"])
        except Forbidden:
            DB.set_group_active(row["group_id"], False)
            continue
        except TelegramError:
            continue
        if is_member(cm):
            continue

        info = DB.reverse_join(row["id"])
        if not info:
            continue
        log.info("reversed join: user %s left group %s", info["joiner_id"], info["title"])
        await safe_send(
            context, info["joiner_id"],
            texts.LEAVE_REVERSED(title=esc(info["title"]), payout=info["payout"],
                                 balance=DB.balance(info["joiner_id"])),
            parse_mode="HTML",
        )
        await safe_send(
            context, info["owner_id"],
            texts.LEAVE_REFUND(title=esc(info["title"]), cost=info["cost"],
                               balance=DB.balance(info["owner_id"])),
            parse_mode="HTML",
        )


# ── errors ──────────────────────────────────────────────────────────────
async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.error("Update me error aaya:", exc_info=context.error)
    if isinstance(update, Update) and update.effective_message:
        try:
            await update.effective_message.reply_text(texts.ERROR)
        except TelegramError:
            pass


# ── app wiring ──────────────────────────────────────────────────────────
def create_application(token: str) -> Application:
    app = Application.builder().token(token).build()
    private = filters.ChatType.PRIVATE

    app.add_handler(ChatMemberHandler(on_my_chat_member, ChatMemberHandler.MY_CHAT_MEMBER))
    app.add_handler(add_group_conversation())
    app.add_handler(CommandHandler("start", cmd_start, filters=private))
    app.add_handler(CommandHandler("help", cmd_help, filters=private))
    app.add_handler(CommandHandler("cancel", cmd_cancel, filters=private))
    app.add_handler(CommandHandler("setpoints", cmd_setpoints, filters=private))
    app.add_handler(CommandHandler("admin", admin_panel, filters=private))
    app.add_handler(CallbackQueryHandler(cb_earn, pattern=r"^earn:(get|skip|claim):?(\-?\d+)?$"))
    app.add_handler(CallbackQueryHandler(cb_group, pattern=r"^grp:\-?\d+:\w+$"))
    app.add_handler(CallbackQueryHandler(cb_admin, pattern=r"^adm:\w+$"))
    app.add_handler(CallbackQueryHandler(cb_menu, pattern=r"^menu:home$"))
    app.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE, on_text)
    )
    app.add_error_handler(on_error)

    if app.job_queue:
        app.job_queue.run_repeating(leave_check_job, interval=30 * 60, first=10 * 60)

    return app
