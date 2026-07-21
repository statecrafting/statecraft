#!/bin/bash
# enrahitu single-container entrypoint: rauthy (loopback :8081) + the Encore app
# (:8080, which proxies /auth/* to rauthy). Die-together supervision: if either
# process exits, the container exits and the restart policy recovers it.
set -euo pipefail

DATA="${ENRAHITU_DATA_DIR:-/data}"
PUBLIC_URL="${ENRAHITU_PUBLIC_URL:-http://localhost:8080}"
PUBLIC_URL="${PUBLIC_URL%/}"

node /enrahitu/first-boot.mjs

# secrets.env carries RAUTHY_-prefixed material for the rauthy process and
# ENRAHITU_HIQ_* for the app; written by first-boot.mjs, chmod 0600.
# shellcheck disable=SC1091
. "$DATA/rauthy/secrets.env"

proto="${PUBLIC_URL%%://*}"
hostport="${PUBLIC_URL#*://}"
hostport="${hostport%%/*}"
host="${hostport%%:*}"

# ---------------------------------------------------------------------------
# rauthy: bound to loopback, reachable only through the app's /auth proxy.
# Env is scoped to the subshell so nothing leaks into the app process.
# ---------------------------------------------------------------------------
(
  export LISTEN_ADDRESS=127.0.0.1
  export LISTEN_PORT_HTTP=8081
  export LISTEN_SCHEME=http
  export PUB_URL="$hostport"
  if [ "$proto" = "https" ]; then
    # Behind the app proxy + external TLS termination; rauthy then mints
    # https URLs (its issuer-scheme rule is `https unless plain-http listener
    # AND no proxy_mode`).
    export PROXY_MODE=true
    export TRUSTED_PROXIES="127.0.0.0/8"
  else
    # Plain-http public URL = a local trial of the packaged image. rauthy's
    # default __Host- session cookie carries Secure, which Safari refuses to
    # store over http (even on localhost), silently breaking every login
    # with a sub-millisecond 401 (session/CSRF missing, not bad password).
    export COOKIE_MODE=danger-insecure
  fi
  export RP_ID="$host"
  export RP_ORIGIN="$PUBLIC_URL"
  export ENC_KEYS="$RAUTHY_ENC_KEYS"
  export ENC_KEY_ACTIVE="$RAUTHY_ENC_KEY_ACTIVE"
  export HQL_SECRET_RAFT="$RAUTHY_HQL_SECRET_RAFT"
  export HQL_SECRET_API="$RAUTHY_HQL_SECRET_API"
  export BOOTSTRAP_DIR="$DATA/rauthy/bootstrap"
  export BOOTSTRAP_ADMIN_EMAIL="${ENRAHITU_ADMIN_EMAIL:-admin@example.com}"
  BOOTSTRAP_ADMIN_PASSWORD_PLAIN="$(cat "$DATA/rauthy/admin-password")"
  export BOOTSTRAP_ADMIN_PASSWORD_PLAIN
  # SMTP passthrough. rauthy reads these exact names (its config.toml documents
  # each as "overwritten by: SMTP_*"), and the operator catalog's smtp group
  # uses the same spellings, so the deploy passes them straight through.
  # Without this rauthy keeps its `smtp_url = 'localhost'` default and every
  # send fails: no password reset, no email verification, no MFA recovery.
  # Gated on SMTP_URL so a local trial of the image needs no mail server.
  if [ -n "${SMTP_URL:-}" ]; then
    export SMTP_URL
    for _smtp in SMTP_PORT SMTP_USERNAME SMTP_PASSWORD SMTP_FROM; do
      if [ -n "${!_smtp:-}" ]; then export "${_smtp?}"; fi
    done
    echo "[entrypoint] rauthy SMTP enabled via $SMTP_URL"
  else
    echo "[entrypoint] no SMTP_URL; rauthy mail is disabled (password reset unavailable)" >&2
  fi
  # rauthy's native hiqlite S3 backup. Unlike a file-level copy of /data, this
  # is a real quiesced hiqlite snapshot, so it is the only consistent backup of
  # the identity database. The operator-facing names are RAUTHY_S3_*; rauthy
  # reads HQL_S3_*, and the translation happens here rather than by renaming
  # what the catalog documents. Gated on RAUTHY_S3_URL, so omitting the group
  # disables backups instead of failing the boot.
  if [ -n "${RAUTHY_S3_URL:-}" ]; then
    export HQL_S3_URL="$RAUTHY_S3_URL"
    export HQL_S3_BUCKET="${RAUTHY_S3_BUCKET:-}"
    export HQL_S3_REGION="${RAUTHY_S3_REGION:-}"
    export HQL_S3_KEY="${RAUTHY_S3_ACCESS_KEY_ID:-}"
    export HQL_S3_SECRET="${RAUTHY_S3_SECRET_ACCESS_KEY:-}"
    # Hetzner Object Storage is addressed path-style (endpoint/bucket), which
    # is also how the restic repository URL is written.
    export HQL_S3_PATH_STYLE=true
    # 01:30 UTC, deliberately one hour BEFORE the /data restic CronJob at
    # 02:30. rauthy writes its consistent dump locally as well as to S3, so
    # ordering it first means the volume backup then captures a fresh quiesced
    # dump alongside the live (and inevitably torn) database files. The two
    # mechanisms compose instead of overlapping. rauthy's cron is 7-field:
    # sec min hour dom mon dow year.
    export HQL_BACKUP_CRON="${RAUTHY_BACKUP_CRON:-0 30 1 * * * *}"
    export HQL_BACKUP_KEEP_DAYS="${RAUTHY_BACKUP_KEEP_DAYS:-30}"
    echo "[entrypoint] rauthy hiqlite S3 backups enabled -> $HQL_S3_URL/$HQL_S3_BUCKET"
  else
    echo "[entrypoint] no RAUTHY_S3_URL; rauthy hiqlite S3 backups are disabled" >&2
  fi
  cd /rauthy
  exec ./rauthy serve
) &
RAUTHY_PID=$!

# Wait for rauthy before the app starts issuing discovery requests.
# (node:24-slim has no curl; node does the probing.)
for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:8081/auth/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  if ! kill -0 "$RAUTHY_PID" 2>/dev/null; then
    echo "[entrypoint] rauthy exited during startup" >&2
    exit 1
  fi
  sleep 1
done
echo "[entrypoint] rauthy is up on 127.0.0.1:8081"

# ---------------------------------------------------------------------------
# the Encore app
# ---------------------------------------------------------------------------
export NODE_ENV=production
export AUTH_DRIVER=rauthy
export FRONTEND_URL="$PUBLIC_URL"
export RAUTHY_ISSUER="$PUBLIC_URL/auth/v1/"
export RAUTHY_CLIENT_ID=enrahitu
export RAUTHY_REDIRECT_URI="$PUBLIC_URL/api/v1/auth/rauthy/callback"
export RAUTHY_UPSTREAM="http://127.0.0.1:8081"
export ENRAHITU_KEYS_DIR="$DATA/keys"
# infra.config.json binds the app's secrets to these env vars ($env refs,
# resolved at runtime); the material was generated by first-boot.mjs.
JWT_PRIVATE_KEY="$(cat "$DATA/keys/access-private.pem")"
JWT_PUBLIC_KEY="$(cat "$DATA/keys/access-public.pem")"
JWT_REFRESH_PRIVATE_KEY="$(cat "$DATA/keys/refresh-private.pem")"
JWT_REFRESH_PUBLIC_KEY="$(cat "$DATA/keys/refresh-public.pem")"
RAUTHY_CLIENT_SECRET="$(cat "$DATA/keys/rauthy-client-secret")"
export JWT_PRIVATE_KEY JWT_PUBLIC_KEY JWT_REFRESH_PRIVATE_KEY JWT_REFRESH_PUBLIC_KEY RAUTHY_CLIENT_SECRET
export ENRAHITU_LEDGER_URL="${ENRAHITU_LEDGER_URL:-file:$DATA/ledger/enrahitu.db}"
export ENRAHITU_HIQ_DATA_DIR="$DATA/hiqlite"
# rauthy's embedded hiqlite owns 8100/8200 in this network namespace.
export ENRAHITU_HIQ_ADDR_RAFT=127.0.0.1:8300
export ENRAHITU_HIQ_ADDR_API=127.0.0.1:8400

# The encore build docker image start command (asserted against the base
# image by scripts/docker-build.sh).
cd /workspace
node --enable-source-maps /workspace/.encore/build/combined/combined/main.mjs &
APP_PID=$!

# Die together: first exit takes the container down; restart policy recovers.
set +e
wait -n "$RAUTHY_PID" "$APP_PID"
STATUS=$?
echo "[entrypoint] a supervised process exited (status $STATUS); stopping container" >&2
kill "$RAUTHY_PID" "$APP_PID" 2>/dev/null
wait
exit "$STATUS"
