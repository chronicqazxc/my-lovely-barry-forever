#!/usr/bin/env bash
# Runs ON THE VM (nightly via cron, see `deploy.sh backup-install`). Archives the data volume (db.json + uploads/)
# and copies it to the backup bucket. The bucket deletes copies after 30 days (lifecycle rule from gcp-setup.sh).
# db.json is written atomically, so a live archive is safe.
set -euo pipefail

BUCKET="${BUCKET:?set BUCKET (bucket name) in the environment}"
STAMP="$(date +%Y-%m-%d_%H%M)"
WORK="$(mktemp -d)"   # mode 700: the archive holds visitor data, so no other user on the VM can read it
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/barry-data-$STAMP.tar.gz"

docker run --rm -v barry_barry_data:/data:ro -v "$WORK":/out alpine \
  tar czf "/out/$(basename "$OUT")" -C /data .
gcloud storage cp "$OUT" "gs://$BUCKET/barry/$(basename "$OUT")"
echo "$(date -Is) backup ok: gs://$BUCKET/barry/$(basename "$OUT")"
