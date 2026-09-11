"""Smoke test — DB logic + application wiring (bina Telegram ke).

Run:  python tests/smoke_test.py
"""

import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# dummy env BEFORE imports
os.environ["BOT_TOKEN"] = "123456:TESTTOKEN"
os.environ["ADMIN_IDS"] = "111"
os.environ["DATABASE_PATH"] = tempfile.mktemp(suffix=".db")

import config  # noqa: E402

print("== config ==")
assert config.BOT_TOKEN
assert config.ADMIN_IDS == {111}
assert config.fee_for(10) == 2, config.fee_for(10)
assert config.fee_for(5) == 1
assert config.cost_for(10) == 12
print("fee/cost ok")

import db  # noqa: E402

DB = db.DB

print("== db: users ==")
assert DB.upsert_user(1, "owner1", "Owner One")
assert DB.upsert_user(2, "joiner", "Joiner Two", ref_by=1)
assert not DB.upsert_user(1, "owner1x", "Owner One")  # existing → False
DB.add_points(1, 100)
DB.add_points(2, 50)
assert DB.balance(1) == 100 and DB.balance(2) == 50
assert DB.count_referrals(1) == 1
print("users ok")

print("== db: groups & tasks ==")
assert DB.add_group(-100111, 1, "Test Group", "testgroup", None, 10)
assert not DB.add_group(-100111, 1, "Dup", "testgroup", None, 10)  # duplicate
assert DB.count_groups_of(1) == 1
assert DB.active_task_count() == 1  # owner balance 100 >= 12

# joiner ke liye task candidate me owner ka group aana chahiye
cands = DB.task_candidates(2)
assert len(cands) == 1 and cands[0]["group_id"] == -100111
# owner ke liye apna group nahi aayega
assert DB.task_candidates(1) == []
print("task candidates ok")

print("== db: award_join ==")
ok, info = DB.award_join(-100111, 2)
assert ok, info
assert info["payout"] == 10 and info["cost"] == 12
assert DB.balance(2) == 60  # 50 + 10
assert DB.balance(1) == 88  # 100 - 12
assert DB.get_user(2)["total_joins"] == 1
assert DB.get_group(-100111)["total_received"] == 1

# double-claim block
ok2, reason = DB.award_join(-100111, 2)
assert not ok2 and reason["reason"] == "already"

# owner broke → task gayab
DB.set_points(1, 5)  # cost 12 > 5
assert DB.task_candidates(2) == [] or all(
    c["group_id"] != -100111 for c in DB.task_candidates(2))
ok3, r3 = DB.award_join(-100111, 999) if DB.upsert_user(999, "x", "X") else (None, None)
assert not ok3 and r3["reason"] == "owner_broke"
DB.set_points(1, 100)
print("award_join ok")

print("== db: silent record + reverse ==")
DB.upsert_user(3, "u3", "User3")
assert DB.record_join(-100111, 3, 10)  # silent join (already member case)
assert not DB.record_join(-100111, 3, 10)  # duplicate ignore

jrow = DB.recent_joins(0)
assert len(jrow) == 2
info = DB.reverse_join(jrow[0]["id"])
assert info is not None
# joiner 2 ke points: +10 - 10 = wapas 50
assert DB.balance(2) == 50
# owner 1: set_points(100) ke baad +12 refund → 112
assert DB.balance(1) == 112
assert DB.get_group(-100111)["total_received"] == 0
print("reverse_join ok")

print("== db: daily bonus ==")
u = DB.get_user(3)
DB.add_points(3, config.DAILY_BONUS)
DB.mark_bonus(3)
assert time.time() - DB.get_user(3)["last_bonus"] < 5
print("bonus ok")

print("== db: admin ==")
DB.set_banned(3, True)
assert DB.is_banned(3)
assert 3 not in DB.all_user_ids()
DB.set_banned(3, False)
assert not DB.is_banned(3)
s = DB.stats()
assert s["users"] == 4 and s["groups"] == 1, s
print("admin ok")

DB.close()
print("\n✅ DB tests PASS")

print("== application wiring ==")
import handlers  # noqa: E402
from telegram.ext import ConversationHandler  # noqa: E402

app = handlers.create_application(config.BOT_TOKEN)
n = sum(len(v) for v in app.handlers.values())
assert n >= 10, f"handlers registered: {n}"
# conversation TIMEOUT key available (future use)
_ = ConversationHandler.TIMEOUT
print(f"✅ application wiring PASS — {n} handler groups registered")

print("\n🎉 SAB PASS!")
