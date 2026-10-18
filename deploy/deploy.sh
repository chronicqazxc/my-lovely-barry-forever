#!/usr/bin/env bash
# Deploys Barry's site to its own VM. The image is built HERE (for the VM's linux/amd64) and shipped, never built
# on the 1 GB VM (a build there can run it out of memory).
#
#   ./deploy/deploy.sh                # build + ship image + config, restart
#   ./deploy/deploy.sh config         # only compose/Caddy config changes
#   ./deploy/deploy.sh env            # copy .env.production to the VM (first time, or when settings change)
#   ./deploy/deploy.sh backup-install # install the nightly backup (cron) on the VM
#   ./deploy/deploy.sh logs           # tail the app logs
#
# Data (photos, db.json) lives in the Docker volume barry_barry_data and survives all of the above.
# Never run `docker compose down -v` or `docker volume rm` on the VM: that deletes it.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT=<gcp project id>}"
ZONE="${ZONE:-asia-east1-b}"
INSTANCE="${INSTANCE:-barry-server}"
REMOTE_DIR="~/barry"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
MODE="${1:-all}"

ssh_cmd() { gcloud --project="$PROJECT" compute ssh --zone="$ZONE" "$INSTANCE" --command="$1"; }
scp_to() { gcloud --project="$PROJECT" compute scp --zone="$ZONE" "$@" "$INSTANCE:$REMOTE_DIR/"; }
prep() { ssh_cmd "mkdir -p $REMOTE_DIR"; }

sync_config() {
  echo "==> Syncing compose + Caddy config..."
  prep
  scp_to "$ROOT/docker-compose.yml" "$ROOT/Caddyfile"
}

case "$MODE" in
  env)
    [ -f "$ROOT/.env.production" ] || { echo "Create .env.production first (copy .env.example and fill it in)." >&2; exit 1; }
    prep
    gcloud --project="$PROJECT" compute scp --zone="$ZONE" "$ROOT/.env.production" "$INSTANCE:$REMOTE_DIR/.env"
    ssh_cmd "chmod 600 $REMOTE_DIR/.env"
    echo "==> .env installed on the VM."
    ;;
  config)
    sync_config
    ssh_cmd "cd $REMOTE_DIR && sudo docker compose up -d --no-build"
    ;;
  backup-install)
    prep
    scp_to "$HERE/backup.sh"
    ssh_cmd "chmod +x $REMOTE_DIR/backup.sh && (sudo crontab -l 2>/dev/null | grep -v barry/backup.sh; echo \"0 3 * * * BUCKET=\$(grep ^BUCKET= $REMOTE_DIR/.env | cut -d= -f2) \$HOME/barry/backup.sh >> /var/log/barry-backup.log 2>&1\") | sudo crontab -"
    echo "==> Nightly backup installed (03:00). Add BUCKET=<bucket name> to .env.production and run: ./deploy/deploy.sh env"
    ;;
  logs)
    ssh_cmd "cd $REMOTE_DIR && sudo docker compose logs --tail=100 -f barry"
    ;;
  all)
    echo "==> Building the image locally for linux/amd64..."
    docker buildx build --platform linux/amd64 -t barry:latest --load "$ROOT"
    echo "==> Saving + shipping the image..."
    TMP="$(mktemp -t barry-image.XXXXXX)"
    docker save barry:latest | gzip > "$TMP"
    sync_config
    scp_to "$TMP"
    ssh_cmd "cd $REMOTE_DIR && gunzip -c $(basename "$TMP") | sudo docker load && rm -f $(basename "$TMP") && sudo docker compose up -d --no-build && sudo docker image prune -f >/dev/null"
    rm -f "$TMP"
    echo "==> Done. Checking..."
    ssh_cmd "cd $REMOTE_DIR && sudo docker compose ps && free -h | head -2"
    ;;
  *)
    echo "Usage: $0 [all|config|env|backup-install|logs]" >&2
    exit 1
    ;;
esac
