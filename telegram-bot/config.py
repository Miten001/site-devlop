"""FlexFam Sub4Sub Bot — configuration (env vars se load hota hai)."""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    # telegram-bot/.env aur repo root .env dono try karo
    load_dotenv(Path(__file__).parent / ".env")
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:  # python-dotenv na ho to seedha env vars use honge
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
DATABASE_PATH: str = os.getenv("DATABASE_PATH", str(Path(__file__).parent / "data" / "bot.db"))

# ── Points economy (sab env se change kar sakte ho) ─────────────────────
SIGNUP_BONUS: int = int(os.getenv("SIGNUP_BONUS", "50"))      # naye user ko
REFERRAL_BONUS: int = int(os.getenv("REFERRAL_BONUS", "25"))  # per referral
DAILY_BONUS: int = int(os.getenv("DAILY_BONUS", "10"))        # roz ka bonus
MIN_PAYOUT: int = int(os.getenv("MIN_PAYOUT", "5"))           # min pts per join
MAX_PAYOUT: int = int(os.getenv("MAX_PAYOUT", "50"))          # max pts per join
FEE_PERCENT: int = int(os.getenv("FEE_PERCENT", "20"))        # promoter par fee %
MAX_GROUPS_PER_USER: int = int(os.getenv("MAX_GROUPS_PER_USER", "5"))

# Kitne ghante tak join re-verify honge (group chhoda to points wapas)
LEAVE_CHECK_HOURS: int = int(os.getenv("LEAVE_CHECK_HOURS", "72"))


def fee_for(payout: int) -> int:
    """Payout par platform fee (points me). Joiner ko payout milta hai,
    group owner se payout + fee kata hai."""
    return max(1, round(payout * FEE_PERCENT / 100))


def cost_for(payout: int) -> int:
    """Owner ka total cost per join."""
    return payout + fee_for(payout)
