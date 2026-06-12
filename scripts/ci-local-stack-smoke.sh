#!/usr/bin/env bash
set -euo pipefail

WEB_PORT="${MURMUR_CI_WEB_PORT:-3100}"
WORKER_PORT="${MURMUR_CI_WORKER_PORT:-8101}"
WEB_BASE="http://127.0.0.1:${WEB_PORT}"
WORKER_BASE="http://127.0.0.1:${WORKER_PORT}"
PYTHON_BIN="${PYTHON_BIN:-}"
WORKER_VENV_PYTHON="workers/audio-engine/.venv/bin/python"

if [[ -z "${PYTHON_BIN}" ]]; then
  if [[ -x "${WORKER_VENV_PYTHON}" ]]; then
    PYTHON_BIN="${WORKER_VENV_PYTHON}"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    echo "Neither python3 nor python is available." >&2
    exit 1
  fi
fi

web_log="$(mktemp -t murmur-web.XXXXXX.log)"
worker_log="$(mktemp -t murmur-worker.XXXXXX.log)"
web_pid=""
worker_pid=""

cleanup() {
  if [[ -n "${web_pid}" ]] && kill -0 "${web_pid}" 2>/dev/null; then
    kill "${web_pid}" 2>/dev/null || true
    wait "${web_pid}" 2>/dev/null || true
  fi
  if [[ -n "${worker_pid}" ]] && kill -0 "${worker_pid}" 2>/dev/null; then
    kill "${worker_pid}" 2>/dev/null || true
    wait "${worker_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

export AUTH_SECRET="${AUTH_SECRET:-murmur-ci-smoke-secret}"
unset GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET 2>/dev/null || true

"${PYTHON_BIN}" -m uvicorn \
  --app-dir workers/audio-engine \
  main:app \
  --host 127.0.0.1 \
  --port "${WORKER_PORT}" \
  >"${worker_log}" 2>&1 &
worker_pid=$!

bun start --hostname 127.0.0.1 --port "${WEB_PORT}" >"${web_log}" 2>&1 &
web_pid=$!

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts="${3:-40}"
  local delay="${4:-0.5}"

  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay}"
  done

  echo "Timed out waiting for ${label} at ${url}" >&2
  echo "--- ${label} log ---" >&2
  if [[ "${label}" == "web" ]]; then
    cat "${web_log}" >&2 || true
  else
    cat "${worker_log}" >&2 || true
  fi
  return 1
}

wait_for_url "${WORKER_BASE}/health" "worker"
wait_for_url "${WEB_BASE}" "web"
wait_for_url "${WEB_BASE}/api/qa/health" "web-api"

MURMUR_WEB_BASE_URL="${WEB_BASE}" AUDIO_WORKER_URL="${WORKER_BASE}" bun run smoke:local
MURMUR_WEB_BASE_URL="${WEB_BASE}" bun run smoke:pages
