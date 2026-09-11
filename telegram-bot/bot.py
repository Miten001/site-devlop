#!/usr/bin/env python3
"""FlexFam Sub4Sub Bot — entry point.

Chalane se pehle BOT_TOKEN env var (ya .env file) set karo:
    export BOT_TOKEN="123456:ABC..."
    export ADMIN_IDS="123456789"
    python bot.py
"""

import logging
import sys

from config import ADMIN_IDS, BOT_TOKEN

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("flexfam")


def main() -> None:
    if not BOT_TOKEN:
        log.error("BOT_TOKEN set nahi hai! .env file banao ya env var do. "
                  "Token @BotFather se milta hai.")
        sys.exit(1)
    if not ADMIN_IDS:
        log.warning("ADMIN_IDS set nahi hai — admin commands kaam nahi karenge.")

    from handlers import create_application

    app = create_application(BOT_TOKEN)
    log.info("🚀 FlexFam Sub4Sub bot chalu ho raha hai…")
    app.run_polling(allowed_updates=["message", "callback_query", "my_chat_member"],
                    drop_pending_updates=True)


if __name__ == "__main__":
    main()
