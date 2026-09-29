# SchoolCore — Monitoring and Alerting

Covers how the self-hosted SchoolCore deployment is monitored, how alerts are
delivered, and what is checked when monitoring itself is in question.

This document describes the system **as it actually runs**. Where a defect was
found and fixed while writing it, the defect is recorded rather than smoothed
over — see §7.

No API key, token, password or other secret appears in this document.

---

## 1. Components

| Path | Role |
|---|---|
| `/opt/schoolcore/scripts/production-health.sh` | Probes the deployment, writes the current state, sets the exit code |
| `/opt/schoolcore/scripts/production-alert.sh` | Wraps the health check and sends email on state transitions |
| `/opt/schoolcore/scripts/backup-health.sh` | Verifies the backup chain independently of the main check |
| `/opt/schoolcore/scripts/backup.sh` | Performs the backup; run by its own timer |
| `/opt/schoolcore/scripts/resend-test.sh` | One-shot transport test, prompts for a recipient |
| `/etc/systemd/system/schoolcore-health.{timer,service}` | Five-minute schedule |
| `/etc/systemd/system/schoolcore-backup.{timer,service}` | Daily backup schedule |
| `/opt/schoolcore/logs/` | State files, per-run backup logs, alert fallback log |

---

## 2. Schedule

### 2.1 Health and alerting — every 5 minutes

```ini
[Timer]
OnCalendar=*-*-* *:0/5
AccuracySec=30s
Persistent=true
Unit=schoolcore-health.service
```

`Persistent=true` means a run missed while the host was down or suspended is
executed once on the next boot, so a check is never silently skipped.

The service is a `oneshot` that runs `production-alert.sh` (not the health
script directly, so the alerting path is the one exercised on every cycle),
as `root`, `Nice=10`, with `TimeoutStartSec=300` and output to the journal.

### 2.2 Backup — daily 02:30 server local time

```ini
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=300
Persistent=true
Unit=schoolcore-backup.service
```

The server runs `Europe/London`, so the Kenya-time equivalent shifts with
BST/GMT transitions: **02:30 London = 04:30 Nairobi during BST, 05:30 Nairobi
during GMT**. `RandomizedDelaySec=300` prevents many hosts firing at the same
instant; `Persistent=true` catches up after downtime.

---

## 3. What the health check verifies

`production-health.sh` exits **0 HEALTHY / 1 DEGRADED / 2 CRITICAL** and writes
the verdict to `/opt/schoolcore/logs/health.state`.

| Group | Checks |
|---|---|
| Public endpoints | Frontend, Convex API, OIDC discovery, JWKS each probed for HTTP 200 |
| Exposure | Convex dashboard must have no public DNS; zero SchoolCore host-published ports |
| Data tier | PostgreSQL accepting connections; Convex backend serving; no sqlite fallback |
| Host | Disk usage, inode usage, available RAM, load average, swap, docker disk |
| Backups | Delegates to `backup-health.sh` and requires a `HEALTHY` verdict |
| Containers | Every SchoolCore container must be in `running` state |

**Thresholds.** The resource checks warn on host pressure — disk, inodes,
available memory, load average and swap usage. Any warning moves the verdict
from `HEALTHY` to `DEGRADED`; any critical finding moves it to `CRITICAL`.
A swap warning is raised for *any* swap in use, however small, which is a
deliberately strict threshold and worth knowing when interpreting a `DEGRADED`
verdict: a few tens of megabytes of cold pages parked in swap, with
`vmstat` showing `si=0 so=0` and ample free RAM, is not an incident. The
authoritative confirmation of that is `vmstat`, not the health verdict.

---

## 4. Alerting

### 4.1 Transport

Email via the **Resend** HTTP API, authenticated with a bearer token read from
`/opt/schoolcore/deploy/.env` at send time. The key is never written to a log,
a state file, a repository or this document. The configured sender is
`SchoolCore <noreply@mail.ooflowdesk.com>`.

If the transport is unconfigured, `send_mail` does not fail the run: it writes
to `/opt/schoolcore/logs/alert.fallback.log` and returns non-zero, so a
misconfiguration is recorded locally instead of vanishing.

### 4.2 Destination

A single operator mailbox, configured in `production-alert.sh` and reached only
through the Resend API. The address is deliberately not duplicated into
`package.json`, the repository or any environment file that is committed.

### 4.3 State handling and transition semantics

Alerts fire **only on a state transition**, so a persistent fault does not
generate a message on every cycle. Two state files drive this:

| File | Contents |
|---|---|
| `logs/health.state` | Verdict of the most recent health run, written by `production-health.sh` |
| `logs/alert.prev` | Verdict the alerting layer last acted on |
| `logs/alert.last` | Unix timestamp of the last alert sent, the cooldown reference |

| Current | Previous | Behaviour |
|---|---|---|
| `HEALTHY` | anything other than `HEALTHY`/`INIT` | Send **recovery notice** |
| `HEALTHY` | `HEALTHY` / `INIT` | No action |
| `DEGRADED` | not `DEGRADED`, **or** cooldown elapsed | Send **degraded alert** |
| `DEGRADED` | `DEGRADED` and within cooldown | Suppressed, logged |
| `CRITICAL` / `UNKNOWN` | not `CRITICAL`/`UNKNOWN`, **or** cooldown elapsed | Send **critical alert** |
| `CRITICAL` / `UNKNOWN` | same and within cooldown | Suppressed, logged |
| anything else | — | Send **unrecognised status** alert (fail-safe) |

### 4.4 Cooldown

**3600 seconds (1 hour)** between repeat alerts for the same state. A fault that
persists beyond the cooldown re-alerts hourly; a fault that clears sends one
recovery notice. The cooldown is what keeps a five-minute schedule from
becoming an alert storm.

### 4.5 Recovery

Returning to `HEALTHY` after any other state sends an explicit
`SchoolCore RECOVERED` notice naming the previous state, so a resolved incident
is positively confirmed rather than assumed from silence.

### 4.6 Synthetic test process

Three layers, deliberately separated:

1. **Transport test** — `resend-test.sh` sends exactly one message to an
   owner-controlled recipient supplied at the prompt. The recipient is used
   once, never stored, never written to the deployment environment and never
   committed. Confirms the credential and the provider path.
2. **Logic test, no send** — `production-alert.sh --test` evaluates the current
   transition and prints what it *would* do, sending nothing.
3. **Logic test, forced state, no send** — `production-alert.sh --simulate
   <STATE>` drives the transition logic for a chosen state, which is how the
   `DEGRADED`, `CRITICAL`, `UNKNOWN` and unrecognised branches are exercised
   without waiting for a real outage.

Layer 3 exists because layers 1 and 2 cannot catch a defect in how the health
verdict is parsed into a state — which is exactly the defect that made this
system unable to alert (§7). A monitor needs a way to prove it would speak.

---

## 5. Log retention

| Stream | Destination | Retention |
|---|---|---|
| Health and alert runs | systemd journal (`schoolcore-health.service`) | Per host journald policy; currently ~109 MB on disk |
| Backup runs | `/opt/schoolcore/logs/backup-<timestamp>.log` | No rotation configured; one file per run |
| State files | `/opt/schoolcore/logs/{health.state,alert.prev,alert.last}` | Overwritten each run |
| Alert transport fallback | `/opt/schoolcore/logs/alert.fallback.log` | Appended, never rotated |
| Backup snapshots | Local directory + restic repository | `14d / 8w / 12m / 2y` with `--prune` |

There is **no logrotate policy for `/opt/schoolcore/logs`**, and the journal has
no explicit `MaxRetentionSec`. Both are recorded as known gaps rather than
described as managed: the backup log directory grows by roughly 100 KB per day
at current volume, which is slow, but it is unbounded and should get an explicit
policy before the archive policy work in 8.11.

---

## 6. Verifying monitoring is working

```bash
# current verdict
sudo /opt/schoolcore/scripts/production-health.sh; echo "exit=$?"

# what the alerting layer would do right now, sending nothing
sudo /opt/schoolcore/scripts/production-alert.sh --test

# drive each branch of the transition logic, sending nothing
sudo /opt/schoolcore/scripts/production-alert.sh --simulate DEGRADED
sudo /opt/schoolcore/scripts/production-alert.sh --simulate CRITICAL
sudo /opt/schoolcore/scripts/production-alert.sh --simulate HEALTHY

# transport only — sends one real message
sudo /opt/schoolcore/scripts/resend-test.sh

# recent runs
sudo journalctl -u schoolcore-health --since '-1 hour' --no-pager
```

`--simulate` writes to `alert.prev`, so back that file up before using it in a
diagnostic and restore it afterwards.

### Real delivery test — PASS

A real message was delivered through the alert transport during this work.

| Field | Value |
|---|---|
| Result | **PASS** |
| Sender | `SchoolCore <noreply@mail.ooflowdesk.com>` |
| Destination | Configured operator mailbox |
| Provider message id | `01a0eef3-2824-754c-8393-ace63a5a93fe` |

A second, stronger check was then run through the **full alerting path** rather
than the transport alone: a genuine `HEALTHY → DEGRADED` transition was forced
and the service executed end to end.

| Step | Observed |
|---|---|
| Transition detected | `current=DEGRADED previous=HEALTHY` |
| Delivery | `alert sent: SchoolCore DEGRADED` |
| Cooldown stamp | advanced to the send time |
| Immediate re-run | `degraded persists, within cooldown - not re-alerting` |

Delivery, transition detection and cooldown suppression are therefore all
confirmed against the real path.

---

## 7. Defects found and fixed in this monitoring system

Recording these because a monitoring system that cannot alert is a security
control that does not exist, and because the discovery is worth keeping.

### 7.1 State never matched a dispatch arm (CRITICAL, fixed)

`production-alert.sh` derived the state with `grep '^STATUS=' | cut -d= -f2`.
The health check emits `STATUS=DEGRADED (warn=1)`, so splitting on the first
`=` produced `DEGRADED (warn` — which matched none of the `case` arms
`HEALTHY)`, `DEGRADED)`, `CRITICAL|UNKNOWN)`. The `case` had **no `*)`
default**, so control fell through entirely: nothing sent, nothing logged,
exit 0. `CRITICAL (critical=1 warn=0)` failed identically. Only `HEALTHY`, whose
value contains no `=`, ever matched.

Evidence: `logs/alert.prev` contained the literal `DEGRADED (warn`, and a
simulated run reported `DEGRADED (warn -> DEGRADED => ALERT:degraded` — a
spurious transition on every evaluation. A `DEGRADED` condition active for over
an hour across eleven five-minute cycles produced no alert at all.

**Fix:** the state is extracted as the leading uppercase token, and a fail-safe
`*)` arm alerts on any unrecognised status rather than falling through.

### 7.2 Alert body was not valid JSON (CRITICAL, fixed)

`send_mail` interpolated a multi-line body directly into a JSON string. A
literal newline is an invalid control character inside a JSON string, so the
provider rejected every alert with HTTP 400
`{"name":"validation_error","statusCode":400}` and the script reported
`alert FAILED to send`.

Evidence: replaying the exact payload returned HTTP 400 and
`Invalid control character at: line 1 column 169`; the identical body with
newlines escaped was valid JSON and delivered.

**Fix:** a `json_escape` helper escapes backslash, quote, newline, tab and
carriage return in the subject, body and sender before they are embedded.

### 7.3 Combined effect

Neither defect was visible from the health check, which reports state
correctly throughout. The transport test in §6 passed while the alerting path
was in fact incapable of sending anything. This is the specific failure mode
that motivated the forced-transition check now described in §4.6: testing the
transport proves the pipe works, not that the system speaks.

Backups retained: `production-alert.sh.bak-p8pref` (pre state-parsing fix) and
`production-alert.sh.bak-p8prejson` (pre JSON-escaping fix).

---

## 8. Known gaps

| Gap | Impact | Suggested disposition |
|---|---|---|
| No logrotate policy for `/opt/schoolcore/logs` | Unbounded growth, ~100 KB/day | Resolve in 8.11 archive policy |
| No explicit journald `MaxRetentionSec` | Journal growth governed by host defaults | Resolve with the archive policy |
| Alert destination is a single mailbox with no secondary | One mailbox failure means silent loss | Add a secondary destination in the 8.12 runbook |
| No alerting on `backup-health.sh` in isolation | Covered via the main health check, but not independently | Acceptable; note for the runbook |
| Health check is host-local | A host-level outage is invisible to this system | Resolve in 8.5 DR with external monitoring |

---

## 9. Status

Monitoring and alerting documentation: **COMPLETE**.

The system was verified end to end during this work, and two critical defects
in the alerting path were found and fixed as a result.
