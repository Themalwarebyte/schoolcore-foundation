# Server Execution Approval Checklist

**Status:** PREPARATION ONLY — nothing in this document has been executed.
**Prepared:** 2026-09-26
**Target host:** `gman-02`
**Public entrypoint:** `https://schoolcore.ooflowdesk.com` via Cloudflare Tunnel

> Every command in this document is a **proposal**. No software has been installed,
> no directories created, no firewall or SSH configuration changed, no DNS records
> modified, and no application deployed. Each phase requires explicit Owner approval
> before execution.

---

## 0. Approved Architecture

| Decision | Value |
|---|---|
| Initial host | `gman-02` |
| Ingress | Cloudflare Tunnel (no router port forwarding) |
| Ports 80/443 | **Not exposed directly** |
| Host nginx | **Not modified** (OpenMediaVault-managed) |
| Dashboard | **Never publicly exposed** — Cloudflare Access |
| Deployment | Docker-based, portable |
| SSH | LAN + Tailscale both retained during setup |
| Freebuff/Convex Cloud | **Untouched — no data migration, no cutover** |

### Design consequence

Cloudflare Tunnel terminates TLS at Cloudflare's edge and forwards over an
outbound-only connection. Therefore **certbot, host certificates, host port 443,
and host-based nginx virtual hosts are all unnecessary**. The OMV conflict
identified during assessment is eliminated rather than mitigated.

```
Internet
  │
  ▼
Cloudflare edge  (TLS terminates here)
  │              (Cloudflare Access gates the dashboard hostname)
  ▼
cloudflared  ──outbound──▶  gman-02
  │
  ▼  (attaches to Docker network directly)
┌──────────────────────────────────────────────────────┐
│ schoolcore-net   (internal: true)                    │
│   nginx           :80   (container, reverse proxy)   │
│   convex-backend  :3210 (Convex API)                 │
│   convex-backend  :3211 (Convex HTTP Actions/site)   │
│   convex-dashboard:6791 (admin console)              │
│   postgres        :5432 (optional - see below)       │
└──────────────────────────────────────────────────────┘
        no ports published to the host
```

> **Ports verified against upstream** `get-convex/convex-backend`
> `self-hosted/README.md` and `self-hosted/docker/docker-compose.yml` (2026-09-27).
> - **3210** — Convex backend API
> - **3211** — Convex **HTTP Actions** / site endpoint (`SITE_PROXY_PORT`)
> - **6791** — Convex **dashboard** (`DASHBOARD_PORT`)
>
> An earlier revision of this document incorrectly listed 3211 as the dashboard
> port. Corrected here.
>
> **Database:** the self-hosted Convex backend defaults to **SQLite** in the
> `data` volume. PostgreSQL is **optional** and configured via `POSTGRES_URL`;
> it is *not* bundled into the backend image.

**Portability requirement:** no host-specific paths, interfaces, or tuning.
Moving to a future server must require only restoring state and re-pointing
the tunnel.

---

## 1. Current Server Baseline

Captured read-only at **2026-09-26T20:41Z**.

### Identity

| Item | Value |
|---|---|
| Hostname | `gman-02` |
| OS | Debian GNU/Linux 13 (trixie) |
| Kernel | `6.12.107-1` x86_64 |
| Uptime / load | 12h 35m, load 0.00 / 0.01 / 0.00 |
| Role | **OpenMediaVault 8.3.1-2 NAS** — not a dedicated app server |

### Resources

| Item | Value | Assessment |
|---|---|---|
| CPU | Intel Core i5-4300U @ 1.90GHz — 4 vCPU (2c × 2t) | 🔴 2013 mobile part |
| RAM | 15 GiB total, ~14 GiB available | 🟢 Ample |
| Swap | 16 GiB configured, unused | 🟡 Headroom available |
| Disk | `/dev/sda2` ext4, 3.6 TB total, **3.4 TB free (1%)** | 🟢 Ample |
| cgroup | **v2** (`cgroup2fs`) | 🟢 Docker compatible |

### Network

| Interface | Address | State |
|---|---|---|
| `eno1` (wired) | `192.168.1.200/24` | UP — default route via `192.168.1.1` |
| `tailscale0` | `100.80.65.109/32` | UP |
| `enp1s0` | — | DOWN |
| `wlx94ba064bc7f6` (WiFi) | — | DOWN |
| Public egress | `154.157.106.34` (NAT) | — |
| **Inbound from internet** | **NONE** (80/443/22 all closed) | Expected — tunnel is outbound |

Tailscale account: `Theboogieman1251@`. Administration workstation
(`desktop-1ao533p`, `100.65.135.12`) is on the tailnet **and** on the same LAN
(`192.168.1.189`) — both SSH paths are genuinely available.

### Listening TCP ports

| Bind | Port | Service | Exposure note |
|---|---|---|---|
| `0.0.0.0` | 80 | nginx (OMV) | Occupied — must not be contended |
| `0.0.0.0` | 22 | OpenSSH | Subject of Phase 2 |
| `0.0.0.0` | 111 | rpcbind | 🔴 Exposed, no firewall |
| `0.0.0.0` | 5355 | avahi/wsman | 🔴 Exposed, no firewall |
| `100.80.65.109` | 22000, 37891 | Tailscale | Expected |
| `127.0.0.1` | 8384 | Syncthing GUI | Local only — good |

### Running services (25)

`nginx` · `openmediavault-engined` · `syncthing@syncthing` · `tailscaled` ·
`php8.4-fpm` · `monit` · `collectd` · `rrdcached` · `smartmontools` ·
`ssh` · `avahi-daemon` · `rpcbind` · `chrony` · `rsyslog` · `cron` · `dbus` ·
`unattended-upgrades` · `getty@tty1` · `wpa_supplicant` (iface down) ·
`systemd-*`

### Firewall posture

```
-P INPUT ACCEPT        ← default policy ACCEPT
-P FORWARD ACCEPT
-P OUTPUT ACCEPT
```

`ufw` absent. `firewalld` absent. iptables/nft contain **only Tailscale-managed
chains** (`ts-input`, `ts-forward`). 🔴 **No host firewall filters LAN or internet
traffic.**

### OpenMediaVault nginx

`/etc/nginx/sites-enabled/` contains exactly one entry —
`openmediavault-webgui`, a symlink into `sites-available/`. The file opens with:

```
# This file is auto-generated by openmediavault
# WARNING: Do not edit this file, your changes will get lost.
```

`conf.d/` is empty. `nginx.conf` includes `conf.d/*.conf` (line 60) and
`sites-enabled/*` (line 61).

**Observed behaviour:** nginx returns **400 Bad Request** for every unrecognised
`Host` header — including `openmediavault-webgui` itself. OMV hardens its vhost
against unknown hosts.

### Other observations

- **No TLS anywhere.** certbot absent, `/etc/letsencrypt` does not exist.
- **Salt installed but dormant.** `salt-call` present, `/opt/saltstack/salt/`
  populated, `salt-minion` **inactive and disabled**. 🟡 Latent risk: an activated
  minion can rewrite configuration out of band. Owner decision pending.
- **`unattended-upgrades` enabled.** 🔴 Can auto-update and reboot without warning.
- **No container runtime.** `docker`, `podman`, `containerd`, `nerdctl` all absent.
  No `/var/run/docker.sock`. **No runtime conflicts.**

### Known risks

| # | Risk | Severity |
|---|---|---|
| R1 | **CPU is inadequate for a co-located production stack** — Convex backend + dashboard (+ optional PostgreSQL) alongside OMV, Syncthing, PHP-FPM, collectd, smartmontools on a 2013 dual-core part | 🔴 High |
| R2 | **No firewall**, and `rpcbind`/`avahi` already exposed on `0.0.0.0` | 🔴 High |
| R3 | **Docker bypasses host firewall policy** via the `DOCKER-USER` chain; publishing ports creates exposure regardless of `ufw` | 🔴 High |
| R4 | **SSH lockout on a NAS** — no cloud console; recovery requires physical access | 🔴 High |
| R5 | **Single disk, no redundancy** — database, backups, and application all on `/dev/sda2` | 🔴 High |
| R6 | OMV regenerates its nginx config; port 80 is already occupied | 🟡 Mitigated by design |
| R7 | `unattended-upgrades` may reboot during operation | 🟡 Medium |
| R8 | Dormant Salt minion | 🟡 Medium |
| R9 | Secrets and student PII co-located on a file-serving NAS | 🟡 Medium |
| R10 | Live secret exposure in GitHub history — **unrelated to this server, still open** | 🔴 High |

---

## 2. SSH Preparation

### Current access

| Path | Address | Status |
|---|---|---|
| LAN SSH | `192.168.1.200:22` | Available — workstation is on `192.168.1.0/24` |
| Tailscale SSH | `100.80.65.109:22` | Available — `ssh gman-remote` |

Both are used by the current administrative workstation. **Both must remain
available throughout setup.**

### Pre-flight checks

- [ ] Confirm LAN SSH works: `ssh ghub@192.168.1.200`
- [ ] Confirm Tailscale SSH works: `ssh gman-remote`
- [ ] Record the active public key: `cat ~/.ssh/gman02_admin_ed25519.pub`
- [ ] Verify a **second** key exists and is installed on the server
- [ ] Confirm passwordless sudo: `sudo -n true`
- [ ] Confirm physical recovery access (monitor + keyboard at `gman-02`)
- [ ] Verify IPMI / remote console if present — **not yet confirmed**

### Hardening path — DEFERRED, not in this phase

Per the approved decision, SSH is **not** locked down to Tailscale-only now.
Deferral is deliberate: Tailscale-only removes the LAN fallback, which is the
easiest recovery path on a NAS.

Future hardening sequence (each step independently reversible):

1. Verify key-based auth on **both** paths
2. `PasswordAuthentication no` — *keep a live session open*
3. `PermitRootLogin no`
4. `MaxAuthTries 3`
5. Restrict `AllowUsers` to the operations account
6. *Only then:* consider `ufw allow in on tailscale0 to any port 22`
7. *Last, after full confidence:* remove the LAN SSH allowance

### Rollback

| Change | Rollback |
|---|---|
| `sshd_config` edit | `sudo cp /etc/ssh/sshd_config.bak /etc/ssh/sshd_config && sudo systemctl restart ssh` |
| Firewall blocking port 22 | `sudo ufw disable` |
| Both | Physical console access |

**Mandatory discipline:** validate with `sudo sshd -t` before restarting `ssh`,
and maintain a second live session through every step.

---

## 3. Firewall Execution

> 🔴 **Highest-risk phase on this host.** Execute before Docker. Docker installs
> its own iptables rules and its `DOCKER-USER` chain is evaluated ahead of most
> host rules, so a firewall installed *after* Docker is largely ineffective.

### 3.1 Pre-checks

- [ ] `sudo -n true` — passwordless sudo confirmed
- [ ] `tailscale0` present: `ip -brief address show tailscale0`
- [ ] Tailscale healthy: `tailscale status`
- [ ] Current listeners recorded
- [ ] **Second SSH session open and confirmed working**

### 3.2 Backup current firewall state

```bash
sudo mkdir -p /root/firewall-backup
sudo iptables-save  > /root/firewall-backup/iptables-$(date +%F).rules
sudo ip6tables-save > /root/firewall-backup/ip6tables-$(date +%F).rules
sudo nft list ruleset > /root/firewall-backup/nftables-$(date +%F).ruleset
sudo ufw status verbose > /root/firewall-backup/ufw-$(date +%F).txt 2>&1
ls -la /root/firewall-backup/
```

**Rollback command:**
```bash
sudo iptables-restore < /root/firewall-backup/iptectl-<date>.rules
```

### 3.3 Installation order

Tailscale is permitted **first** — establishing it after a default-deny policy
risks losing tailnet connectivity.

```bash
# Step 1 — permit the tailnet (BEFORE any deny policy)
sudo ufw allow in on tailscale0 comment 'Tailscale interface'

# Step 2 — permit SSH on both paths (per approved decision: keep both)
sudo ufw allow 22/tcp comment 'SSH - LAN and Tailscale'

# Step 3 — policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Step 4 — enable
sudo ufw enable

# Step 5 — inspect
sudo ufw status verbose
```

### 3.4 Verification

- [ ] **Third-session SSH over Tailscale succeeds** ← the critical test
- [ ] SSH over LAN (`192.168.1.200`) succeeds
- [ ] `tailscale status` still healthy
- [ ] OMV web UI still reachable on port 80
- [ ] Only now close the extra sessions

### 3.5 Post-Docker hardening (separate phase, after Docker)

Docker's own documentation requires all container filtering in `DOCKER-USER`:

```bash
sudo iptables -N DOCKER-USER 2>/dev/null || true
sudo iptables -A DOCKER-USER -i lo     -j RETURN
sudo iptables -A DOCKER-USER -i tailscale0 -j RETURN
sudo iptables -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
sudo iptables -A DOCKER-USER -s 192.168.1.0/24 -j RETURN   # LAN admin
sudo iptables -A DOCKER-USER -j DROP
```

⚠️ **These rules do not survive a Docker restart.** Docker rewrites iptables on
every daemon start. They must be persisted (systemd unit or
`netfilter-persistent`) or they silently vanish.

**The internal-only network design means no ports are published, so this chain
should never actually filter application traffic** — it exists as defence in depth.

### Rollback

```bash
sudo ufw disable
sudo iptables-restore < /root/firewall-backup/iptables-<date>.rules
```

---

## 4. Docker Installation

### 4.1 Pre-checks

- [ ] Confirm no conflicting packages: `dpkg -l | grep -E 'docker|containerd|podman'`
- [ ] Confirm `cgroup` is v2: `stat -fc %T /sys/fs/cgroup` → expect `cgroup2fs`
- [ ] Confirm firewall is in place (Phase 3 complete)
- [ ] Confirm free space: `df -h /opt` → expect 3.4 TB

### 4.2 Official repository

Docker's official repo **carries a `trixie/` suite** (verified 2026-09-25, updated
the previous day). Debian 13 is a supported OS.

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
                    docker-buildx-plugin docker-compose-plugin
```

> Debian's own `docker.io` package is **not** used — it lags behind and ships
> Compose v1 rather than the v2 plugin.

### 4.3 Data-root and log limits

Container state lives on the 3.6 TB volume under `/opt/schoolcore`, keeping it
separate from OMV-managed data.

```bash
sudo install -d -m 0710 -o root -g docker /opt/schoolcore/docker

sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "data-root": "/opt/schoolcore/docker",
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF

sudo systemctl restart docker
```

⚠️ **`log-opts` is not optional.** Without a per-container cap, one chatty
container can fill a 3.6 TB volume with no visible cause.

### 4.4 Verification

- [ ] `sudo docker run --rm hello-world` succeeds
- [ ] `docker --version` and `docker compose version` both report
- [ ] `sudo docker info` shows `Docker Root Dir: /opt/schoolcore/docker`
- [ ] **`tailscale status` still healthy** — Docker inserts FORWARD rules that
      have coexisted badly with Tailscale chains before
- [ ] OMV web UI still reachable
- [ ] `sudo ufw status` unchanged

### Rollback

```bash
sudo systemctl stop docker
sudo apt purge docker-ce docker-ce-cli containerd.io \
                 docker-buildx-plugin docker-compose-plugin
sudo rm /etc/docker/daemon.json
sudo systemctl restart docker 2>/dev/null || true
```

---

## 5. Directory Preparation

### 5.1 Structure

```
/opt/schoolcore/
├── app/                     # application — read-only to containers
│   ├── frontend/             # built Vite dist/ artifacts
│   └── convex/               # self-hosted Convex configuration
├── deploy/                  # compose files, env template, scripts
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── .env.template         # placeholders only
├── secrets/                 # 0750 root:docker — NEVER bind-mounted
│   ├── .env
│   ├── convex-env/           # Convex deployment environment
│   ├── tls/                  # 0700 — private key material
│   └── backup.key            # backup encryption key
├── backups/                 # 0700 root:root — NEVER bind-mounted
│   ├── postgres/
│   ├── convex/
│   ├── configs/
│   └── restore-tests/
├── logs/                    # 0750 root:docker
│   ├── nginx/
│   ├── convex/
│   └── audit/
├── scripts/                 # 0750 root:root
│   ├── healthcheck.sh
│   ├── backup.sh
│   └── restore.sh
└── docker/                  # 0710 root:docker — Docker data-root
```

### 5.2 Commands

```bash
sudo install -d -m 0755 -o root -g root  /opt/schoolcore
sudo install -d -m 0755 -o root -g root  /opt/schoolcore/{app,deploy}
sudo install -d -m 0750 -o root -g docker /opt/schoolcore/{logs,secrets,scripts}
sudo install -d -m 0700 -o root -g root  /opt/schoolcore/backups
sudo install -d -m 0700 -o root -g root  /opt/schoolcore/secrets/tls
sudo install -d -m 0750 -o root -g docker /opt/schoolcore/backups/{postgres,convex,configs}
```

### 5.3 Permission model

| Path | Mode | Owner | Rationale |
|---|---|---|---|
| `/opt/schoolcore` | `0755` | root:root | Traversal only |
| `app/`, `deploy/` | `0755` | root:root | Read-only to containers |
| `logs/`, `secrets/`, `scripts/` | `0750` | root:docker | Container-writable, not world-readable |
| `secrets/tls/` | `0700` | root:root | Private key material |
| `backups/` | `0700` | root:root | Contains student PII |
| `docker/` | `0710` | root:docker | Docker daemon data-root |

### 5.4 Invariants

1. `secrets/` and `backups/` are **never bind-mounted** into any container.
   Secrets arrive via environment injection or Compose `secrets:`.
2. `app/` is written only by redeployment, never by a running container.
3. **No container port is ever published to the host.** Use `expose:`, never
   `ports:`. This is what keeps port 80 free for OMV and removes the need for
   `DOCKER-USER` filtering of application traffic.
4. An operational `schoolcore` user in the `docker` group performs routine work
   without `sudo`.

### 5.5 UID/GID warning

PostgreSQL containers commonly run as **UID 999**. Bind-mounted volumes owned by
`root:docker` will fail with permission denied. Resolve by using **named volumes**
for database data, or by setting an explicit `user:` in Compose. Decide before
the first `docker compose up`.

---

## 6. Cloudflare Tunnel Preparation

### 6.1 Account access required

| Requirement | Detail |
|---|---|
| Account | Cloudflare account authoritative for `ooflowdesk.com` |
| Nameservers | `steven.ns.cloudflare.com`, `ali.ns.cloudflare.com` |
| Tunnel creation | Zero Trust → Networks → Tunnels → Create tunnel |
| Credential | Yields a **TUNNEL_TOKEN** — never stored in this repository |
| Access policy | Zero Trust → Access → Applications, for the dashboard |
| Billing | Zero Trust Access is free for small teams |

### 6.2 Tunnel creation steps (performed in the Cloudflare dashboard)

- [ ] Create a named tunnel, e.g. `schoolcore-gman02`
- [ ] Choose the containerised or service-mode token variant
- [ ] **Copy the token to a secure location** — it is a bearer credential
- [ ] Do not commit the token to any repository

### 6.3 Hostname routing

| Public hostname | Service target | Access policy | Purpose |
|---|---|---|---|
| `schoolcore.ooflowdesk.com` | `http://nginx:80` | Public | Frontend |
| `schoolcore-api.ooflowdesk.com` | `http://convex-api:3210` | Public | Convex API |
| `schoolcore-dashboard.ooflowdesk.com` | `http://convex-dashboard:6791` | 🔒 **Cloudflare Access — deny by default** | Administrative console |

The tunnel **creates the DNS records automatically** (CNAME to
`<tunnel-id>.cfargotunnel.com`). DNS is therefore modified as a side effect of
tunnel configuration — **requires explicit approval**.

### 6.4 `cloudflared` installation

⚠️ **Re-verify the current Cloudflare install instructions at execution time.**
Cloudflare has changed its package repository URL more than once.

```bash
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
sudo apt update && sudo apt install -y cloudflared

sudo cloudflared service install <TUNNEL_TOKEN>
```

Service mode (token-based) is preferred over a config file — no credential
material persists on disk in readable form.

### 6.5 Dashboard protection — mandatory

The Convex dashboard is an **administrative console over the entire database**,
including student PII, staff records, and financial data.

- [ ] Create an Access application for `schoolcore-dashboard.ooflowdesk.com`
- [ ] Policy: **deny by default**, allow only named identities
- [ ] Use an identity provider allow-list (email OTP or SSO)
- [ ] **No bypass for any IP range**
- [ ] Verify from an untrusted network that an unauthenticated request returns
      **403**
- [ ] Verify the tunnel itself never exposes the dashboard port to the host

### 6.6 Rollback

```bash
sudo cloudflared service uninstall
```
Then delete the tunnel and its DNS records in the Cloudflare dashboard.

---

## 7. Security Controls

### 7.1 No secrets in GitHub — OPEN, HIGHEST SEVERITY

`.env.keys` containing `DOTENV_PRIVATE_KEY_LOCAL` is **tracked in Git history and
present on GitHub**, reachable through `main` and **all 22 annotated tags**. A
historical `VLY_EMAIL_OTP_API_KEY` literal was also exposed in
`src/convex/auth/emailOtp.ts` and remains in history.

- [ ] Rotate `DOTENV_PRIVATE_KEY_LOCAL` — requires **dotenvx account access**
- [ ] Rotate anything the key could decrypt
- [ ] Rotate the historical `VLY_EMAIL_OTP_API_KEY` — requires **provider access**
- [ ] Purge history with `git-filter-repo` — requires **GitHub write auth** (now
      available; `migration-backup` pushed to origin at `b15a5a6`)
- [ ] Decide the 22-tag policy: rewrite in place (recommended) or delete
- [ ] Correct the inaccurate remediation claim at `README.md:337-344`

**Rotation is the actual fix.** The purge is cleanup; a rotated key is dead
regardless of what history says. The 22 tags are all unsigned, so rewriting them
loses no cryptographic material.

### 7.2 Firewall

Covered in §3. Summary of intent:

- Default-deny incoming, allow outgoing
- Permit `tailscale0` before enabling any policy
- Permit SSH on LAN and Tailscale during setup
- All container traffic filtered in `DOCKER-USER`, persisted across restarts
- No published container ports, so the chain is defence in depth only

### 7.3 SSH protection

Covered in §2. Hardening is **deferred** by approved decision. Both LAN and
Tailscale paths remain available.

### 7.4 Dashboard protection

Covered in §6.5. Cloudflare Access, deny-by-default, verified by an external 403.

### 7.5 Backup encryption

- [ ] Generate an `age` keypair: `sudo age-keygen -o /opt/schoolcore/secrets/backup.key`
- [ ] Encrypt every backup containing student PII before it leaves the container
- [ ] **Delete plaintext dumps immediately** after encryption
- [ ] Store `backup.key` **separately** from the backups it protects
- [ ] `secrets/` backed up separately, encrypted, to a different destination
- [ ] Never back up secrets alongside data — rotation is preferable to restoring
      from a backup that may have leaked

### 7.6 General

- [ ] Secrets injected via environment, never baked into images
- [ ] No `.env` file ever committed; `.gitignore` retains `.env*` with
      `!.env.example`
- [ ] Production deployment starts **empty** — never run the demo seed against it
      (`docs/production-deployment.md:7-9`)
- [ ] Demo credentials from `README.md:184-197` must not be seeded to production

---

## 8. Backup Preparation

### 8.1 Local backups

```bash
# PostgreSQL — dump from inside the container, no host client required
sudo docker exec schoolcore-postgres \
  pg_dump -U convex -Fc convex \
  > /opt/schoolcore/backups/postgres/$(date +%F).dump

# Encrypt at rest — this dump contains student PII
sudo age -r "$(cat /opt/schoolcore/secrets/backup.key.pub)" \
  -o /opt/schoolcore/backups/postgres/$(date +%F).dump.age \
     /opt/schoolcore/backups/postgres/$(date +%F).dump
sudo rm /opt/schoolcore/backups/postgres/$(date +%F).dump

# Configuration
sudo tar czf /opt/schoolcore/backups/configs/deploy-$(date +%F).tar.gz \
  /opt/schoolcore/deploy /opt/schoolcore/app
```

**Retention:** 7 daily · 4 weekly · 6 monthly.

### 8.2 Off-site replication

`/dev/sda2` is a **single disk with no redundancy**. A backup on the same disk as
the database is not a backup. 🔴

`Syncthing is active and enabled` on `gman-02` — existing infrastructure that can
replicate off-host without adding a new dependency.

- [ ] Create a dedicated, **encrypted** Syncthing folder for `/opt/schoolcore/backups`
- [ ] Pair with a second physical device
- [ ] Confirm the paired device is on a **different** host
- [ ] Verify replication actually completes — a configured folder is not a
      replicated folder
- [ ] Confirm the replica is also encrypted

### 8.3 Restore testing

**Mandatory, quarterly.** An untested backup is a hypothesis, not a control.

- [ ] Restore a `pg_dump` into a scratch container
- [ ] Query the schema and count rows in key tables
- [ ] Record the outcome in `backups/restore-tests/`
- [ ] Time the full restore — this is your actual RTO
- [ ] Test restoration on the **second host**, not only locally

### 8.4 Monitoring hooks

Alert if backup age exceeds 26 hours. Alert on restore-test failure.

---

## 9. Execution Gates

No gate may be marked complete without every checkbox inside it.

### 🔒 Gate 1 — Security cleanup complete
- [ ] `DOTENV_PRIVATE_KEY_LOCAL` rotated
- [ ] Dependent secrets rotated
- [ ] `VLY_EMAIL_OTP_API_KEY` rotated
- [ ] History purge executed and verified
- [ ] 22-tag policy applied and verified
- [ ] `README.md` security statements corrected
- [ ] `migration-backup` confirmed on origin *(complete — `b15a5a6`)*

**Exit:** no live secret is public. **This gate gates everything else.**

### 🔒 Gate 2 — Server ready
- [ ] Firewall state backed up
- [ ] `ufw` installed, Tailscale permitted first
- [ ] Default-deny incoming
- [ ] **Third-session SSH verified over both paths**
- [ ] Tailscale healthy post-change
- [ ] OMV web UI verified reachable
- [ ] SSH hardening deferred per approved decision
- [ ] Rollback procedure documented and snapshots stored

**Exit:** host is firewalled and remote access is proven reliable.

### 🔒 Gate 3 — Docker ready
- [ ] Official `trixie` repo configured
- [ ] `docker-ce`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin` installed
- [ ] `daemon.json` written with data-root and log caps
- [ ] `hello-world` container runs
- [ ] `Docker Root Dir` confirmed as `/opt/schoolcore/docker`
- [ ] Tailscale still healthy
- [ ] OMV still healthy
- [ ] `DOCKER-USER` rules written **and persisted across restart**
- [ ] No container publishes a host port

**Exit:** Docker runs correctly without regressing NAS functionality.

### 🔒 Gate 4 — Cloudflare Tunnel ready
- [ ] Tunnel created; token stored securely, never in Git
- [ ] `cloudflared` installed as a service
- [ ] `schoolcore.ooflowdesk.com` routes and responds over HTTPS
- [ ] `schoolcore-api.ooflowdesk.com` routes and responds over HTTPS
- [ ] `schoolcore-dashboard.ooflowdesk.com` returns **403** unauthenticated
- [ ] Access policy allow-list verified working for a legitimate identity
- [ ] No inbound port required — confirmed by external probe showing all closed
- [ ] `nginx -t` equivalent unaffected; **OMV nginx untouched**

**Exit:** all three hostnames serve over TLS with the dashboard protected.

### 🔒 Gate 5 — Self-hosted Convex deployment
- [ ] `/opt/schoolcore` tree created with correct permissions
- [ ] `schoolcore` operational user created
- [ ] Compose stack on internal network, no published ports
- [ ] Convex backend + dashboard running (PostgreSQL only if the DB decision is confirmed)
- [ ] Deployment environment variables set via secret injection
- [ ] **Production deployment is empty — demo seed never run**
- [ ] Container health checks green
- [ ] Resource usage within tolerance on the constrained CPU

**Exit:** Convex reachable through the tunnel, database empty, no secrets at rest
in plaintext.

### 🔒 Gate 6 — Data migration testing
- [ ] Migration approach defined and documented — **not yet decided**
- [ ] Full backup of the Convex Cloud deployment captured and encrypted
- [ ] Restore rehearsed on the self-hosted stack
- [ ] Row counts and referential integrity verified
- [ ] Tenant isolation verified (Greenfield / Riverside)
- [ ] Auth flow verified end to end
- [ ] Application suite passes against the self-hosted backend
- [ ] Performance acceptable under realistic data volume — **explicit CPU test**
- [ ] Rollback to Convex Cloud proven and timed
- [ ] Backup and restore cycle validated with real data

**Exit:** data verified, rollback proven. **Freebuff deployment untouched.**

### 🔒 Gate 7 — Production cutover
- [ ] DNS/tunnel routing switched
- [ ] TLS valid and monitoring active
- [ ] Backups running and **restore-tested**
- [ ] Off-site replication confirmed working
- [ ] Monitoring and alerting live
- [ ] Rollback plan documented, rehearsed, and timed
- [ ] Freebuff deployment retained as fallback for a defined window
- [ ] Post-cutover verification from an untrusted network
- [ ] Incident runbook written
- [ ] 🟨 **Owner sign-off**

**Exit:** production serving from `gman-02`, with a working rollback.

---

## Approval Register

| # | Item | Type | Status |
|---|---|---|---|
| 1 | SSH access path during setup (LAN + Tailscale) | Decision | ✅ Approved |
| 2 | SSH hardening deferred to future phase | Decision | ✅ Approved |
| 3 | Cloudflare Tunnel ingress | Decision | ✅ Approved |
| 4 | No router port forwarding | Decision | ✅ Approved |
| 5 | Ports 80/443 not exposed | Decision | ✅ Approved |
| 6 | OMV nginx untouched | Decision | ✅ Approved |
| 7 | Dashboard private via Cloudflare Access | Decision | ✅ Approved |
| 8 | Docker-based portable deployment | Decision | ✅ Approved |
| 9 | Freebuff deployment untouched | Decision | ✅ Approved |
| 10 | `gman-02` as initial host despite CPU risk | Decision | ✅ Approved |
| 11 | Salt minion — remove or leave disabled | 🟨 Decision | ⬜ Open |
| 12 | `unattended-upgrades` policy for production | 🟨 Decision | ⬜ Open |
| 13 | **Firewall execution** | Approval | ⬜ Not requested |
| 14 | **Docker installation** | Approval | ⬜ Not requested |
| 15 | **Directory creation** | Approval | ⬜ Not requested |
| 16 | **Cloudflare Tunnel + DNS records** | Approval | ⬜ Not requested |
| 17 | **Backup configuration** | Approval | ⬜ Not requested |
| 18 | **Monitoring changes** | Approval | ⬜ Not requested |
| 19 | Identity provider for dashboard Access | 🟨 Decision | ⬜ Open |
| 20 | Data migration approach | 🟨 Decision | ⬜ Open |

### Execution actions taken to date

**None.** This document is the complete record of preparation work. No
installation, configuration change, directory creation, DNS modification, or
deployment has occurred on `gman-02`. All server access has been read-only.
