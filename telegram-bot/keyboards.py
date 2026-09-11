"""Reply + inline keyboards."""

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup

# Main menu labels (handlers me Regex inhi se match karta hai)
BTN_EARN = "💰 Earn Points"
BTN_ADD = "➕ Add Group"
BTN_MY_GROUPS = "📣 My Groups"
BTN_BALANCE = "💎 Balance"
BTN_BONUS = "🎁 Daily Bonus"
BTN_REFERRAL = "🔗 Referral"
BTN_HELP = "ℹ️ Help"
BTN_ADMIN = "🛠 Admin Panel"


def main_menu(is_admin: bool = False) -> ReplyKeyboardMarkup:
    rows = [
        [BTN_EARN, BTN_ADD],
        [BTN_MY_GROUPS, BTN_BALANCE],
        [BTN_BONUS, BTN_REFERRAL],
        [BTN_HELP],
    ]
    if is_admin:
        rows.append([BTN_ADMIN])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True)


def earn_menu(task_count: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton(f"🎯 Get Task ({task_count} available)", callback_data="earn:get"),
    ]])


def task_keyboard(join_url: str, group_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🔗 Join Group", url=join_url)],
        [InlineKeyboardButton("✅ Joined", callback_data=f"earn:claim:{group_id}"),
         InlineKeyboardButton("⏭ Skip", callback_data="earn:skip")],
    ])


def after_join_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🎯 Next Task", callback_data="earn:get")],
        [InlineKeyboardButton("🏠 Main Menu", callback_data="menu:home")],
    ])


def add_group_verify_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Bot admin hai — Verify karo", callback_data="addgrp:verify"),
    ]])


def payout_chooser(presets: list[int]) -> InlineKeyboardMarkup:
    rows, row = [], []
    for p in presets:
        row.append(InlineKeyboardButton(f"{p} pts", callback_data=f"payout:{p}"))
        if len(row) == 3:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return InlineKeyboardMarkup(rows)


def group_manage_kb(group_id: int, active: bool) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("⏸ Pause" if active else "▶️ Resume",
                              callback_data=f"grp:{group_id}:toggle")],
        [InlineKeyboardButton("💸 Change Payout", callback_data=f"grp:{group_id}:payout"),
         InlineKeyboardButton("🗑 Delete", callback_data=f"grp:{group_id}:del")],
    ])


def confirm_delete_kb(group_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("🗑 Haan, delete", callback_data=f"grp:{group_id}:delyes"),
        InlineKeyboardButton("❌ Nahi", callback_data=f"grp:{group_id}:delno"),
    ]])


def admin_panel_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📊 Stats", callback_data="adm:stats"),
         InlineKeyboardButton("📣 Broadcast", callback_data="adm:broadcast")],
        [InlineKeyboardButton("🚫 Ban User", callback_data="adm:ban"),
         InlineKeyboardButton("✅ Unban User", callback_data="adm:unban")],
    ])
