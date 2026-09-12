"""FlexFam Telegram bot configuration.

The defaults intentionally describe the production economy.  Every value can
still be overridden with an environment variable for local development.
"""

import os
import re
from pathlib import Path

try:
    from dotenv import load_dotenv

    # Try both telegram-bot/.env and the repository root .env
    load_dotenv(Path(__file__).parent / ".env")
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:  # python-dotenv is optional
    pass


def _parse_ids(raw: str) -> set[int]:
    ids = set()
    for part in raw.replace(",", " ").split():
        try:
            ids.add(int(part))
        except ValueError:
            continue
    return ids


# ── Core ────────────────────────────────────────────────────────────────
BOT_TOKEN: str = os.getenv("BOT_TOKEN", "")
ADMIN_IDS: set[int] = _parse_ids(os.getenv("ADMIN_IDS", ""))
DATABASE_PATH: str = os.getenv(
    "DATABASE_PATH", str(Path(__file__).parent / "data" / "bot.db")
)

# ── Points economy ─────────────────────────────────────────────────────
# Production defaults: referral is the only bonus and there is no platform fee.
SIGNUP_BONUS: int = int(os.getenv("SIGNUP_BONUS", "0"))
REFERRAL_BONUS: int = int(os.getenv("REFERRAL_BONUS", "25"))
DAILY_BONUS: int = int(os.getenv("DAILY_BONUS", "0"))
FEE_PERCENT: int = int(os.getenv("FEE_PERCENT", "0"))
MIN_PAYOUT: int = int(os.getenv("MIN_PAYOUT", "5"))
MAX_PAYOUT: int = int(os.getenv("MAX_PAYOUT", "50"))
# 0 means unlimited: a user may add as many tasks as they like.
MAX_GROUPS_PER_USER: int = int(os.getenv("MAX_GROUPS_PER_USER", "0"))
VIEW_TIMER_SECONDS: int = int(os.getenv("VIEW_TIMER_SECONDS", "30"))

# How many hours joins are re-verified for (leaving a group/channel reverses
# the points that were awarded for it).
LEAVE_CHECK_HOURS: int = int(os.getenv("LEAVE_CHECK_HOURS", "72"))

# ── Dead-task protection ────────────────────────────────────────────────
# A task that keeps being skipped and never completed is "dead": nobody wants
# it.  After DEAD_TASK_SKIP_LIMIT consecutive skips with zero completions the
# task is auto-paused and its owner collects a warning strike.  At
# DEAD_TASK_MAX_STRIKES strikes every task of that owner is paused and the
# admins are alerted.
DEAD_TASK_SKIP_LIMIT: int = int(os.getenv("DEAD_TASK_SKIP_LIMIT", "15"))
DEAD_TASK_MAX_STRIKES: int = int(os.getenv("DEAD_TASK_MAX_STRIKES", "3"))

# A post task always has the strict, single-slash Telegram post format.
POST_LINK_RE = re.compile(
    r"^(?:https?://)?(?:t\.me|telegram\.me)/"
    r"([A-Za-z][A-Za-z0-9_]{3,31})/(\d{1,10})/?$",
    re.IGNORECASE,
)

# ── Featured onboarding task ────────────────────────────────────────────
FEATURED_LINK: str = os.getenv("FEATURED_LINK", "https://t.me/flex_fam")
FEATURED_PAYOUT: int = int(os.getenv("FEATURED_PAYOUT", "10"))
FEATURED_RESHOW_DAYS: int = int(os.getenv("FEATURED_RESHOW_DAYS", "2"))
SYSTEM_USER_ID = 0
SYSTEM_BALANCE = 999_999_999
FEATURED_GROUP_ID = 0


def fee_for(payout: int) -> int:
    """Platform fee in points.

    With the production configuration this returns exactly zero.  There is no
    artificial minimum fee: a zero-percent fee must remain a zero fee.
    """
    return max(0, round(payout * FEE_PERCENT / 100))


def cost_for(payout: int) -> int:
    """The owner's total cost per rewarded join."""
    return payout + fee_for(payout)


def task_limit_reached(count: int) -> bool:
    """Whether a user who already owns ``count`` tasks may not add another.

    ``MAX_GROUPS_PER_USER <= 0`` disables the limit entirely (the default).
    """
    return MAX_GROUPS_PER_USER > 0 and count >= MAX_GROUPS_PER_USER
