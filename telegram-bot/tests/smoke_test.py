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
assert config.MAX_GROUPS_PER_USER == 10
assert config.VIEW_TIMER_SECONDS == 30
assert config.fee_for(5) == 0
assert config.fee_for(50) == 0
assert config.cost_for(10) == 10
assert config.POST_LINK_RE.fullmatch("t.me/channel_name/123")
assert config.POST_LINK_RE.fullmatch("https://telegram.me/channel_name/123/")
assert not config.POST_LINK_RE.fullmatch("t.me//channel_name/123")
print("✅ config: zero-fee economy + strict post regex")

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

print("== featured claim is permanent ==")
featured_before = DB.balance(2)
ok, info = DB.award_join(0, 2)
assert ok and info["payout"] == config.FEATURED_PAYOUT
assert DB.balance(2) == featured_before + config.FEATURED_PAYOUT
assert not DB.featured_should_show(2, config.FEATURED_RESHOW_DAYS, now=time.time() + 99 * 86400)
assert DB.reverse_join(DB.recent_joins(0)[-1]["id"]) is None
print("✅ featured: system payout and never reshow after join")

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
assert {"featured_shown_at"}.issubset(cols("users"))
assert {"post_link", "task_type"}.issubset(cols("groups"))
assert {"task_type"}.issubset(cols("joins"))
assert old_db.balance(7) == 42
assert old_db.get_group(-7)["title"] == "Old Group"
assert old_db.recent_joins(0)[0]["task_type"] == "group"
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
assert registered >= 13
assert kb.BTN_BONUS not in kb.main_menu().keyboard[2]
assert handlers.ASK_TYPE < handlers.ASK_LINK < handlers.ASK_PAYOUT
_ = ConversationHandler.TIMEOUT
print(f"✅ wiring: {registered} handler groups, task chooser, no Daily Bonus button")

print("\n🎉 SMOKE TESTS PASS")
