# Deploying Barry's site (own VM on Google Cloud)

Nothing in `deploy/` runs by itself. `gcp-setup.sh` creates billable resources, so run it yourself, on purpose.

**Cost (approx., verify in the pricing calculator):** VM e2-micro ~ $6/month, 20 GB standard disk ~ $0.8/month, static IPv4 ~ $3.65/month,
traffic and backups ~ free at this size, so about **$10/month (~$120/year)**. The domain can be a subdomain of one you already own.
Create a **budget alert** first (`gcloud billing budgets create ...`, or Cloud Console > Billing > Budgets). The amount must be in the billing account's currency (ours is JPY, e.g. 2500JPY).

## First time

1. Test locally: `cp .env.example .env`, set `DOMAIN=localhost`, then `docker compose up --build` (use another port mapping if 80/443 are taken).
2. `PROJECT=<gcp-project-id> ./deploy/gcp-setup.sh` creates the static IP, firewall rule, VM (with swap + Docker) and a 30-day backup bucket.
3. Add a DNS **A record**: your domain -> the IP the script prints.
4. `cp .env.example .env.production` and set `ADMIN_PASSWORD` (long), `SESSION_SECRET` (random), `DOMAIN`, `BUCKET`. Then `./deploy/deploy.sh env`.
5. `./deploy/deploy.sh` builds the image on your computer (linux/amd64), ships it and starts it. Caddy gets the HTTPS certificate automatically (DNS must already point at the VM).
6. `./deploy/deploy.sh backup-install` installs the nightly backup.

All `deploy.sh` commands need `PROJECT=<gcp-project-id>` (and optionally `ZONE`, `INSTANCE`).

## Updating

`PROJECT=... ./deploy/deploy.sh`. Photos, comments and settings live in the Docker volume `barry_barry_data` and survive it.
Verify once after the first real deploy: upload a test photo, redeploy, check the photo is still there.

**Never run** `docker compose down -v`, `docker volume rm` or `docker system prune --volumes` on the VM: they delete the data.
The compose project name is pinned to `barry` so the volume name never depends on the folder you deploy from.

## Backups and restore

Nightly at 03:00 the VM archives the volume to `gs://<BUCKET>/barry/barry-data-<date>.tar.gz` (kept 30 days).

Restore (on the VM, `sudo` for docker):
```bash
gcloud storage cp gs://<BUCKET>/barry/barry-data-<date>.tar.gz /tmp/restore.tar.gz
cd ~/barry && sudo docker compose stop barry
sudo docker run --rm -v barry_barry_data:/data -v /tmp:/in alpine sh -c 'rm -rf /data/* && tar xzf /in/restore.tar.gz -C /data && chown -R 1000:1000 /data'
sudo docker compose start barry
```
(uid 1000 is the `node` user inside the image.)

## Admin password

Change it any time in the admin: header **Password** button (current password, then the new one twice, at least 10 characters).
It is stored hashed in the site data (so the nightly backup covers it) and signs out every other browser.
Until you do, the initial `ADMIN_PASSWORD` from `.env` is the password.

Forgot it? On the VM, clear the stored one so the `.env` password works again, then sign in and set a new one:
```bash
sudo docker exec barry-barry-1 node server/reset-admin-password.js && cd ~/barry && sudo docker compose restart barry
```

## Checks

- App logs: `./deploy/deploy.sh logs`. Memory: `ssh` in and run `free -h` and `sudo docker stats --no-stream`.
- Expect about 120 MB used in total (app ~50 MB, Caddy ~70 MB). If the VM ever runs out of memory, switch the machine type to e2-small.
