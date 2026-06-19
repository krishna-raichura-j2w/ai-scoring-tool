#!/usr/bin/env bash
#
# deploy.sh — pull latest, rebuild, and redeploy the AI Scoring Tool.
#
# What it does:
#   1. Records the current commit + backs up the current frontend build.
#   2. git pull --ff-only from origin/master.
#   3. Installs server + client deps and rebuilds the React SPA.
#   4. Reloads the PM2 backend (single Express process serving /api + the SPA).
#   5. Health-checks the app locally AND through the public domain.
#
# If ANY step fails (clone/build/restart/health check), it automatically
# rolls back to the previous commit + previous build, restarts, and re-verifies.
#
# Caddy routing is intentionally NOT touched here — it is stable infra that
# does not change on a code deploy. (Reminder: the Caddyfile is a single-file
# docker bind mount, so routing changes require `docker restart recruiter-caddy`,
# not a reload — out of scope for this script.)
#
set -Eeuo pipefail

# ----------------------------------------------------------------- config ----
APP_DIR="/home/ubuntu/ai-scoring-tool"
PM2_APP="ai-scoring-agent"
PM2_CONFIG="ecosystem.config.cjs"
BRANCH="master"
REMOTE="origin"

HEALTH_LOCAL="http://localhost:3001/api/clients"
HEALTH_PUBLIC="https://mrr-process-tracker.joulestowatts.com/j2w-ai-scoring-agent/api/clients"

HEALTH_RETRIES=20      # attempts
HEALTH_DELAY=2         # seconds between attempts

# ----------------------------------------------------------------- helpers ---
log()  { printf '\033[1;34m[deploy %(%H:%M:%S)T]\033[0m %s\n' -1 "$*"; }
ok()   { printf '\033[1;32m[deploy %(%H:%M:%S)T]\033[0m %s\n' -1 "$*"; }
err()  { printf '\033[1;31m[deploy %(%H:%M:%S)T]\033[0m %s\n' -1 "$*" >&2; }

# Poll a URL until it returns HTTP 200, or fail after the retry budget.
healthcheck() {
  local name="$1" url="$2" i code
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000")
    if [[ "$code" == "200" ]]; then
      ok "health OK ($name): $url -> 200 (attempt $i)"
      return 0
    fi
    log "waiting for $name ... ($url -> $code, attempt $i/$HEALTH_RETRIES)"
    sleep "$HEALTH_DELAY"
  done
  err "health FAILED ($name): $url never returned 200"
  return 1
}

# (Re)start the backend under PM2 from the ecosystem config.
restart_pm2() {
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    pm2 reload "$PM2_CONFIG" --update-env
  else
    pm2 start "$PM2_CONFIG"
  fi
  pm2 save >/dev/null 2>&1 || true
}

# ----------------------------------------------------------------- rollback --
ROLLED_BACK=0
rollback() {
  trap - ERR                       # disable the trap so rollback can't recurse
  ROLLED_BACK=1
  err "deploy failed — rolling back to ${PREV_COMMIT:-<unknown>}"

  if [[ -n "${PREV_COMMIT:-}" ]]; then
    git reset --hard "$PREV_COMMIT" || err "git reset failed (continuing rollback)"
  fi

  # client/dist is gitignored, so restore the build we backed up.
  if [[ -n "${DIST_BAK:-}" && -d "$DIST_BAK" ]]; then
    rm -rf "$APP_DIR/client/dist"
    cp -r "$DIST_BAK" "$APP_DIR/client/dist"
    log "restored previous frontend build"
  fi

  # Re-sync server deps to the rolled-back package files (best effort).
  npm install --no-audit --no-fund >/dev/null 2>&1 || err "npm install during rollback failed (continuing)"

  restart_pm2 || err "pm2 restart during rollback failed"

  if healthcheck "local (rollback)" "$HEALTH_LOCAL"; then
    err "ROLLBACK COMPLETE — previous version is live again."
  else
    err "ROLLBACK FINISHED but local health check still failing — MANUAL INTERVENTION NEEDED. Check: pm2 logs $PM2_APP"
  fi
  exit 1
}

# ----------------------------------------------------------------- main -------
cd "$APP_DIR"

# Sanity: must be a git repo with the expected remote/branch.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { err "not a git repo: $APP_DIR"; exit 1; }
git remote get-url "$REMOTE" >/dev/null 2>&1 || { err "remote '$REMOTE' not configured"; exit 1; }

PREV_COMMIT="$(git rev-parse HEAD)"
log "current commit: $PREV_COMMIT"

# Back up the current frontend build so rollback is instant and build-failure-proof.
DIST_BAK=""
if [[ -d "$APP_DIR/client/dist" ]]; then
  DIST_BAK="$(mktemp -d)/dist"
  cp -r "$APP_DIR/client/dist" "$DIST_BAK"
  log "backed up current build to $DIST_BAK"
fi

# From here on, any failure triggers an automatic rollback.
trap rollback ERR

log "fetching $REMOTE/$BRANCH ..."
git fetch "$REMOTE" "$BRANCH"

TARGET_COMMIT="$(git rev-parse "$REMOTE/$BRANCH")"
if [[ "$TARGET_COMMIT" == "$PREV_COMMIT" ]]; then
  log "already up to date with $REMOTE/$BRANCH — redeploying same commit."
else
  log "updating $PREV_COMMIT -> $TARGET_COMMIT"
fi

# Fast-forward only: refuse to deploy if local has diverged (avoids surprise merges).
git merge --ff-only "$REMOTE/$BRANCH"

log "installing server dependencies ..."
npm install --no-audit --no-fund

log "building frontend (client) ..."
npm run build

log "reloading PM2 app '$PM2_APP' ..."
restart_pm2

# Verify the deploy: locally first, then through the public domain.
healthcheck "local"  "$HEALTH_LOCAL"
healthcheck "domain" "$HEALTH_PUBLIC"

# Success — drop the ERR trap and report.
trap - ERR
ok "DEPLOY SUCCESSFUL — now at $(git rev-parse --short HEAD)"
ok "Live: https://mrr-process-tracker.joulestowatts.com/j2w-ai-scoring-agent/"
pm2 describe "$PM2_APP" | grep -E 'status|uptime|restarts' || true
