"""Smoke tests for economy, featured onboarding, migration and wiring.

Run from the repository root with: python telegram-bot/tests/smoke_test.py
"""

import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
os.environ["BOT_TOKEN"] = "123456:TESTTOKEN"
os.environ["ADMIN_IDS"] = "111"
os.environ["DATABASE_PATH"] = tempfile.mktemp(suffix=".db")

import config  # noqa: E402

print("== production config ==")
assert config.SIGNUP_BONUS == 0
assert config.DAILY_BONUS == 0
assert config.REFERRAL_BONUS == 25
assert config.FEE_PERCENT == 0
assert config.MIN_PAYOUT == 5 and config.MAX_PAYOUT == 50
assert config.MAX_GROUPS_PER_USER == 0  # 0 == unlimited tasks per user
assert not config.task_limit_reached(0)
assert not config.task_limit_reached(10_000)
assert config.DEAD_TASK_SKIP_LIMIT == 15
assert config.DEAD_TASK_MAX_STRIKES == 3
assert config.VIEW_TIMER_SECONDS == 30
assert config.fee_for(5) == 0
assert config.fee_for(50) == 0
assert config.cost_for(10) == 10
# An explicit positive limit still applies.
config.MAX_GROUPS_PER_USER = 2
assert not config.task_limit_reached(1)
assert config.task_limit_reached(2)
config.MAX_GROUPS_PER_USER = 0
assert config.POST_LINK_RE.fullmatch("t.me/channel_name/123")
assert config.POST_LINK_RE.fullmatch("https://telegram.me/channel_name/123/")
assert not config.POST_LINK_RE.fullmatch("t.me//channel_name/123")
print("✅ config: zero-fee economy, unlimited tasks, strict post regex")

import db  # noqa: E402

DB = db.Database(os.environ["DATABASE_PATH"])
print("== users / featured ==")
assert DB.balance(0) == 999_999_999
assert DB.upsert_user(1, "owner", "Owner")
assert DB.upsert_user(2, "joiner", "Joiner")
assert DB.balance(1) == 0
DB.add_points(1, 100)
assert DB.featured_should_show(2, config.FEATURED_RESHOW_DAYS)
DB.mark_featured_shown(2, now=1000)
assert not DB.featured_should_show(2, config.FEATURED_RESHOW_DAYS, now=1000 + 10)
assert DB.featured_should_show(2, config.FEATURED_RESHOW_DAYS, now=1000 + 2 * 86400)
print("✅ featured: first show + two-day reshow")

print("== group/channel task ==")
assert DB.add_group(-100111, 1, "Test Group", "testgroup", None, 10)
assert DB.active_task_count() == 1
assert DB.task_candidates(2)[0]["group_id"] == -100111
ok, info = DB.award_join(-100111, 2)
assert ok and info["cost"] == 10
assert DB.balance(1) == 90 and DB.balance(2) == 10
assert DB.get_group(-100111)["task_type"] == "group"
assert DB.get_group(-100111)["total_received"] == 1
assert DB.get_group(0)["group_id"] == 0
assert all(row["owner_id"] != 0 for row in DB.task_candidates(2))
print("✅ group: real task accounting, featured excluded")

print("== pre-existing membership + leave reversal ==")
assert DB.record_join(-100111, 3, 0)
row = DB.recent_joins(0)[-1]
assert row["task_type"] == "group" and row["payout"] == 0
# A silent record never changes balances and is safe to reverse.
assert DB.reverse_join(row["id"])["payout"] == 0
assert DB.balance(1) == 90 and DB.balance(3) == 0
print("✅ record_join: silent zero payout")

print("== view/reaction upfront funding + timer storage ==")
assert DB.upsert_user(4, "viewer", "Viewer")
DB.add_points(4, 25)
assert DB.add_group(
    -222, 4, "Post Channel", "post_channel", None, 10,
    task_type="view", post_link="https://t.me/post_channel/123",
    charge_upfront=True,
)
assert DB.balance(4) == 15  # owner paid at add time, not claim time
assert DB.task_candidates(2)[0]["task_type"] == "view"
DB.start_timer(-222, 2, started_at=100)
assert DB.timer_started_at(-222, 2) == 100
ok, info = DB.award_join(-222, 2)
assert ok and info["cost"] == 0 and DB.balance(2) == 20
assert DB.balance(4) == 15
# View/reaction joins are deliberately not reversible.
view_join = DB.recent_joins(0)[-1]
assert view_join["task_type"] == "view"
assert DB.reverse_join(view_join["id"]) is None
print("✅ view: upfront cost, no owner claim charge, no leave reversal")

print("== bot-start task: per-completion funding, lookup, no reversal ==")
assert DB.upsert_user(5, "botowner", "BotOwner")
DB.add_points(5, 50)
assert DB.add_group(-333, 5, "@promo_bot", "promo_bot",
                    "https://t.me/promo_bot", 10, task_type="bot",
                    post_link="https://t.me/promo_bot")
assert DB.bot_task_by_username("promo_bot")["group_id"] == -333
assert DB.bot_task_by_username("@PROMO_BOT")["group_id"] == -333
assert DB.bot_task_by_username("other_bot") is None
ok, info = DB.award_join(-333, 2)
assert ok and info["cost"] == 10 and info["task_type"] == "bot"
assert DB.balance(5) == 40  # charged per verified start, not upfront
bot_join = DB.recent_joins(0)[-1]
assert bot_join["task_type"] == "bot"
assert DB.reverse_join(bot_join["id"]) is None  # never reversed
print("✅ bot: username lookup, per-start cost, irreversible join")

print("== featured claim is permanent ==")
featured_before = DB.balance(2)
ok, info = DB.award_join(0, 2)
assert ok and info["payout"] == config.FEATURED_PAYOUT
assert DB.balance(2) == featured_before + config.FEATURED_PAYOUT
assert not DB.featured_should_show(2, config.FEATURED_RESHOW_DAYS, now=time.time() + 99 * 86400)
assert DB.reverse_join(DB.recent_joins(0)[-1]["id"]) is None
print("✅ featured: system payout and never reshow after join")

print("== dead-task detection: skips, auto-pause and owner strikes ==")
assert DB.upsert_user(8, "deadowner", "DeadOwner")
DB.add_points(8, 500)
assert DB.add_group(-801, 8, "Dead One", "dead_one", None, 5)
assert DB.strikes_of(8) == 0

# 14 skips only build the streak; the task stays active.
for i in range(1, config.DEAD_TASK_SKIP_LIMIT):
    event = DB.register_skip(-801)
    assert event and not event["dead"] and event["streak"] == i
assert DB.get_group(-801)["active"] == 1
assert DB.skip_streak(-801) == config.DEAD_TASK_SKIP_LIMIT - 1

# The 15th skip kills the task and hands out strike 1/3.
event = DB.register_skip(-801)
assert event["dead"] and event["streak"] == config.DEAD_TASK_SKIP_LIMIT
assert event["strikes"] == 1 and event["max_strikes"] == 3
assert not event["owner_blocked"]
assert DB.get_group(-801)["active"] == 0
assert DB.get_group(-801)["auto_paused"] == 1
assert DB.strikes_of(8) == 1
assert all(row["group_id"] != -801 for row in DB.task_candidates(2))
print("✅ dead task: 15 skips → auto-pause + strike 1/3")

# Resuming resets the streak and the auto-paused flag.
DB.set_group_active(-801, True)
assert DB.skip_streak(-801) == 0 and DB.get_group(-801)["auto_paused"] == 0
for _ in range(config.DEAD_TASK_SKIP_LIMIT - 1):
    DB.register_skip(-801)
assert DB.get_group(-801)["active"] == 1  # streak restarted from zero
print("✅ resume: skip streak reset")

# A completion also resets the streak: a task with completions never dies.
ok, _ = DB.award_join(-801, 2)
assert ok and DB.skip_streak(-801) == 0
for _ in range(config.DEAD_TASK_SKIP_LIMIT + 3):
    assert DB.register_skip(-801) is None  # total_received > 0 → immune
assert DB.get_group(-801)["active"] == 1
print("✅ completion: streak reset and task immune")

# Strikes 2 and 3: at 3 strikes every task of the owner is paused.
assert DB.add_group(-802, 8, "Dead Two", "dead_two", None, 5)
assert DB.add_group(-803, 8, "Dead Three", "dead_three", None, 5)
assert DB.add_group(-804, 8, "Still Alive", "still_alive", None, 5)
for _ in range(config.DEAD_TASK_SKIP_LIMIT):
    event = DB.register_skip(-802)
assert event["dead"] and event["strikes"] == 2 and not event["owner_blocked"]
assert DB.get_group(-804)["active"] == 1  # other tasks untouched at 2/3
for _ in range(config.DEAD_TASK_SKIP_LIMIT):
    event = DB.register_skip(-803)
assert event["dead"] and event["strikes"] == 3 and event["owner_blocked"]
assert event["paused_count"] >= 2  # the dead task + the remaining active ones
assert DB.get_group(-804)["active"] == 0 and DB.get_group(-804)["auto_paused"] == 1
assert DB.get_group(-801)["active"] == 0  # the completed task is paused too
assert len(DB.dead_task_snapshot(8)) >= 3
print("✅ strikes: 3/3 pauses every task of the owner")

# Admins can forgive strikes; the featured/system task never goes dead.
DB.reset_strikes(8)
assert DB.strikes_of(8) == 0
for _ in range(config.DEAD_TASK_SKIP_LIMIT + 1):
    assert DB.register_skip(0) is None
assert DB.get_group(0)["active"] == 1
print("✅ strikes cleared; system task immune to the dead-task rule")

DB.close()

print("== safe migration of old schema ==")
old_path = tempfile.mktemp(suffix=".db")
conn = sqlite3.connect(old_path)
conn.executescript("""
CREATE TABLE users (user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT,
 ref_by INTEGER, balance INTEGER NOT NULL DEFAULT 0, total_joins INTEGER NOT NULL DEFAULT 0,
 last_bonus REAL NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0, joined_at REAL NOT NULL);
CREATE TABLE groups (group_id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, title TEXT,
 username TEXT, invite_link TEXT, payout INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 total_received INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL);
CREATE TABLE joins (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL, payout INTEGER NOT NULL, joined_at REAL NOT NULL,
 UNIQUE (group_id, user_id));
INSERT INTO users VALUES (7, 'old', 'Old', NULL, 42, 0, 0, 0, 1);
INSERT INTO groups VALUES (-7, 7, 'Old Group', 'old_group', NULL, 5, 1, 0, 1);
INSERT INTO joins (group_id,user_id,payout,joined_at) VALUES (-7,7,5,1);
""")
conn.commit()
conn.close()
old_db = db.Database(old_path)
cols = lambda t: {r[1] for r in old_db.conn.execute(f"PRAGMA table_info({t})")}
assert {"featured_shown_at", "warn_strikes"}.issubset(cols("users"))
assert {"post_link", "task_type", "skip_streak", "auto_paused"}.issubset(cols("groups"))
assert {"task_type"}.issubset(cols("joins"))
assert old_db.balance(7) == 42
assert old_db.get_group(-7)["title"] == "Old Group"
assert old_db.recent_joins(0)[0]["task_type"] == "group"
assert old_db.get_group(-7)["skip_streak"] == 0
assert old_db.strikes_of(7) == 0
old_db.close()
print("✅ migration: old rows preserved and new columns added")

print("== application wiring ==")
# Import after the explicit DB instances so the module's production singleton
# is also exercised through normal startup wiring.
os.environ["DATABASE_PATH"] = tempfile.mktemp(suffix=".db")
import handlers  # noqa: E402
import keyboards as kb  # noqa: E402
from telegram.ext import ConversationHandler  # noqa: E402

app = handlers.create_application(config.BOT_TOKEN)
registered = sum(len(v) for v in app.handlers.values())
assert registered >= 14
assert kb.BTN_BONUS not in kb.main_menu().keyboard[2]
assert handlers.ASK_TYPE < handlers.ASK_LINK < handlers.ASK_PAYOUT
_ = ConversationHandler.TIMEOUT
assert any(
    "clearstrikes" in getattr(h, "commands", set())
    for handlers_list in app.handlers.values() for h in handlers_list
)
# Skip buttons carry their task id so a skip can be attributed to that task.
skip_buttons = [
    b.callback_data
    for row in kb.task_keyboard("https://t.me/x", -55).inline_keyboard for b in row
    if b.callback_data and b.callback_data.startswith("earn:skip")
]
assert skip_buttons == ["earn:skip:-55"]
print(f"✅ wiring: {registered} handler groups, task chooser, no Daily Bonus button")

print("== English-only user-facing copy ==")
import texts  # noqa: E402

HINGLISH = (
    " karo", " karna", " nahi ", " hai ", " hain", "bhejo", "dabao", " jaise",
    " wapas", " aapka", " aapke", " apna", " apne", " chuno", " gaya", " hoga",
    " katega", "banao", " pehle", " dusr", " saare", " sirf ", " yeh ", " kuch ",
    " koi ", " milega", " thodi", "purana", "zaroori", " naya ", " shuru",
)


def rendered(value):
    """Render a text template with dummy values so .format helpers are checked."""
    if isinstance(value, str):
        return value
    try:
        import inspect

        params = inspect.signature(value).parameters
        return value(**{k: 0 for k in params})
    except Exception:
        try:
            return value(**{
                k: 0 for k in
                ("name", "balance", "payout", "count", "bonus", "title", "link",
                 "cost", "kind", "seconds", "max_groups", "min_payout",
                 "max_payout", "fee_percent", "funding_note", "timer", "uid",
                 "ok", "total", "amount", "users", "groups", "joins", "banned",
                 "active_groups", "points", "refs", "ref_bonus", "username",
                 "task_type", "received", "status", "balance_note", "min", "max",
                 "skips", "strikes", "max_strikes", "paused", "owner",
                 "owner_id", "skip_limit", "limit_note")
            })
        except Exception:
            return ""


bad = []
for name in dir(texts):
    if name.startswith("_"):
        continue
    text = rendered(getattr(texts, name))
    low = f" {text.lower()} "
    for token in HINGLISH:
        if token in low:
            bad.append((name, token))
assert not bad, f"Hinglish left in texts.py: {bad}"

for module_file in ("handlers.py", "keyboards.py", "bot.py"):
    source = (Path(__file__).parent.parent / module_file).read_text().lower()
    for token in (" karo", " bhejo", " dabao", " nahi hai", " chalu ", " aapka"):
        assert token not in source, f"{module_file} still contains {token!r}"
print("✅ language: texts/handlers/keyboards/bot are English")

print("\n🎉 SMOKE TESTS PASS")
