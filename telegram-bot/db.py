"""SQLite data layer — users, tasks, joins and timer state.

The database is deliberately small and transactional.  ``_migrate`` runs on
*every* startup so an existing bot.db can be upgraded without dropping data.
"""

import hashlib
import re
import sqlite3
import threading
import time
from pathlib import Path

from config import (
    DATABASE_PATH,
    FEATURED_GROUP_ID,
    FEATURED_LINK,
    FEATURED_PAYOUT,
    FEE_PERCENT,
    SYSTEM_BALANCE,
    SYSTEM_USER_ID,
    cost_for,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id           INTEGER PRIMARY KEY,
    username          TEXT,
    first_name        TEXT,
    ref_by            INTEGER,
    balance           INTEGER NOT NULL DEFAULT 0,
    total_joins       INTEGER NOT NULL DEFAULT 0,
    last_bonus        REAL NOT NULL DEFAULT 0,
    banned            INTEGER NOT NULL DEFAULT 0,
    joined_at         REAL NOT NULL,
    featured_shown_at REAL NOT NULL DEFAULT 0
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
    created_at     REAL NOT NULL,
    post_link      TEXT,
    task_type      TEXT NOT NULL DEFAULT 'group'
);

CREATE TABLE IF NOT EXISTS joins (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    payout    INTEGER NOT NULL,
    joined_at REAL NOT NULL,
    task_type TEXT NOT NULL DEFAULT 'group',
    UNIQUE (group_id, user_id)
);

-- A timer is durable across callback contexts and bot restarts.  It does not
-- count as a join until the 30-second claim is successfully completed.
CREATE TABLE IF NOT EXISTS task_timers (
    group_id   INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    started_at REAL NOT NULL,
    PRIMARY KEY (group_id, user_id)
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
            # Do not put indexes on migrated columns in this first script: an
            # old table may not have them until _migrate has run.
            self.conn.executescript(_SCHEMA)
            self._migrate()
            self._ensure_system_data()
            self.conn.commit()

    # ── migrations / system task ───────────────────────────────────────
    def _columns(self, table: str) -> set[str]:
        return {row[1] for row in self.conn.execute(f"PRAGMA table_info({table})")}

    def _migrate(self) -> None:
        """Add new columns to pre-feature databases without losing rows."""
        migrations = {
            "users": [("featured_shown_at", "REAL NOT NULL DEFAULT 0")],
            "groups": [
                ("post_link", "TEXT"),
                ("task_type", "TEXT NOT NULL DEFAULT 'group'"),
            ],
            "joins": [("task_type", "TEXT NOT NULL DEFAULT 'group'")],
        }
        for table, columns in migrations.items():
            existing = self._columns(table)
            for name, definition in columns:
                if name not in existing:
                    self.conn.execute(
                        f"ALTER TABLE {table} ADD COLUMN {name} {definition}"
                    )

        # Existing rows are group joins.  For rows created after deployment,
        # keep the task type copied from its task record when it is available.
        self.conn.execute(
            "UPDATE joins SET task_type = COALESCE((SELECT g.task_type "
            "FROM groups g WHERE g.group_id = joins.group_id), 'group') "
            "WHERE task_type IS NULL OR task_type = ''"
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_groups_task_type ON groups(task_type)"
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_joins_task_type ON joins(task_type)"
        )
        self.conn.commit()

    def _ensure_system_data(self) -> None:
        now = time.time()
        self.conn.execute(
            "INSERT OR IGNORE INTO users "
            "(user_id, username, first_name, balance, joined_at) VALUES (?,?,?,?,?)",
            (SYSTEM_USER_ID, "system", "FlexFam System", SYSTEM_BALANCE, now),
        )
        # Never let featured payouts consume the system user's reserve.
        self.conn.execute(
            "UPDATE users SET balance=MAX(balance, ?), banned=0 WHERE user_id=?",
            (SYSTEM_BALANCE, SYSTEM_USER_ID),
        )
        username_match = re.search(r"(?:t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{3,31})",
                                   FEATURED_LINK, re.IGNORECASE)
        username = username_match.group(1) if username_match else "flex_fam"
        self.conn.execute(
            "INSERT OR IGNORE INTO groups "
            "(group_id, owner_id, title, username, invite_link, payout, active, "
            "total_received, created_at, post_link, task_type) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (FEATURED_GROUP_ID, SYSTEM_USER_ID, "FlexFam", username, FEATURED_LINK,
             FEATURED_PAYOUT, 1, 0, now, None, "group"),
        )
        self.conn.execute(
            "UPDATE groups SET owner_id=?, title=?, username=?, invite_link=?, "
            "payout=?, active=1, task_type='group' WHERE group_id=?",
            (SYSTEM_USER_ID, "FlexFam", username, FEATURED_LINK, FEATURED_PAYOUT,
             FEATURED_GROUP_ID),
        )

    # ── users ───────────────────────────────────────────────────────────
    def upsert_user(self, user_id: int, username: str | None,
                    first_name: str | None, ref_by: int | None = None) -> bool:
        """Insert/refresh a user.  Returns True only for a new user."""
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
        # Kept for database/API compatibility; the daily button is no longer
        # exposed and DAILY_BONUS defaults to zero.
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
                "SELECT user_id FROM users WHERE banned=0 AND user_id != ?",
                (SYSTEM_USER_ID,),
            ).fetchall()]

    def set_banned(self, user_id: int, banned: bool) -> bool:
        with self.lock:
            cur = self.conn.execute(
                "UPDATE users SET banned=? WHERE user_id=?",
                (1 if banned else 0, user_id),
            )
            self.conn.commit()
            return cur.rowcount > 0

    # ── tasks / groups ──────────────────────────────────────────────────
    def add_group(self, group_id: int, owner_id: int, title: str,
                  username: str | None, invite_link: str | None, payout: int,
                  task_type: str = "group", post_link: str | None = None,
                  charge_upfront: bool = False) -> bool:
        """Add a task.

        Group/channel tasks are funded per successful member.  View/reaction
        tasks reserve their one reward when the task is added, as required by
        the product flow.  Bot-start tasks are funded per verified start,
        exactly like group/channel tasks.
        """
        if task_type not in {"group", "channel", "view", "reaction", "bot"}:
            return False
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                owner = self.conn.execute(
                    "SELECT * FROM users WHERE user_id=?", (owner_id,)
                ).fetchone()
                if not owner:
                    self.conn.execute("ROLLBACK")
                    return False
                if charge_upfront and owner["balance"] < cost_for(payout):
                    self.conn.execute("ROLLBACK")
                    return False
                cur = self.conn.execute(
                    "INSERT OR IGNORE INTO groups "
                    "(group_id, owner_id, title, username, invite_link, payout, "
                    "created_at, post_link, task_type) VALUES (?,?,?,?,?,?,?,?,?)",
                    (group_id, owner_id, title, username, invite_link, payout,
                     time.time(), post_link, task_type),
                )
                if cur.rowcount == 0:
                    self.conn.execute("ROLLBACK")
                    return False
                if charge_upfront:
                    self.conn.execute(
                        "UPDATE users SET balance=balance-? WHERE user_id=?",
                        (cost_for(payout), owner_id),
                    )
                self.conn.commit()
                return True
            except Exception:
                self.conn.execute("ROLLBACK")
                raise

    def add_task(self, *args, **kwargs) -> bool:
        """Readable alias used by task-oriented callers/tests."""
        return self.add_group(*args, **kwargs)

    def get_group(self, group_id: int) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(
                "SELECT * FROM groups WHERE group_id=?", (group_id,)
            ).fetchone()

    def bot_task_by_username(self, username: str) -> sqlite3.Row | None:
        """Active bot-start task whose bot @username matches (case-insensitive)."""
        if not username:
            return None
        with self.lock:
            return self.conn.execute(
                "SELECT * FROM groups WHERE task_type='bot' "
                "AND LOWER(username)=LOWER(?)", (username.lstrip("@"),)
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
            self.conn.execute("DELETE FROM task_timers WHERE group_id=?", (group_id,))
            self.conn.commit()

    def active_task_count(self) -> int:
        with self.lock:
            return self.conn.execute(
                "SELECT COUNT(*) c FROM groups g JOIN users u ON u.user_id=g.owner_id "
                "WHERE g.active=1 AND g.owner_id != :system AND u.banned=0 "
                "AND ("
                "  g.task_type IN ('view','reaction') AND g.total_received=0"
                "  OR g.task_type NOT IN ('view','reaction') AND "
                "      u.balance >= g.payout + MAX(0, ROUND(g.payout * :fee / 100.0))"
                ")",
                {"fee": float(FEE_PERCENT), "system": SYSTEM_USER_ID},
            ).fetchone()["c"]

    def task_candidates(self, user_id: int, limit: int = 8) -> list[sqlite3.Row]:
        """Available non-featured tasks for a user."""
        with self.lock:
            return self.conn.execute(
                "SELECT g.* FROM groups g JOIN users u ON u.user_id=g.owner_id "
                "WHERE g.active=1 AND g.owner_id != :uid AND g.owner_id != :system "
                "  AND u.banned=0 "
                "  AND ("
                "    (g.task_type IN ('view','reaction') AND g.total_received=0)"
                "    OR (g.task_type NOT IN ('view','reaction') AND "
                "        u.balance >= g.payout + MAX(0, ROUND(g.payout * :fee / 100.0)))"
                "  ) "
                "  AND g.group_id NOT IN (SELECT group_id FROM joins WHERE user_id=:uid) "
                "ORDER BY RANDOM() LIMIT :lim",
                {"uid": user_id, "system": SYSTEM_USER_ID,
                 "fee": float(FEE_PERCENT), "lim": limit},
            ).fetchall()

    # ── featured onboarding ─────────────────────────────────────────────
    def featured_task(self) -> sqlite3.Row | None:
        return self.get_group(FEATURED_GROUP_ID)

    def featured_due(self, user_id: int, now: float | None = None) -> bool:
        """Whether the featured task should be shown on /start."""
        # Keep this small compatibility API equivalent to featured_should_show.
        from config import FEATURED_RESHOW_DAYS
        return self.featured_should_show(user_id, FEATURED_RESHOW_DAYS, now=now)

    def mark_featured_shown(self, user_id: int, shown_at: float | None = None,
                            now: float | None = None) -> None:
        # ``now`` is accepted as a friendly test/caller alias.
        stamp = shown_at if shown_at is not None else now
        with self.lock:
            self.conn.execute(
                "UPDATE users SET featured_shown_at=? WHERE user_id=?",
                (time.time() if stamp is None else stamp, user_id),
            )
            self.conn.commit()

    def featured_should_show(self, user_id: int, reshow_days: int,
                             now: float | None = None) -> bool:
        now = time.time() if now is None else now
        with self.lock:
            if self.conn.execute(
                "SELECT 1 FROM joins WHERE group_id=? AND user_id=?",
                (FEATURED_GROUP_ID, user_id),
            ).fetchone():
                return False
            row = self.conn.execute(
                "SELECT featured_shown_at FROM users WHERE user_id=?", (user_id,)
            ).fetchone()
            if not row:
                return False
            return (
                not row["featured_shown_at"]
                or now - float(row["featured_shown_at"]) >= reshow_days * 86400
            )

    # ── joins ───────────────────────────────────────────────────────────
    def record_join(self, group_id: int, user_id: int, payout: int,
                    task_type: str | None = None) -> bool:
        """Record a pre-existing membership without awarding points."""
        with self.lock:
            if task_type is None:
                row = self.conn.execute(
                    "SELECT task_type FROM groups WHERE group_id=?", (group_id,)
                ).fetchone()
                task_type = row["task_type"] if row else "group"
            cur = self.conn.execute(
                "INSERT OR IGNORE INTO joins "
                "(group_id, user_id, payout, joined_at, task_type) VALUES (?,?,?,?,?)",
                (group_id, user_id, payout, time.time(), task_type),
            )
            self.conn.commit()
            return cur.rowcount > 0

    def award_join(self, group_id: int, joiner_id: int) -> tuple[bool, dict]:
        """Atomically reward a group/channel/view/reaction task."""
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
                already = self.conn.execute(
                    "SELECT 1 FROM joins WHERE group_id=? AND user_id=?",
                    (group_id, joiner_id),
                ).fetchone()
                if already:
                    self.conn.execute("ROLLBACK")
                    return False, {"reason": "already"}

                task_type = g["task_type"] or "group"
                payout = int(g["payout"])
                is_upfront = task_type in {"view", "reaction"}
                # A view/reaction task is a one-shot funded task.  Its reward
                # was reserved at add time, so its owner is not charged here.
                if is_upfront and g["total_received"] > 0:
                    self.conn.execute("ROLLBACK")
                    return False, {"reason": "already"}
                cost = 0 if is_upfront or g["owner_id"] == SYSTEM_USER_ID else cost_for(payout)
                if not is_upfront and g["owner_id"] != SYSTEM_USER_ID and owner["balance"] < cost:
                    self.conn.execute("ROLLBACK")
                    return False, {"reason": "owner_broke"}

                self.conn.execute(
                    "UPDATE users SET balance=balance+?, total_joins=total_joins+1 "
                    "WHERE user_id=?", (payout, joiner_id)
                )
                if cost:
                    self.conn.execute(
                        "UPDATE users SET balance=balance-? WHERE user_id=?",
                        (cost, g["owner_id"]),
                    )
                self.conn.execute(
                    "INSERT INTO joins (group_id,user_id,payout,joined_at,task_type) "
                    "VALUES (?,?,?,?,?)",
                    (group_id, joiner_id, payout, time.time(), task_type),
                )
                self.conn.execute(
                    "UPDATE groups SET total_received=total_received+1 WHERE group_id=?",
                    (group_id,),
                )
                self.conn.execute(
                    "DELETE FROM task_timers WHERE group_id=? AND user_id=?",
                    (group_id, joiner_id),
                )
                self.conn.commit()
                return True, {
                    "payout": payout,
                    "cost": cost,
                    "owner_id": g["owner_id"],
                    "title": g["title"],
                    "joiner_balance": joiner["balance"] + payout,
                    "task_type": task_type,
                }
            except Exception:
                self.conn.execute("ROLLBACK")
                raise

    def start_timer(self, group_id: int, user_id: int,
                    started_at: float | None = None) -> float:
        started_at = time.time() if started_at is None else started_at
        with self.lock:
            self.conn.execute(
                "INSERT OR IGNORE INTO task_timers(group_id,user_id,started_at) "
                "VALUES(?,?,?)", (group_id, user_id, started_at)
            )
            self.conn.commit()
            return self.timer_started_at(group_id, user_id) or started_at

    def timer_started_at(self, group_id: int, user_id: int) -> float | None:
        with self.lock:
            row = self.conn.execute(
                "SELECT started_at FROM task_timers WHERE group_id=? AND user_id=?",
                (group_id, user_id),
            ).fetchone()
            return float(row["started_at"]) if row else None

    def clear_timer(self, group_id: int, user_id: int) -> None:
        with self.lock:
            self.conn.execute(
                "DELETE FROM task_timers WHERE group_id=? AND user_id=?",
                (group_id, user_id),
            )
            self.conn.commit()

    def reverse_join(self, join_id: int) -> dict | None:
        """Reverse a group/channel reward, not view/reaction/featured rows."""
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
                task_type = j["task_type"] or "group"
                if not g:
                    self.conn.execute("DELETE FROM joins WHERE id=?", (join_id,))
                    self.conn.commit()
                    return None
                # Featured is intentionally permanent once joined; view /
                # reaction / bot-start joins are explicitly never reversed
                # (there is no membership that can be left).
                if task_type in {"view", "reaction", "bot"} or g["owner_id"] == SYSTEM_USER_ID:
                    self.conn.execute("ROLLBACK")
                    return None
                payout = int(j["payout"])
                cost = cost_for(payout)
                if payout:
                    self.conn.execute(
                        "UPDATE users SET balance=balance-? WHERE user_id=?",
                        (payout, j["user_id"]),
                    )
                if cost:
                    self.conn.execute(
                        "UPDATE users SET balance=balance+? WHERE user_id=?",
                        (cost, g["owner_id"]),
                    )
                self.conn.execute(
                    "UPDATE groups SET total_received=MAX(0,total_received-1) WHERE group_id=?",
                    (j["group_id"],),
                )
                self.conn.execute("DELETE FROM joins WHERE id=?", (join_id,))
                self.conn.commit()
                return {
                    "joiner_id": j["user_id"],
                    "owner_id": g["owner_id"],
                    "title": g["title"],
                    "payout": payout,
                    "cost": cost,
                    "task_type": task_type,
                }
            except Exception:
                self.conn.execute("ROLLBACK")
                raise

    def recent_joins(self, since_ts: float) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(
                "SELECT j.id,j.user_id,j.group_id,j.payout,j.task_type, "
                "g.title,g.owner_id,g.task_type AS group_task_type "
                "FROM joins j JOIN groups g ON g.group_id=j.group_id "
                "WHERE j.joined_at>=? ORDER BY j.id", (since_ts,)
            ).fetchall()

    # ── admin stats ─────────────────────────────────────────────────────
    def stats(self) -> dict:
        with self.lock:
            one = lambda q: self.conn.execute(q).fetchone()[0]  # noqa: E731
            return {
                "users": one("SELECT COUNT(*) FROM users WHERE user_id != 0"),
                "banned": one("SELECT COUNT(*) FROM users WHERE banned=1 AND user_id != 0"),
                "groups": one("SELECT COUNT(*) FROM groups WHERE owner_id != 0"),
                "active_groups": one("SELECT COUNT(*) FROM groups WHERE active=1 AND owner_id != 0"),
                "joins": one("SELECT COUNT(*) FROM joins"),
                "points": one("SELECT COALESCE(SUM(balance),0) FROM users WHERE user_id != 0"),
            }

    def close(self) -> None:
        with self.lock:
            self.conn.close()


DB = Database()
