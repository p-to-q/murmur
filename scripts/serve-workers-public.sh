#!/usr/bin/env bash
# serve-workers-public.sh — one command to put this Mac behind murmur.ptoq.io.
#
# Starts both workers (transcribe :8001, Magenta :8002), opens two Cloudflare
# quick tunnels, warms the models, and prints the public URLs. With
# --sync-vercel it also writes the URLs/tokens into the Vercel project's
# production env and triggers a redeploy (quick-tunnel URLs rotate on every
# restart, so re-run with --sync-vercel after a reboot).
#
#   bash scripts/serve-workers-public.sh                # serve only
#   bash scripts/serve-workers-public.sh --sync-vercel  # serve + rewire prod
#
# Keep the Mac awake while serving:  caffeinate -dims &
# Stop everything:                   Ctrl-C (children are cleaned up)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.workers.local"
SYNC_VERCEL="${1:-}"

# ── 1. Tokens (created once, reused forever) ──────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  printf "AUDIO_WORKER_TOKEN=%s\nMUSIC_WORKER_TOKEN=%s\n" \
    "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > "$ENV_FILE"
  echo "• created $ENV_FILE with fresh tokens"
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# ── 2. Workers (reuse if already healthy) ─────────────────────────────
if ! curl -sf -m 2 http://127.0.0.1:8001/health >/dev/null; then
  (cd "$ROOT/workers/audio-engine" && exec ./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001) &
  PIDS+=($!)
  echo "• audio-engine starting on :8001"
else
  echo "• audio-engine already up on :8001"
fi

if ! curl -sf -m 2 http://127.0.0.1:8002/health >/dev/null; then
  (cd "$ROOT/workers/music-engine" && MAGENTA_MODEL="${MAGENTA_MODEL:-mrt2_base}" \
    exec ./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8002) &
  PIDS+=($!)
  echo "• music-engine starting on :8002 (model load can take ~1 min)"
else
  echo "• music-engine already up on :8002"
fi

# ── 3. Tunnels ────────────────────────────────────────────────────────
A_LOG=$(mktemp) ; M_LOG=$(mktemp)
# --protocol http2: QUIC (UDP) gets silently dropped by some routers/ISPs
# after a while — tunnels then serve 530s while looking alive. TCP doesn't.
cloudflared tunnel --url http://127.0.0.1:8001 --no-autoupdate --protocol http2 >"$A_LOG" 2>&1 &
PIDS+=($!)
cloudflared tunnel --url http://127.0.0.1:8002 --no-autoupdate --protocol http2 >"$M_LOG" 2>&1 &
PIDS+=($!)

# `|| true` matters: grep exits 1 while the tunnel URL hasn't appeared yet,
# which would kill the whole script under `set -e`.
url_from() { { grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$1" 2>/dev/null || true; } | head -1; }
for _ in $(seq 1 30); do
  AUDIO_URL=$(url_from "$A_LOG"); MUSIC_URL=$(url_from "$M_LOG")
  [ -n "$AUDIO_URL" ] && [ -n "$MUSIC_URL" ] && break
  sleep 1
done
[ -n "${AUDIO_URL:-}" ] && [ -n "${MUSIC_URL:-}" ] || { echo "✗ tunnels failed to come up"; exit 1; }

# Persist the latest URLs next to the tokens.
grep -v '_WORKER_URL=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
mv "$ENV_FILE.tmp" "$ENV_FILE"
printf "AUDIO_WORKER_URL=%s\nMUSIC_WORKER_URL=%s\n" "$AUDIO_URL" "$MUSIC_URL" >> "$ENV_FILE"

# ── 4. Wait for health + warm the models ─────────────────────────────
echo "• waiting for workers…"
for _ in $(seq 1 60); do
  curl -sf -m 3 http://127.0.0.1:8001/health >/dev/null \
    && curl -s -m 3 http://127.0.0.1:8002/health | grep -q '"loaded":true' && break
  sleep 5
done

# First transcribe lazy-loads the pitch model (~40 s) — warm it now so the
# first visitor doesn't eat the cold start.
"$ROOT/workers/audio-engine/.venv/bin/python" - <<'PY' > /tmp/murmur-warm.wav.b64 || true
import base64, io, math, struct, sys, wave
buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    for i in range(16000):
        w.writeframes(struct.pack("<h", int(12000 * math.sin(2 * math.pi * 330 * i / 16000))))
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
PY
base64 -d /tmp/murmur-warm.wav.b64 > /tmp/murmur-warm.wav 2>/dev/null || true
if [ -s /tmp/murmur-warm.wav ]; then
  curl -s -m 90 -X POST http://127.0.0.1:8001/transcribe \
    -H "Authorization: Bearer $AUDIO_WORKER_TOKEN" \
    -F "audio=@/tmp/murmur-warm.wav;type=audio/wav" >/dev/null || true
  echo "• pitch model warmed"
fi

echo
echo "  AUDIO_WORKER_URL=$AUDIO_URL"
echo "  MUSIC_WORKER_URL=$MUSIC_URL"
echo

# ── 5. Optional: rewire Vercel production ─────────────────────────────
if [ "$SYNC_VERCEL" = "--sync-vercel" ]; then
  for KV in "AUDIO_WORKER_URL=$AUDIO_URL" "AUDIO_WORKER_TOKEN=$AUDIO_WORKER_TOKEN" \
            "MUSIC_WORKER_URL=$MUSIC_URL" "MUSIC_WORKER_TOKEN=$MUSIC_WORKER_TOKEN"; do
    printf '%s' "${KV#*=}" | vercel env add "${KV%%=*}" production --force >/dev/null 2>&1
  done
  echo "• Vercel production env updated — redeploying…"
  (cd "$ROOT" && vercel --prod --yes >/dev/null 2>&1) \
    && echo "• redeployed: https://murmur.ptoq.io" \
    || echo "✗ redeploy failed — run 'vercel --prod' manually"
fi

echo "Serving. Keep this window open (Ctrl-C stops workers + tunnels)."
wait
