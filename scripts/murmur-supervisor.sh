#!/usr/bin/env bash
# murmur-supervisor.sh — keep the Murmur worker stack alive, self-healing.
#
# Why not launchd? The repo lives under ~/Desktop and the Magenta model under
# ~/Documents — both macOS-TCC-protected, which launchd-spawned processes may
# NOT read ("Operation not permitted", exit 126). So the stack is supervised
# here instead, from a shell that DOES have disk access (this one). The loop:
#
#   • starts + restarts both uvicorn workers (audio :8001, music :8002),
#     forcibly reclaiming a hung worker by freeing its port;
#   • starts + restarts both cloudflared quick tunnels;
#   • whenever a tunnel URL rotates (every cloudflared restart mints a new one)
#     AND both tunnels route end-to-end, rewrites the Vercel production env and
#     redeploys — so prod never silently falls back to the structured engine;
#   • warms the pitch model after each (re)sync.
#
# It survives closing the terminal and logging out. A full reboot stops it —
# re-arm with one command:  bash scripts/murmur-supervisor.sh start
#
#   bash scripts/murmur-supervisor.sh start     # launch detached + adopt ports
#   bash scripts/murmur-supervisor.sh status    # supervisor + worker/tunnel state
#   bash scripts/murmur-supervisor.sh stop       # stop supervisor + all children
#   bash scripts/murmur-supervisor.sh logs       # tail everything
#
# Logs: ~/Library/Logs/murmur/*.log
set -o pipefail  # no -e/-u: a long-running supervisor must never die on a transient error or an unset optional var

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.workers.local"
LOG_DIR="$HOME/Library/Logs/murmur"
PIDFILE="$LOG_DIR/supervisor.pid"
STATEFILE="$LOG_DIR/synced-urls.state"
TICK="${MURMUR_SUPERVISOR_TICK:-15}"
export PATH="/opt/homebrew/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
mkdir -p "$LOG_DIR"

ts()  { date '+%F %T'; }
slog() { printf '%s %s\n' "$(ts)" "$*" >>"$LOG_DIR/supervisor.log"; }

ensure_tokens() {
  if [ ! -f "$ENV_FILE" ]; then
    printf "AUDIO_WORKER_TOKEN=%s\nMUSIC_WORKER_TOKEN=%s\n" \
      "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > "$ENV_FILE"
  fi
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
}

port_listener() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }
worker_healthy() { curl -sf -m 3 "http://127.0.0.1:$1/health" >/dev/null 2>&1; }
edge_ok() { [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$1/health" 2>/dev/null)" = "200" ]; }
url_from() { { grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$1" 2>/dev/null || true; } | tail -1; }

# ── workers ───────────────────────────────────────────────────────────
start_worker() { # engine port
  local engine="$1" port="$2" stale
  stale="$(port_listener "$port")"
  [ -n "$stale" ] && { kill "$stale" 2>/dev/null; sleep 1; kill -9 "$stale" 2>/dev/null; }
  ( cd "$ROOT/workers/$engine" && MAGENTA_MODEL="${MAGENTA_MODEL:-mrt2_base}" \
      exec ./.venv/bin/uvicorn main:app --host 127.0.0.1 --port "$port" ) \
      >>"$LOG_DIR/$engine.log" 2>&1 &
  slog "started $engine on :$port (pid $!)"
}

# ── tunnels ───────────────────────────────────────────────────────────
# Two scalars instead of an associative array — macOS ships bash 3.2, which
# has no `declare -A`; with it, both tunnels would collapse to index 0.
TUN_PID_audio=""
TUN_PID_music=""
TUN_FAIL_audio=0
TUN_FAIL_music=0
start_tunnel() { # name port
  local name="$1" port="$2"
  local log="$LOG_DIR/tunnel-$name.log"
  : > "$log"
  # --protocol http2: QUIC (UDP) gets silently dropped by some networks — the
  # tunnel then serves 530s while looking alive. TCP doesn't.
  cloudflared tunnel --url "http://127.0.0.1:$port" --no-autoupdate --protocol http2 \
      >>"$log" 2>&1 &
  eval "TUN_PID_$name=$!"
  slog "started tunnel-$name → :$port (pid $!)"
}
tunnel_alive() { local v="TUN_PID_$1"; local p="${!v}"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

# A cloudflared process can stay alive while its edge connection silently
# drops — the tunnel then serves 000/530 even though `kill -0` says "alive".
# PID checks miss that, so also probe end-to-end and restart after 2 consecutive
# misses (long enough to ignore a transient blip or a still-warming tunnel).
heal_tunnel() { # name port url
  local name="$1" port="$2" url="$3"
  [ -z "$url" ] && return 0
  if edge_ok "$url"; then eval "TUN_FAIL_$name=0"; return 0; fi
  local fv="TUN_FAIL_$name"; local f=$(( ${!fv} + 1 )); eval "TUN_FAIL_$name=$f"
  slog "tunnel-$name not routing (edge miss $f) url=$url"
  if [ "$f" -ge 2 ]; then
    slog "tunnel-$name half-dead → restarting"
    local pv="TUN_PID_$name"; local p="${!pv}"; [ -n "$p" ] && kill "$p" 2>/dev/null
    start_tunnel "$name" "$port"
    eval "TUN_FAIL_$name=0"
  fi
}

# ── Vercel re-sync (only when the URL pair actually changes) ───────────
sync_vercel() { # audio_url music_url
  local a="$1" m="$2" ok=1
  slog "tunnel URLs changed → syncing prod: audio=$a music=$m"
  grep -v '_WORKER_URL=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  printf "AUDIO_WORKER_URL=%s\nMUSIC_WORKER_URL=%s\n" "$a" "$m" >> "$ENV_FILE"
  for KV in "AUDIO_WORKER_URL=$a" "AUDIO_WORKER_TOKEN=${AUDIO_WORKER_TOKEN:-}" \
            "MUSIC_WORKER_URL=$m" "MUSIC_WORKER_TOKEN=${MUSIC_WORKER_TOKEN:-}"; do
    printf '%s' "${KV#*=}" | (cd "$ROOT" && vercel env add "${KV%%=*}" production --force) \
      >>"$LOG_DIR/vercel-deploy.log" 2>&1 || ok=0
  done
  if [ "$ok" = 1 ] && (cd "$ROOT" && vercel --prod --yes) >>"$LOG_DIR/vercel-deploy.log" 2>&1; then
    printf '%s %s' "$a" "$m" > "$STATEFILE"
    slog "prod redeployed: https://murmur.ptoq.io"
    warm_audio
  else
    slog "sync failed (env ok=$ok) — will retry next tick"
  fi
}

warm_audio() {
  local wav=/tmp/murmur-warm.wav
  "$ROOT/workers/audio-engine/.venv/bin/python" - <<'PY' > "$wav.b64" 2>/dev/null || return 0
import base64, io, math, struct, sys, wave
buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    for i in range(16000):
        w.writeframes(struct.pack("<h", int(12000 * math.sin(2 * math.pi * 330 * i / 16000))))
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
PY
  base64 -d "$wav.b64" > "$wav" 2>/dev/null || return 0
  [ -s "$wav" ] && curl -s -m 90 -X POST http://127.0.0.1:8001/transcribe \
    -H "Authorization: Bearer ${AUDIO_WORKER_TOKEN:-}" \
    -F "audio=@$wav;type=audio/wav" >/dev/null 2>&1 || true
  slog "pitch model warmed"
}

# ── main loop ─────────────────────────────────────────────────────────
run() {
  ensure_tokens
  echo $$ > "$PIDFILE"
  trap 'slog "supervisor stopping; killing children"; for p in "$TUN_PID_audio" "$TUN_PID_music"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; for pt in 8001 8002; do x=$(port_listener "$pt"); [ -n "$x" ] && kill "$x" 2>/dev/null; done; [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ] && rm -f "$PIDFILE"; exit 0' INT TERM

  slog "supervisor up (pid $$, tick ${TICK}s, root=$ROOT)"
  while :; do
    worker_healthy 8001 || start_worker audio-engine 8001
    worker_healthy 8002 || start_worker music-engine 8002
    tunnel_alive audio || start_tunnel audio 8001
    tunnel_alive music || start_tunnel music 8002
    heal_tunnel audio 8001 "$(url_from "$LOG_DIR/tunnel-audio.log")"
    heal_tunnel music 8002 "$(url_from "$LOG_DIR/tunnel-music.log")"

    local a m wanted have
    a="$(url_from "$LOG_DIR/tunnel-audio.log")"
    m="$(url_from "$LOG_DIR/tunnel-music.log")"
    wanted="$a $m"; have="$(cat "$STATEFILE" 2>/dev/null || true)"
    if [ -n "$a" ] && [ -n "$m" ] && [ "$wanted" != "$have" ] \
       && edge_ok "$a" && edge_ok "$m"; then
      sync_vercel "$a" "$m"
    fi
    sleep "$TICK"
  done
}

# ── CLI ───────────────────────────────────────────────────────────────
case "${1:-}" in
  run) run ;;  # internal: the foreground loop (start nohups this)
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
      echo "supervisor already running (pid $(cat "$PIDFILE"))"; exit 0
    fi
    nohup bash "$ROOT/scripts/murmur-supervisor.sh" run >>"$LOG_DIR/supervisor.log" 2>&1 &
    disown
    echo "• supervisor started (pid $!). Bringing up workers + tunnels…"
    echo "  Watch:  bash scripts/murmur-supervisor.sh status"
    ;;
  stop)
    # Wait for the process to fully die (so a following `start` never races the
    # dying supervisor's trap and ends up with a deleted PID file or duplicate).
    if [ -f "$PIDFILE" ]; then
      pid="$(cat "$PIDFILE")"
      kill "$pid" 2>/dev/null
      for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
      echo "• supervisor stopped"
    fi
    rm -f "$PIDFILE"
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
      echo "supervisor: RUNNING (pid $(cat "$PIDFILE"))"
    else
      echo "supervisor: stopped"
    fi
    for p in 8001 8002; do
      printf ':%s  ' "$p"; curl -sf -m 3 "http://127.0.0.1:$p/health" || printf 'DOWN'; echo
    done
    echo "tunnels:"
    grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_DIR/tunnel-audio.log" 2>/dev/null | tail -1 | sed 's/^/  audio: /'
    grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_DIR/tunnel-music.log" 2>/dev/null | tail -1 | sed 's/^/  music: /'
    echo "last synced: $(cat "$STATEFILE" 2>/dev/null || echo never)"
    ;;
  logs) tail -n 40 -F "$LOG_DIR"/supervisor.log "$LOG_DIR"/music-engine.log "$LOG_DIR"/audio-engine.log ;;
  *) echo "usage: $0 {start|stop|status|logs}" >&2; exit 1 ;;
esac
