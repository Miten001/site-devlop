#!/usr/bin/env python3
"""FlexFam Sub4Sub Bot — entry point.

Set the BOT_TOKEN environment variable (or a .env file) before running:
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
        log.error("BOT_TOKEN is not set! Create a .env file or export the "
                  "environment variable. Get a token from @BotFather.")
        sys.exit(1)
    if not ADMIN_IDS:
        log.warning("ADMIN_IDS is not set — admin commands will not work.")

    from handlers import create_application

    app = create_application(BOT_TOKEN)
    log.info("🚀 Starting the FlexFam Sub4Sub bot…")
    app.run_polling(allowed_updates=["message", "callback_query", "my_chat_member"],
                    drop_pending_updates=True)


if __name__ == "__main__":
    main()
