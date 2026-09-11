"""SQLite data layer — users, groups, joins (thread-safe, WAL mode)."""

import sqlite3
import threading
import time
from pathlib import Path

from config import DATABASE_PATH, FEE_PERCENT, cost_for

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id     INTEGER PRIMARY KEY,
    username    TEXT,
    first_name  TEXT,
    ref_by      INTEGER,
    balance     INTEGER NOT NULL DEFAULT 0,
    total_joins INTEGER NOT NULL DEFAULT 0,
    last_bonus  REAL NOT NULL DEFAULT 0,
    banned      INTEGER NOT NULL DEFAULT 0,
    joined_at   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    group_id       INTEGER PRIMARY KEY,
    owner_id       INTEGER NOT NULL,
    title          TEXT,
    username       TEXT,
    invite_link    TEXT,
    payout         INTEGER NOT NULL,
    active         INTEGER NOT NULL DEFAULT 1,
    total_received INTEGER NOT NULL DEFAULT 0,
    created_at     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS joins (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    payout    INTEGER NOT NULL,
    joined_at REAL NOT NULL,
    UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_joins_user  ON joins (user_id);
CREATE INDEX IF NOT EXISTS idx_joins_time  ON joins (joined_at);
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups (owner_id);
"""


class Database:
    def __init__(self, path: str = DATABASE_PATH):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.executescript(_SCHEMA)
            self.conn.commit()

    # ── users ───────────────────────────────────────────────────────────
    def upsert_user(self, user_id: int, username: str | None, first_name: str | None,
                    ref_by: int | None = None) -> bool:
        """User insert/refresh. True return karta hai agar NAYA user tha."""
        with self.lock:
            exists = self.conn.execute(
                "SELECT 1 FROM users WHERE user_id=?", (user_id,)
            ).fetchone()
            if exists:
                self.conn.execute(
                    "UPDATE users SET username=?, first_name=? WHERE user_id=?",
                    (username, first_name, user_id),
                )
            else:
                self.conn.execute(
                    "INSERT INTO users (user_id, username, first_name, ref_by, joined_at) "
                    "VALUES (?,?,?,?,?)",
                    (user_id, username, first_name, ref_by, time.time()),
                )
            self.conn.commit()
            return exists is None

    def get_user(self, user_id: int) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(
                "SELECT * FROM users WHERE user_id=?", (user_id,)
            ).fetchone()

    def is_banned(self, user_id: int) -> bool:
        u = self.get_user(user_id)
        return bool(u and u["banned"])

    def add_points(self, user_id: int, points: int) -> None:
        with self.lock:
            self.conn.execute(
                "UPDATE users SET balance = balance + ? WHERE user_id=?",
                (points, user_id),
            )
            self.conn.commit()

    def set_points(self, user_id: int, points: int) -> bool:
        with self.lock:
            cur = self.conn.execute(
                "UPDATE users SET balance=? WHERE user_id=?", (points, user_id)
            )
            self.conn.commit()
            return cur.rowcount > 0

    def balance(self, user_id: int) -> int:
        u = self.get_user(user_id)
        return int(u["balance"]) if u else 0

    def mark_bonus(self, user_id: int) -> None:
        """Daily bonus ka timestamp update karo (points caller add kare)."""
        with self.lock:
            self.conn.execute(
                "UPDATE users SET last_bonus=? WHERE user_id=?",
                (time.time(), user_id),
            )
            self.conn.commit()

    def count_referrals(self, user_id: int) -> int:
        with self.lock:
            return self.conn.execute(
                "SELECT COUNT(*) c FROM users WHERE ref_by=?", (user_id,)
            ).fetchone()["c"]

    def all_user_ids(self) -> list[int]:
        with self.lock:
            return [r["user_id"] for r in self.conn.execute(
                "SELECT user_id FROM users WHERE banned=0"
            ).fetchall()]

    def set_banned(self, user_id: int, banned: bool) -> bool:
        with self.lock:
            cur = self.conn.execute(
                "UPDATE users SET banned=? WHERE user_id=?",
                (1 if banned else 0, user_id),
            )
            self.conn.commit()
            return cur.rowcount > 0

    # ── groups ──────────────────────────────────────────────────────────
    def add_group(self, group_id: int, owner_id: int, title: str,
                  username: str | None, invite_link: str | None, payout: int) -> bool:
        with self.lock:
            cur = self.conn.execute(
                "INSERT OR IGNORE INTO groups "
                "(group_id, owner_id, title, username, invite_link, payout, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (group_id, owner_id, title, username, invite_link, payout, time.time()),
            )
            self.conn.commit()
            return cur.rowcount > 0

    def get_group(self, group_id: int) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(
                "SELECT * FROM groups WHERE group_id=?", (group_id,)
            ).fetchone()

    def groups_of(self, owner_id: int) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(
                "SELECT * FROM groups WHERE owner_id=? ORDER BY created_at DESC",
                (owner_id,),
            ).fetchall()

    def count_groups_of(self, owner_id: int) -> int:
        with self.lock:
            return self.conn.execute(
                "SELECT COUNT(*) c FROM groups WHERE owner_id=?", (owner_id,)
            ).fetchone()["c"]

    def set_group_active(self, group_id: int, active: bool) -> None:
        with self.lock:
            self.conn.execute(
                "UPDATE groups SET active=? WHERE group_id=?",
                (1 if active else 0, group_id),
            )
            self.conn.commit()

    def set_group_payout(self, group_id: int, payout: int) -> None:
        with self.lock:
            self.conn.execute(
                "UPDATE groups SET payout=? WHERE group_id=?", (payout, group_id)
            )
            self.conn.commit()

    def delete_group(self, group_id: int) -> None:
        with self.lock:
            self.conn.execute("DELETE FROM groups WHERE group_id=?", (group_id,))
            self.conn.execute("DELETE FROM joins WHERE group_id=?", (group_id,))
            self.conn.commit()

    def active_task_count(self) -> int:
        with self.lock:
            return self.conn.execute(
                "SELECT COUNT(*) c FROM groups g JOIN users u ON u.user_id=g.owner_id "
                "WHERE g.active=1 AND u.banned=0 "
                "AND u.balance >= g.payout + MAX(1, ROUND(g.payout * :fee / 100.0))",
                {"fee": float(FEE_PERCENT)},
            ).fetchone()["c"]

    def task_candidates(self, user_id: int, limit: int = 8) -> list[sqlite3.Row]:
        """Random groups jo is user ke liye task ban sakte hain:
        active, dusre owner ke, jahan balance bacha hai, jahan ye user
        pehle se join kar chuka hai wahan nahi."""
        with self.lock:
            return self.conn.execute(
                "SELECT g.* FROM groups g JOIN users u ON u.user_id=g.owner_id "
                "WHERE g.active=1 AND g.owner_id != :uid AND u.banned=0 "
                "  AND u.balance >= g.payout + MAX(1, ROUND(g.payout * :fee / 100.0)) "
                "  AND g.group_id NOT IN (SELECT group_id FROM joins WHERE user_id=:uid) "
                "ORDER BY RANDOM() LIMIT :lim",
                {"uid": user_id, "fee": float(FEE_PERCENT), "lim": limit},
            ).fetchall()

    # ── joins ───────────────────────────────────────────────────────────
    def record_join(self, group_id: int, user_id: int, payout: int) -> bool:
        """Silent join record (bina points) — user pehle se member tha."""
        with self.lock:
            cur = self.conn.execute(
                "INSERT OR IGNORE INTO joins (group_id, user_id, payout, joined_at) "
                "VALUES (?,?,?,?)",
                (group_id, user_id, payout, time.time()),
            )
            self.conn.commit()
            return cur.rowcount > 0

    def award_join(self, group_id: int, joiner_id: int) -> tuple[bool, dict]:
        """Atomic: joiner ko payout do, owner se payout+fee kaato, join record karo.
        Returns (ok, info|reason)."""
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                g = self.conn.execute(
                    "SELECT * FROM groups WHERE group_id=?", (group_id,)
                ).fetchone()
                if not g or not g["active"]:
                    self.conn.execute("ROLLBACK")
                    return False, {"reason": "unavailable"}

                owner = self.conn.execute(
                    "SELECT * FROM users WHERE user_id=?", (g["owner_id"],)
                ).fetchone()
                joiner = self.conn.execute(
                    "SELECT * FROM users WHERE user_id=?", (joiner_id,)
                ).fetchone()
                if not owner or not joiner or owner["banned"] or joiner["banned"]:
                    self.conn.execute("ROLLBACK")
                    return False, {"reason": "unavailable"}

                payout = int(g["payout"])
                cost = cost_for(payout)
                if owner["balance"] < cost:
                    self.conn.execute("ROLLBACK")
                    return False, {"reason": "owner_broke"}

                already = self.conn.execute(
                    "SELECT 1 FROM joins WHERE group_id=? AND user_id=?",
                    (group_id, joiner_id),
                ).fetchone()
                if already:
                    self.conn.execute("ROLLBACK")
                    return False, {"reason": "already"}

                self.conn.execute(
                    "UPDATE users SET balance = balance + ?, total_joins = total_joins + 1 "
                    "WHERE user_id=?", (payout, joiner_id))
                self.conn.execute(
                    "UPDATE users SET balance = balance - ? WHERE user_id=?",
                    (cost, g["owner_id"]))
                self.conn.execute(
                    "INSERT INTO joins (group_id, user_id, payout, joined_at) "
                    "VALUES (?,?,?,?)", (group_id, joiner_id, payout, time.time()))
                self.conn.execute(
                    "UPDATE groups SET total_received = total_received + 1 WHERE group_id=?",
                    (group_id,))
                self.conn.commit()
                return True, {
                    "payout": payout,
                    "cost": cost,
                    "owner_id": g["owner_id"],
                    "title": g["title"],
                    "joiner_balance": joiner["balance"] + payout,
                }
            except Exception:
                self.conn.execute("ROLLBACK")
                raise

    def reverse_join(self, join_id: int) -> dict | None:
        """Member group chhod gaya — joiner se points wapas, owner ko refund.
        Refund info return karta hai (notify karne ke liye) ya None."""
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                j = self.conn.execute(
                    "SELECT * FROM joins WHERE id=?", (join_id,)
                ).fetchone()
                if not j:
                    self.conn.execute("ROLLBACK")
                    return None
                g = self.conn.execute(
                    "SELECT * FROM groups WHERE group_id=?", (j["group_id"],)
                ).fetchone()
                if not g:
                    # group delete ho chuka — join row cleanup
                    self.conn.execute("DELETE FROM joins WHERE id=?", (join_id,))
                    self.conn.commit()
                    return None
                payout = int(j["payout"])
                cost = cost_for(payout)
                self.conn.execute(
                    "UPDATE users SET balance = balance - ? WHERE user_id=?",
                    (payout, j["user_id"]))
                self.conn.execute(
                    "UPDATE users SET balance = balance + ? WHERE user_id=?",
                    (cost, g["owner_id"]))
                self.conn.execute(
                    "UPDATE groups SET total_received = MAX(0, total_received - 1) "
                    "WHERE group_id=?", (j["group_id"],))
                self.conn.execute("DELETE FROM joins WHERE id=?", (join_id,))
                self.conn.commit()
                return {
                    "joiner_id": j["user_id"],
                    "owner_id": g["owner_id"],
                    "title": g["title"],
                    "payout": payout,
                    "cost": cost,
                }
            except Exception:
                self.conn.execute("ROLLBACK")
                raise

    def recent_joins(self, since_ts: float) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(
                "SELECT j.id, j.user_id, j.group_id, j.payout, g.title, g.owner_id "
                "FROM joins j JOIN groups g ON g.group_id = j.group_id "
                "WHERE j.joined_at >= ? ORDER BY j.id", (since_ts,)
            ).fetchall()

    # ── admin stats ─────────────────────────────────────────────────────
    def stats(self) -> dict:
        with self.lock:
            one = lambda q: self.conn.execute(q).fetchone()[0]  # noqa: E731
            return {
                "users": one("SELECT COUNT(*) FROM users"),
                "banned": one("SELECT COUNT(*) FROM users WHERE banned=1"),
                "groups": one("SELECT COUNT(*) FROM groups"),
                "active_groups": one("SELECT COUNT(*) FROM groups WHERE active=1"),
                "joins": one("SELECT COUNT(*) FROM joins"),
                "points": one("SELECT COALESCE(SUM(balance),0) FROM users"),
            }

    def close(self) -> None:
        with self.lock:
            self.conn.close()


DB = Database()
