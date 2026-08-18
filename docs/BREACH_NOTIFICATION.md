<!--
 Copyright 2026 Aglyn LLC — Apache-2.0
-->

# Personal data breach runbook (AGL-1915)

What to do when customer or personal data has been — or may have been —
exposed, altered or destroyed. The DPA promises notice; this is the process
behind that promise.

Companions: `docs/INCIDENT_RESPONSE.md` (severity, comms, the status page —
**read that first for an availability incident**), `docs/PRIVACY_REQUESTS.md`,
`docs/DATA_RETENTION.md`, `docs/DISASTER_RECOVERY.md`,
`apps/docs/docs/staff-console/lockdown.md`.

**A breach is not the same thing as an outage.** An outage is handled by
`INCIDENT_RESPONSE.md` and gets a status-page update. A breach has a statutory
clock, a legal addressee, and — deliberately — **no status-page post until the
notification decision is made**. An incident can be both, and then it runs both
processes in parallel with the breach clock taking priority.

## 0. How we would actually find out — read this before trusting an alarm

A breach runbook that assumes the monitoring would tell us is fiction. Here is
what the alerting can and cannot see, honestly.

**What is watched** (`docs/UPTIME_AND_SLA.md` has the full table): eleven uptime
checks and thirteen policies on `aglyn-main`, every one emailing
`zach@aglyn.com`. Relevant to a breach:

- `rate-limiter` (AGL-1693) — 503s when any durable limiter fell back to a
  per-instance cap in the trailing 30 minutes. **A credential-stuffing run
  during a degraded window is the shape this catches.**
- `signup-volume` (AGL-1536) — 503s above 10 orgs created in the trailing hour.
  A registration wave.
- `billing-webhook` (AGL-1924) — Stripe delivery failures.
- `beacon-heartbeat` console and tenant (AGL-1923) — the only condition in the
  project that watches for **silence**, which is what a dead error pipeline
  looks like.
- CSP violation counters (`cspViolationDaily`, 60-day retention, AGL-1799) —
  durable, queryable at `/admin/csp-reports`. An injected script that tries to
  exfiltrate to an unexpected origin leaves a row here.

**What is not watched, and it is the largest hole (AGL-1921):** the
**server-side error rate**. Every check above is a liveness signal on one URL.
None of them can answer "are 30% of requests 500ing" or "is one endpoint
returning other people's data". Server errors live in the Vercel runtime log,
which retains **~60 minutes** and drains nowhere — `GET
/v2/integrations/log-drains` returns `[]` on both projects (AGL-1799). Nothing
from the running app reaches GCP Logging.

**The consequences for this runbook, stated plainly:**

1. **The most likely way we learn of a breach is a human telling us**, at
   `security@aglyn.com` (published on `docs.aglyn.com/trust`) or through
   support. Treat that inbox as a detection system, because it is the primary
   one.
2. **Forensics are hobbled.** The one-hour log window means that by the time
   anyone reads a report, the request logs that would show scope are already
   gone. What survives: `adminAudit` (90 days), Firestore PITR (7 days),
   `cspViolationDaily` (60 days), Stripe's own event log, Firebase Auth sign-in
   records. **Preserve evidence before you fix anything** — §2, step 1.
3. **"We found no evidence of access" is a claim about our logging, not about
   what happened**, and until the log drain exists it must never be written to
   a customer as though it were the latter.

There is no on-call rotation. `docs.aglyn.com/trust` says so out loud. Overnight
detection is an email into a mailbox nobody is watching until morning.

## 1. Is it a personal data breach?

GDPR's definition is wide: *any* accidental or unlawful destruction, loss,
alteration, unauthorised disclosure of, or access to personal data. It does not
require an attacker, and it does not require malice.

Yes, if any of these:

- Anyone saw data belonging to someone else — a cross-tenant leak, a
  mis-scoped API response, a rules gap.
- A credential with data access left our control — a leaked service-account
  key, an exposed `apiKeys` token, a compromised staff account.
- Data was destroyed with no restore point.
- A subprocessor told us they had one affecting our data.

No, if:

- An outage with no data access (that is `INCIDENT_RESPONSE.md`).
- A vulnerability with a demonstrated absence of exploitation — but "we have no
  logs showing exploitation" is **not** a demonstrated absence, per §0.3.
  Default to yes when the evidence cannot distinguish.

**When unsure, run the clock as though it is one.** The 72-hour clock starts on
*awareness*, and awareness is not the same as certainty — Art. 33 explicitly
allows a phased notification when the facts are incomplete. Waiting to be sure
before starting the clock is the standard way organisations miss it.

## 2. First hour — containment, in this order

**1. Preserve evidence first, and do it before touching anything.** This is the
step that gets skipped and cannot be redone.

```bash
# The Vercel runtime log holds ~60 minutes. Pull it RAW right now; filter later.
# --level and -q have both been observed returning nothing on non-empty windows,
# so never conclude "zero" from a flag (AGL-1799).
vercel logs -S aglyn -p aglyn-console --environment production --since 2h > /tmp/incident-console.log
vercel logs -S aglyn -p aglyn-tenant  --environment production --since 2h > /tmp/incident-tenant.log
```

Then note the wall-clock time. Firestore PITR gives a 7-day window at minute
granularity, so the pre-incident state is recoverable for reading — but only
for seven days, and that window is also the *only* forensic snapshot of what
the data looked like before.

**2. Stop the bleeding.** The valves, weakest to strongest:

| Lever | Where | Reaches |
| --- | --- | --- |
| Quarantine one file | `/admin/media-quarantine` | One asset, or every copy of those bytes platform-wide |
| Feature lock | `/admin/lockdown` → surface | `signups`, `uploads`, `checkout`, `marketplace-installs`, `ai-assist` |
| **Read-only mode** | `/admin/lockdown` | Writes refused platform-wide, reads keep serving. Takes hold in up to ~60 s |
| **Full lockdown** | `/admin/lockdown` | The panic button |
| Revoke one person's sessions | `/admin/users/[uid]` → Disable | `revokeRefreshTokens` |
| Revoke a plugin version | `/admin/plugin-reviews` | Enforced at render time on installs already running |
| Revoke an API credential | delete the `apiKeys` row | `verifyApiKey` stops resolving it |

The full lockdown runbook — modes, timing, what "reads keep working" does and
does not cover, and the un-panic invariant that keeps staff able to lift it —
is `apps/docs/docs/staff-console/lockdown.md`. Read it *before* an incident.

**3. Rotate what was exposed.** There is no rotation runbook, which is a gap.
The credentials that matter: the Firebase admin service-account key
(`FIREBASE_PRIVATE_KEY` in Vercel env, per project), `STRIPE_SECRET_KEY` and
the webhook signing secret, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`.
⚠️ **The Stripe webhook signing secret has bitten us before**: the parser once
kept only the last `v1`, so a secret roll 400'd roughly half of deliveries
(AGL-1560). Roll it and then watch `/api/health/billing`.

**4. Do not post to the status page yet.** §5.

## 3. Assess — the four facts the clock needs

Write these down as you establish them; they are what every notification needs
and what a supervisory authority will ask first.

1. **What data.** Categories and approximate volume of records and people.
   `docs/DATA_RETENTION.md` is the map of where the categories live.
2. **Whose data — and are we controller or processor for it?** This decides who
   we notify and it is not a formality:
   - **Controller** — Aglyn account holders: profiles, emails, phone numbers,
     postal addresses, billing identities, support tickets, Assist questions.
   - **Processor** — everything belonging to visitors to a customer's published
     site: form submissions, contacts, orders, bookings, site members. **Our
     obligation is to the customer, and theirs is to the data subject.**
   Most breaches will be both, because most of our surfaces hold both.
3. **How many, and where are they.** Jurisdiction drives the clock. Count EU/UK
   data subjects and count Texas residents specifically — both have their own
   threshold (§4).
4. **Is it contained, and can it recur.** A notification that cannot say the
   hole is closed invites the next question immediately.

## 4. Notify — who, and by when

**Zach decides.** There is one decision-maker on notification, and that is not a
gap to apologise for at this size — it is a fact the runbook should state so
nobody waits for a committee. Counsel is consulted before any regulator filing.

### As processor — to the customer. This one is clear and we can meet it.

Live DPA §9, verbatim:

> Aglyn will notify Customer **without undue delay** after becoming aware of a
> Personal Data Breach affecting Customer Personal Data, and will provide
> reasonably available information to assist Customer in meeting its
> notification obligations. Aglyn's notification is not an acknowledgment of
> fault or liability.

No hour count is published, and per the competitive benchmark that matches the
majority of peers. **"Without undue delay" is not "when convenient"** — the
customer has their own 72-hour clock running from the moment we tell them, so
every hour we hold is an hour off theirs. Target the same day.

Send it to the org owner (`orgs/{orgId}.ownerUid` → auth record email). Include:
what happened, when, what data, what we have done, what they should do, and a
named contact for follow-up. **Do not include another customer's details** in a
message going to several.

### As controller — to a supervisory authority. ⚠️ We cannot currently name one.

GDPR Art. 33(1) gives **72 hours from awareness**, unless the breach is
unlikely to result in a risk to rights and freedoms. Art. 34 requires notifying
the **data subjects** without undue delay where the risk is high.

**Aglyn LLC has no EU or UK establishment and no Art. 27 representative**, so
there is no one-stop-shop lead authority and no addressee written down. That is
tracked as **AGL-1980** and it is a counsel question, not an engineering one.
Until it is answered, a breach affecting an EU data subject has a 72-hour clock
and nobody to file with. **Escalate to counsel on hour one of any such
incident** rather than spending the window discovering this.

### As controller — to US residents. This part is concrete.

**Texas** (Bus. & Com. Code §521.053), which governs us as a Texas entity:

- Notify affected persons **without unreasonable delay and not later than
  60 days** after determining a breach occurred.
- Notify the **Texas Attorney General within 30 days** when **250 or more**
  Texas residents are affected.

Other states have their own thresholds and clocks. A multi-state breach means a
fifty-state analysis, and that analysis is counsel's — start it on day one, not
on day fifty (AGL-1980, item 3).

### Verified, so nobody re-derives it during an incident

The published Terms and Privacy Policy contain **no breach-notification
commitment at all** — the promise lives only in the DPA, which has no repo copy.
The live page is its only authority. So the customer-facing commitment is
exactly DPA §9 above, and nothing else has been promised.

## 5. Communicating

**Sequence, and it is deliberate:** contain → assess → notify the affected
parties → *then* speak publicly. A status-page post naming an incident before
the affected customers have been told means they learn about their own breach
from a public page, which is both a bad outcome and, in the EU, an argument
that the notification was late.

- **Status page** (`docs.aglyn.com/status`) is served from a separate Vercel
  project, so it stays up when the console does not. It currently shows live
  health only and has no incident-post mechanism — see `INCIDENT_RESPONSE.md`.
- **Never speculate in writing.** "We are investigating a potential issue
  affecting X" is safe; a cause, a count or a scope stated before it is
  established becomes the thing you have to retract.
- **One voice.** Every external word about a breach comes from Zach.

## After any restore — the step DPA §11 requires

Live DPA §11 promises: *"a deletion instruction survives any restoration — data
deleted at Customer's instruction and later restored from a backup will be
deleted again."* It is one command, and the restore is not finished without it
(AGL-1975). It is step 4 of `DISASTER_RECOVERY.md` Procedures C and D:

```bash
# --since is the SNAPSHOT time of whatever you restored or imported, not the
# time of the restore. Plans by default; --confirm executes.
node tools/scripts/replay-erasures.mjs --since <snapshot ISO8601>
node tools/scripts/replay-erasures.mjs --since <snapshot ISO8601> --confirm \
  --actor <your-uid>
```

It reads the `org.erased`/`user.erased` rows at or after that instant, checks
which targets are standing again, and re-runs the real `eraseOrg`/`eraseUser`
for those — reinstating `erasureRequestedAt` from the audit row first, since an
org whose customer asked after the snapshot comes back with no request on it.
A person who owns a workspace the restore also brought back is reported
`BLOCKED` rather than force-erased: erase the workspace first, then re-run.

⚠️ **Import is merge-by-id, not replace.** Importing an old export into
`(default)` silently brings back every document an erasure deleted, alongside
the recovery you ran it for. This is the single most likely way that promise
gets broken, and it happens during an incident when nobody is reading a DPA.

⚠️ **An empty list is not automatically a clean bill.** The `adminAudit`
erasure rows are **90 days hot** before archival, so a 90-day GCS export and
the record of erasures inside its window can age out within days of each other.
The script prints `THIS ANSWER IS INCOMPLETE` and exits 1 in that case; read
`adminAudit-archive/` in Storage before telling anyone the instruction
survived.

## Afterwards

1. **Write it up within a week**, while it is still recoverable: timeline,
   what was affected, how it was found, what was done, what changed.
2. **File the detection gap.** If an alarm should have caught it and did not,
   that is a separate issue from the breach. If it was found by a human, say
   what alarm would have found it — that is the highest-value output of the
   whole incident.
3. **Update this runbook** with what was wrong in it. A runbook that survives an
   incident unchanged was probably not used.

## What cannot be kept today

| | Filed |
| --- | --- |
| **We would very likely not detect a data breach ourselves.** No server-error-rate monitoring; runtime logs retain ~60 minutes and drain nowhere. Detection is primarily an inbound report. | AGL-1921, AGL-1799 |
| **We cannot name the regulator to notify inside 72 hours** for an EU/UK data subject. No Art. 27 representative, no lead authority. | AGL-1980 |
| `security@aglyn.com` — the published disclosure address, and therefore our primary detection channel — is **not confirmed to receive mail**. | AGL-1973 |
| ~~Deletion does not survive a restore automatically.~~ **Closed 2026-08-18 (AGL-1975)** — `replay-erasures.mjs` is a numbered step of the restore procedures. Residual: it reads the 90-day hot `adminAudit` window and cannot see the Storage archive, so a restore from the oldest GCS export is reported `incomplete` rather than clean. | AGL-1975 |
| No credential-rotation runbook. The list in §2.3 is the closest thing. | — |
| No on-call rotation. Overnight detection waits for morning. | AGL-1148 |
| The status page has no incident-post mechanism. | AGL-1102 |

Last reviewed **2026-08-18** against the live DPA (`dpaV2-20260813`) and
Privacy Policy v4. **Statutory citations here are engineering's reading and
have not been confirmed by counsel** — AGL-1980 is where that confirmation
lands.
