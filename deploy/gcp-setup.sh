#!/usr/bin/env bash
# ONE-TIME: creates the Google Cloud resources for Barry's site. NOTHING here runs automatically,
# and it creates billable resources (VM ~ $6/month + disk + IPv4 address ~ $3.65/month). Read it, then run it
# yourself:   PROJECT=<your-project-id> ./deploy/gcp-setup.sh
#
# Creates: a static IP, a firewall rule (80/443), the VM (Debian 12, e2-micro, 20 GB standard disk, with a
# 1 GB swap file so Docker fits), and a backup bucket that deletes backups older than 30 days.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT=<gcp project id>}"
REGION="${REGION:-asia-east1}"        # Taiwan: closest to most visitors (Taiwan/Japan/Korea). us-central1 is a bit cheaper.
ZONE="${ZONE:-asia-east1-b}"
INSTANCE="${INSTANCE:-barry-server}"
MACHINE="${MACHINE:-e2-micro}"        # 1 GB RAM. Use e2-small (2 GB, ~ +$6/month) if it ever feels tight.
BUCKET="${BUCKET:-${PROJECT}-barry-backups}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

g() { gcloud --project="$PROJECT" "$@"; }

echo "==> Reserving a static IP (so the DNS record never changes)..."
g compute addresses create barry-ip --region="$REGION" 2>/dev/null || echo "    (already exists)"
IP="$(g compute addresses describe barry-ip --region="$REGION" --format='value(address)')"

echo "==> Firewall: allow web traffic to VMs tagged barry-web..."
g compute firewall-rules create barry-allow-web --allow=tcp:80,tcp:443,udp:443 --target-tags=barry-web 2>/dev/null || echo "    (already exists)"

echo "==> Creating the VM..."
g compute instances create "$INSTANCE" \
  --zone="$ZONE" --machine-type="$MACHINE" \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-standard \
  --address=barry-ip --tags=barry-web \
  --scopes=storage-rw \
  --metadata-from-file=startup-script="$HERE/vm-startup.sh" 2>/dev/null || echo "    (already exists)"

echo "==> Backup bucket (30-day retention)..."
g storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access 2>/dev/null || echo "    (already exists)"
LIFECYCLE="$(mktemp)"
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > "$LIFECYCLE"
g storage buckets update "gs://$BUCKET" --lifecycle-file="$LIFECYCLE"
rm -f "$LIFECYCLE"

cat <<MSG

Done. Next:
  1. Create a DNS A record:  <your domain>  ->  $IP
  2. Wait ~2 minutes for the VM's startup script (installs Docker), then put your settings on it:
       cp .env.example .env.production   # edit: ADMIN_PASSWORD, SESSION_SECRET, DOMAIN
       ./deploy/deploy.sh env
  3. ./deploy/deploy.sh            # build locally, ship, start
  4. ./deploy/deploy.sh backup-install
  5. In the Cloud Console create a BUDGET ALERT (e.g. \$15/month) so a surprise bill can't happen.
MSG
