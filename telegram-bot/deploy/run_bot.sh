#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlexFam Sub4Sub Bot — GitHub Actions runner script
#
# Kya karta hai:
#   1. bot-state branch se encrypted DB restore karta hai (points safe rehte
#      hain, har restart par naye nahi hote)
#   2. bot ko RUN_MINUTES ke liye chalata hai (Actions ki 6h limit se kam)
#   3. har SYNC_EVERY sec me DB encrypt karke bot-state branch pe push karta
#      hai — encryption key BOT_TOKEN se derive hoti hai, isliye public repo
#      me user data safe hai
#   4. end par final sync + next scheduled run (cron */5) turant bot utha
#      leta hai → 24/7 uptime
#
# Local test: bash telegram-bot/deploy/run_bot.sh --selftest
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SYNC_BRANCH="${SYNC_BRANCH:-bot-state}"
RUN_MINUTES="${RUN_MINUTES:-330}"
SYNC_EVERY="${SYNC_EVERY:-600}"

log() { echo "[$(date -u +%H:%M:%S)] [deploy] $*"; }

# DB encryption key = SHA256(BOT_TOKEN) — token sirf secrets me hai,
# isliye public repo pe encrypted blob safe hai.
db_key() { printf '%s' "${BOT_TOKEN:?}" | sha256sum | awk '{print $1}'; }

sync_db() {
  # WAL checkpoint — saare recent writes main db file me le aao
  python3 -c "import sqlite3; sqlite3.connect('data/bot.db').execute('PRAGMA wal_checkpoint(TRUNCATE)')" >/dev/null 2>&1 || true
  local key blob tree commit
  key=$(db_key) || return 1
  openssl enc -aes-256-cbc -pbkdf2 -pass "pass:$key" \
    -in data/bot.db -out bot.db.enc 2>/dev/null || { log "ERROR: encrypt fail"; return 1; }
  blob=$(git hash-object -w bot.db.enc) || return 1
  tree=$(printf '100644 blob %s\tbot.db.enc\n' "$blob" | git mktree) || return 1
  commit=$(git -c user.name=flexfam-bot -c user.email=bot@users.noreply.github.com \
    commit-tree "$tree" -m "bot db sync $(date -u +%FT%TZ)") || return 1
  if git push -q origin "+${commit}:refs/heads/${SYNC_BRANCH}" 2>/dev/null; then
    log "db synced → ${SYNC_BRANCH} (${commit:0:7})"
  else
    log "ERROR: db push fail"
    return 1
  fi
}

restore_db() {
  mkdir -p data
  [ -f data/bot.db ] && { log "db pehle se hai"; return 0; }
  if ! git fetch --depth=1 -q origin "$SYNC_BRANCH" 2>/dev/null; then
    log "koi saved db nahi — fresh start (naya bot)"
    return 0
  fi
  if ! git show "FETCH_HEAD:bot.db.enc" > bot.db.enc 2>/dev/null; then
    log "${SYNC_BRANCH} pe db nahi mila — fresh start"
    return 0
  fi
  local key
  key=$(db_key) || return 1
  if openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$key" \
    -in bot.db.enc -out data/bot.db 2>/dev/null; then
    log "db restore ho gaya ✓ (users + points wapas)"
  else
    log "FATAL: db decrypt fail — BOT_TOKEN change hua hai? data bachane ke liye rok raha hoon."
    exit 1
  fi
}

# ── selftest (local, bina Telegram ke) ──────────────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
  set -e
  export BOT_TOKEN="SELFTEST:FAKE_TOKEN_123"
  T="$(mktemp -d)"
  git init -q --bare "$T/origin.git"
  git clone -q "$T/origin.git" "$T/wc"
  cd "$T/wc"
  git config user.email t@t.local && git config user.name t
  mkdir -p data
  python3 -c "
import sqlite3
c = sqlite3.connect('data/bot.db')
c.execute('CREATE TABLE t(x)')
c.execute('INSERT INTO t VALUES (42)')
c.commit()
"
  echo "── sync test"
  sync_db
  [ "$(git ls-remote --heads origin | grep -c "refs/heads/${SYNC_BRANCH}")" = "1" ] && echo "PASS: bot-state branch bana"
  echo "── restore test (fresh clone)"
  git clone -q "$T/origin.git" "$T/wc2"
  cd "$T/wc2"
  mkdir -p data
  git fetch --depth=1 -q origin "$SYNC_BRANCH"
  git show "FETCH_HEAD:bot.db.enc" > "$T/enc"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$(db_key)" -in "$T/enc" -out data/bot.db
  cmp -s data/bot.db "$T/wc/data/bot.db" && echo "PASS: restore identical"
  python3 -c "import sqlite3; assert sqlite3.connect('data/bot.db').execute('SELECT x FROM t').fetchone()[0] == 42; print('PASS: db readable')"
  echo "── SELFTEST SAB PASS ✓"
  exit 0
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── main ─────────────────────────────────────────────────────────────────────
if [ -z "${BOT_TOKEN:-}" ]; then
  {
    echo "## ⏳ BOT_TOKEN secret abhi set nahi hai"
    echo ""
    echo "Bot chalane ke liye bas yeh karo:"
    echo ""
    echo "1. Yeh link kholo: **https://github.com/${GITHUB_REPOSITORY:-OWNER/REPO}/settings/secrets/actions**"
    echo "2. **New repository secret** dabao"
    echo "3. Name: \`BOT_TOKEN\` — Secret: apna bot token (BotFather wala)"
    echo "4. Add secret dabao"
    echo ""
    echo "Bas! 5 minute ke andar bot apne aap start ho jayega (cron har 5 min me check karta hai)."
  } >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
  log "BOT_TOKEN secret missing — Settings → Secrets → Actions me BOT_TOKEN add karo. (Har 5 min me dobara try hoga.)"
  exit 0
fi

log "python deps install ho rahi hain…"
python3 -m pip install --quiet --disable-pip-version-check -r requirements.txt

restore_db

log "bot start — ${RUN_MINUTES} min (phir auto-restart)"
timeout --signal=INT --kill-after=90 $((RUN_MINUTES * 60)) python3 -u bot.py &
BOT_PID=$!

trap 'log "shutdown signal — final sync"; kill -INT "$BOT_PID" 2>/dev/null' TERM INT

( while true; do sleep "$SYNC_EVERY"; sync_db || true; done ) &
SYNC_PID=$!

wait "$BOT_PID"
RC=$?
kill "$SYNC_PID" 2>/dev/null
wait "$SYNC_PID" 2>/dev/null

sync_db || true
log "bot band (rc=$RC) — final db sync done. Agla run scheduled hai."
