# Server Deployment Guide

> **Status:** PREPARATION. This guide describes the **target** self-hosted
> server procedure. It has not been executed; the current Freebuff deployment
> remains live and untouched (**OWNER DECISION REQUIRED** for execution).

---

## 1. Scope & prerequisites

- One Linux VM (Ubuntu 22.04+ LTS recommended) with Docker Engine 24+ and
  Docker Compose v2. Sizing: SELF_HOSTING_GUIDE §4.
- DNS records for the public hostnames (app + backend/dashboard).
- Outbound HTTPS for integrations (Resend, M-Pesa, SMS provider).
- Repo access on a workstation (never build on the VM — see OOM note in
  SELF_HOSTING_GUIDE §4 sizing notes).

Related docs: SECRET_MANAGEMENT_GUIDE (secrets), CONVEX_SELF_HOST_MIGRATION_
PLAN (data cutover), EMAIL_RESEND_MIGRATION (email), scripts/README-migration
(tool docs).

---

## 2. Provisioning the host

```bash
# Docker Engine + Compose plugin (Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker schoolcore   # dedicated service user, no sudo for app ops

# Firewall: only what is needed
sudo ufw allow 22/tcp        # ssh (restrict source IP if possible)
sudo ufw allow 80,443/tcp
sudo ufw enable

# Create persistent data layout
sudo mkdir -p /var/lib/schoolcore/{convex,backups}
sudo install -d -m 700 /etc/schoolcore
sudo install -m 600 /dev/null /etc/schoolcore/schoolcore.env
sudoedit /etc/schoolcore/schoolcore.env   # SECRET_MANAGEMENT_GUIDE §4
```

---

## 3. Docker requirements

### 3.1 Images

| Component | Image | Notes |
| --- | --- | --- |
| Convex backend | official self-hosted backend image (see [Convex self-hosting docs](https://docs.convex.dev/production/hosting/self-hosting)) | Provides functions runtime, DB, and file storage; pin a version |
| Convex dashboard | companion dashboard image (same docs) | Admin UI for the self-hosted backend |
| App (SPA) | built from repo `Dockerfile` (below) | nginx serving `dist/` |
| Reverse proxy | Caddy (recommended: automatic TLS) or Traefik/Nginx | TLS termination |

### 3.2 App Dockerfile (proposed, `deploy/Dockerfile`)

> Not created in this preparation phase (no deploy actions). Structure to add
> at execution time:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN corepack enable && bun install --frozen-lockfile
COPY . .
RUN bun run build          # "vite build" only — matches repo OOM mitigation
# No typecheck inside the image build (memory); CI runs tsc separately.

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
```

### 3.3 Compose layout (proposed, `deploy/compose.yaml`)

```yaml
services:
  app:
    build: { context: .., dockerfile: deploy/Dockerfile }
    image: schoolcore/app:<tag>
    restart: unless-stopped
    # static only — no secrets needed at runtime; VITE_* baked at build
  convex:
    image: convex/convex-backend:<pinned>
    restart: unless-stopped
    env_file: /etc/schoolcore/schoolcore.env
    volumes: [ /var/lib/schoolcore/convex:/data ]
  dashboard:
    image: convex/convex-dashboard:<pinned>
    restart: unless-stopped
  proxy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
volumes: { caddy_data: {} }
```

> Exact env/args for the official backend image (ports, admin key, instance
> name) come from the version-pinned self-hosting docs at execution time;
> verify against the docs, not this sketch.

---

## 4. Reverse proxy & TLS

### 4.1 Routes

| Hostname | Upstream | Notes |
| --- | --- | --- |
| `app.schoolcore.example` | `app:80` (nginx) | SPA; WebSocket upgrade for Convex client passes to backend host |
| `api.schoolcore.example` | `convex:32100` (backend HTTP) | Convex HTTP actions + client WebSocket |
| `dash.schoolcore.example` | `dashboard:port` | Admin dashboard — IP-allowlist or SSO-gate this |

Convex's browser client connects to `VITE_CONVEX_URL`; for self-host this
points at the public backend hostname. The SPA does not need to know the
app/API split — set `VITE_CONVEX_URL=https://api.…` at build time.

### 4.2 Caddyfile (proposed)

```caddy
app.schoolcore.example {
  encode gzip
  root * /srv/app        # proxy to app container per compose network
  reverse_proxy app:80
}

api.schoolcore.example {
  reverse_proxy convex:32100
}

dash.schoolcore.example {
  reverse_proxy dashboard:<port>
  # @blocked not allowlisted -> respond 403  (add at execution time)
}
```

### 4.3 TLS

- Caddy issues/renews certificates automatically (ACME/HTTP-01) — no manual
  cert handling; store nothing sensitive in the repo.
- If Traefik/Nginx preferred, use certbot + a volume for certs; renewals via
  systemd timer.
- HSTS recommended once TLS confirmed stable.

### 4.4 Nginx SPA config (inside app image)

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  location / { try_files $uri /index.html; }        # SPA fallback
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

---

## 5. Backups

| What | Method | Cadence | Retention |
| --- | --- | --- | --- |
| Convex data volume (`/var/lib/schoolcore/convex`) | volume snapshot / `restic`/`rsync` of a consistency-checked copy | daily | 7 daily, 4 weekly, 6 monthly |
| Config + secrets dir (`/etc/schoolcore`) | encrypted archive (restic crypt) | on change / weekly | 6 versions |
| Migration archives (pre-cutover) | encrypted at rest, off-site | per migration | per retention policy |

```bash
# Example daily backup (cron or systemd timer)
restic backup /var/lib/schoolcore/convex --tag schoolcore-data
restic backup /etc/schoolcore --tag schoolcore-config   # repo is sensitive
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

- **Test restores quarterly** — an untested backup is not a backup.
- Backups include the env file → treat backup target as secret-sensitive
  (SECRET_MANAGEMENT_GUIDE §4.3).
- Off-site target required (S3-compatible bucket or second host).

---

## 6. Monitoring

| Layer | Tool (suggestion) | Checks |
| --- | --- | --- |
| Host | node_exporter + Prometheus/Grafana, or a hosted agent | CPU/RAM/disk (data volume > 80% alert), load |
| Containers | `docker events`/healthchecks; cAdvisor | restart loops, OOM kills |
| App | uptime monitor hitting `https://app…` (status page service) | HTTP 200, TLS expiry |
| Backend | uptime probe of the backend HTTP endpoint; Convex dashboard health | function errors visible in dashboard logs |
| Logs | journald + `docker logs` rotation; optional Loki | error rate spikes |
| Alerts | e-mail via Resend (post-migration) or SMS | disk, service down, TLS expiry < 14 days |

Minimum viable monitoring if no stack is desired: a hosted uptime probe +
`systemd` restart policies + a daily disk-usage cron that emails via Resend.

---

## 7. Environment setup on the server

1. Secrets file: `/etc/schoolcore/schoolcore.env` (SECRET_MANAGEMENT_GUIDE §4)
   — root:root 0600, listed variables only, `SEED_SECRET` deliberately absent.
2. Compose references it via `env_file:` — values enter containers as plain
   environment variables at start; no dotenvx involved at any layer.
3. Build-time (`VITE_CONVEX_URL`) is passed to `docker build` as a build arg
   or a `.env.production` consumed by Vite on the **build machine**, not the
   server.
4. `NODE_ENV=production`, `SITE_URL`, `CONVEX_SITE_URL` must match the public
   hostnames (§4.1) or email links/callbacks will be wrong.

---

## 8. First deployment sequence (execution phase)

```bash
# On workstation (repo + bun):
bun install
bun tsc -b --noEmit && bun run build     # gates + static build
docker compose -f deploy/compose.yaml build app
# On server:
docker compose -f deploy/compose.yaml pull
docker compose -f deploy/compose.yaml up -d
# Push schema/functions to the self-hosted backend:
bunx convex push   # pointed at the self-hosted deployment per CLI docs
# Then data import + validation per CONVEX_SELF_HOST_MIGRATION_PLAN §4–5.
```

---

## 9. Security hardening checklist

- [ ] SSH: key-only, no root login, fail2ban
- [ ] `ufw` default-deny incoming; only 22/80/443
- [ ] Dashboard hostname IP-allowlisted (not public)
- [ ] Env file 0600 root:root; never world-readable
- [ ] Docker: no unnecessary `--privileged`; containers non-root where
      supported
- [ ] Automatic security updates (`unattended-upgrades`) for the OS
- [ ] Backup target access-restricted + encrypted
- [ ] TLS: ACME auto-renew verified; HSTS after stability
