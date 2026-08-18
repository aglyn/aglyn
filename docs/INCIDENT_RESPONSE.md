<!--
 Copyright 2026 Aglyn LLC — Apache-2.0
-->

# Incident response and the SLA decision (AGL-1102)

AGL-1102 asked for four things: an uptime commitment, a status page, monitoring
and alerting, and an incident process. Three shipped. This is the fourth, plus
the options for the first — which is a commercial decision and is deliberately
left open here.

Companions: `docs/UPTIME_AND_SLA.md` (what is monitored and what is not),
`docs/BREACH_NOTIFICATION.md` (**a data breach runs that process, not this
one**), `docs/DISASTER_RECOVERY.md`, `apps/docs/docs/staff-console/lockdown.md`.

## Who is on point

**Zach. For everything, at all hours, with no rotation and no escalation path.**

This is stated first because every other line in this document depends on it,
and because pretending otherwise would make the rest of it useless. Every alert
policy on `aglyn-main` emails `zach@aglyn.com` and nothing else. There is no
pager, no secondary, no follow-the-sun. `docs.aglyn.com/trust` publishes this
in the "what we do not have" table — *"Formal 24/7 on-call rotation: No"* —
which is the right call: a reviewer who finds it in the table is better served
than one who discovers it during an outage.

Two consequences to carry into every decision below:

- **Overnight detection is an email nobody reads until morning.** An incident
  starting at 02:00 has an eight-hour response floor, and no amount of
  monitoring changes that.
- **This is the binding constraint on any SLA number**, not the infrastructure.
  See §5.

## Severity

Set severity from **customer impact**, never from how alarming the alert looked.
The severity decides the response, and it can be revised in either direction as
facts arrive.

### SEV1 — the service is down, or data is at risk

*Symptoms:* `console-health` or `tenant-health` red across multiple probe
regions; `customer-site` red (published sites not serving); a confirmed or
suspected personal data breach; both the newest managed backup and the newest
GCS export unusable.

*Response:* drop everything. Acknowledge to yourself within minutes of reading
the alert; a status-page post within 30 minutes of confirming; updates at least
hourly until resolved. A suspected breach **also** starts
`docs/BREACH_NOTIFICATION.md` immediately, and the breach clock takes priority
over the outage comms.

### SEV2 — a major function is broken, or one customer's data was exposed

*Symptoms:* `billing-webhook` red (revenue is failing silently — the shape
AGL-1551 had, where 100% of deliveries 400'd behind an "Active" badge);
`signup-volume` red with a wall of gibberish names (a registration wave);
`rate-limiter` red during what looks like a credential-stuffing run; publishing
broken; sign-in broken for one auth pool; a single customer's data visible to
another.

*Response:* same day, ahead of feature work. Status-page post if it is
customer-visible. Affected customers contacted directly — do not make someone
discover their own broken billing from a status page.

### SEV3 — degraded, with a workaround

*Symptoms:* `console-imaging` red (no WebP variants — degraded, not down, which
is why it is deliberately body-only and does not 503 the main check);
`beacon-heartbeat` red (**we are blind, but we are serving** — the dangerous
one, because it looks like nothing is wrong); `backup-state` red on the
`exports` check; one plugin failing; a slow endpoint.

*Response:* next working day. No status-page post unless customers are asking.
`beacon-heartbeat` deserves a specific note: it means the error pipeline is
dark, so **treat every subsequent "no errors reported" reading as unknown**
until it clears.

### SEV4 — cosmetic

A Linear issue. Nothing else.

**When in doubt, go one level up.** Over-responding costs an evening;
under-responding costs the customer relationship, and this is a beta where
every customer is a reference.

## Running an incident

1. **Acknowledge to yourself and start a Linear issue immediately.** Title it
   with the symptom, not the guess. The issue is the timeline; write into it as
   you go, because reconstructing an incident afterwards from memory does not
   work — everything else in this repo that was written contemporaneously
   survived, and everything reconstructed later is thinner.
2. **Read the alert body before acting.** Each health endpoint carries its own
   verdict reason: `endpoint-missing` / `endpoint-disabled` /
   `deliveries-failing` / `stripe-unavailable` for billing;
   `no-credential` / `http-401` / `http-429` / `transport-TimeoutError` for the
   beacon. `docs/UPTIME_AND_SLA.md` maps every one to what it means.
3. **Preserve evidence before fixing**, if there is any chance of a data
   incident. The Vercel runtime log holds ~60 minutes. `BREACH_NOTIFICATION.md`
   §2 has the exact commands.
4. **Check upstream first.** `status.vercel.com`, `status.firebase.google.com`,
   `status.stripe.com`. A large fraction of what will page us is not ours, and
   the answer changes the response entirely — there is nothing to fix and
   everything to communicate.
5. **Stop the bleeding before finding the cause.** The levers are in
   `apps/docs/docs/staff-console/lockdown.md`: read-only mode, per-feature locks
   (`signups`, `uploads`, `checkout`, `marketplace-installs`, `ai-assist`),
   asset quarantine, plugin revocation. **Read that runbook before you need
   it** — read-only mode takes up to ~60 seconds to take hold, which is a fact
   worth knowing in advance rather than during.
6. **Communicate.** §4.
7. **Confirm the clearing event, do not assume it.** Every check has one and
   `UPTIME_AND_SLA.md` names it per check, because a condition without a named
   clearing event is how a check goes permanently red and then gets muted —
   which is exactly what AGL-1843 produced, red for 210 consecutive windows
   while the backups were healthy.
8. **Write it up.** §6.

## Communicating

### The status page

**https://docs.aglyn.com/status**, served from the `aglyn-docs` Vercel project
— a different project from the console and the tenant runtime, so a console
outage does not take down the page reporting it. That is the whole job, and a
status page served by the thing it reports on is decoration.

It reads the health endpoints **live from the visitor's browser** and shows no
history and no percentage, because nothing stores samples and inventing "99.9%"
from one successful fetch is how a status page loses its credibility.

**There is no way to post an incident to it.** That is AGL-1102's last piece of
plumbing and the cheapest honest version is small: a committed
`apps/docs/src/data/incidents.json` rendered as a banner above the live checks,
with `{ id, startedAt, resolvedAt, severity, title, updates: [{at, body}] }`.
Because `aglyn-docs` is a separate project, a push updates the status page even
while the console is down — which is the property that makes it worth building
this way rather than reaching for a hosted status service. Whoever picks it up
should also decide whether the banner is authored by hand or by a script; by
hand is fine at this volume and removes a moving part.

**Until it exists, incident comms are email to affected customers**, and the
status page shows only what the health checks say.

### Rules that hold regardless of channel

- **Say something before you know the cause.** "We are investigating reports
  of X" inside 30 minutes beats a precise explanation at hour three.
- **Never state a cause, a count or a scope before it is established.** Anything
  stated early becomes something to retract, and a retraction costs more
  credibility than the delay would have.
- **Give the next update time and meet it**, even if the update is "still
  investigating, next update in an hour". A silence is read as an escalation.
- **Affected customers get told directly.** A status page is not notice.
- **One voice.** Every external word comes from Zach.

## The SLA decision — options for Zach, with the tradeoffs

**No number is committed here, deliberately.** AGL-1148's sequencing was
Zach's own call — build the plumbing, commit to a figure once it is measured —
and it is still the right one. What follows is the decision laid out so it can
be made rather than deferred by default.

### What is true today, before choosing

**We publish no availability commitment anywhere.** Verified across the Terms,
the Privacy Policy and the publisher agreement. The published text runs the
other way — Terms §14.2: *"WE DO NOT WARRANT THAT THE SERVICES WILL BE
UNINTERRUPTED, TIMELY, SECURE, ERROR-FREE"*; §5.2 "No Guarantee of
Availability"; §6.4 "Data Loss". The liability cap is the greater of three
months' fees or **$100** (§15.2), $50 for unpaid use (§15.3). The competitive
benchmark records Aglyn's SLA as *"None — Enterprise SLA 'agreed as part of' a
contract"*.

So committing to a number is a **new** obligation, not the formalisation of an
existing one. There is nothing to lose by waiting and something real to lose by
guessing.

**Four facts that constrain any number:**

1. **We have no measured availability.** Cloud Monitoring has been accruing
   since 2026-08-13 — days, not the quarter AGL-1148 asks for. The GitHub probe
   is explicitly not evidence: *"a gap in the history is not evidence of an
   outage and an unbroken green history is not evidence of 100% uptime."*
2. **Our hosting provider owes us nothing.** The Vercel team is on **Hobby**
   (`docs/VERCEL_DEPLOYMENTS.md`), which carries no SLA at all. AGL-723 targets
   a Pro upgrade for **mid-September** — after the Sept 1 launch. Firestore's
   multi-region SLA is strong; Vercel's, for us, does not exist. **An SLA we
   sign is one we owe regardless of whose outage it was**, so every minute of a
   Vercel incident is funded out of our own pocket.
3. **Detection latency eats the budget.** The alert path is a 5-minute probe
   memo, plus a 5-minute check period, plus ~10 minutes of sustained failure
   before the email — so **nothing under ~20 minutes is even visible**. At
   99.9% the entire monthly allowance is 43 minutes. One incident detected at
   minute 20 and fixed at minute 40 spends half the month's budget on a single
   short outage, before anyone touches a keyboard.
4. **No on-call rotation.** A 02:00 incident is an eight-hour response floor.
   At 99.9% that is eleven months of allowance consumed by one night.

| Target | Allowed downtime per month | Survives one overnight incident? |
| --- | --- | --- |
| 99.0% | 7h 18m | Yes |
| 99.5% | 3h 39m | Yes, barely |
| 99.9% | **43m** | **No** |
| 99.95% | 21m | No |
| 99.99% | 4m | Not even detectable |

### Option A — commit to nothing (status quo)

Keep Terms §14.2. Point enterprise buyers at `/status` and the Trust page's
honest table. Negotiate per contract if a deal genuinely requires it.

*For:* zero new obligation; matches four of ten peers in the benchmark; the
Trust page's candour is already a differentiator with reviewers who have read a
hundred boilerplate SLAs.
*Against:* some enterprise procurement processes have a hard gate. Loses those
deals, or forces a bespoke contract each time — which is worse than a published
number because each one is separately negotiated and separately owed.

### Option B — a published **target**, no credits

"We target 99.5% monthly availability, measured at `/api/health`. We publish
what we measure." A stated aspiration, explicitly not a warranty, with §14.2
intact.

*For:* answers the procurement question with a number; costs nothing if missed
beyond a conversation; can be tightened once data exists, and tightening is
easy where loosening is painful. **99.5% survives one overnight incident**,
which is the realistic failure mode given §4 above.
*Against:* a sophisticated buyer will notice a target with no remedy is not an
SLA and may push for one anyway. Publishing a target we then miss quietly is
worse than publishing nothing, so it comes with an obligation to actually
measure and to say so when missed.

### Option C — 99.9% with service credits, Enterprise only

The conventional shape. Credits as a percentage of the monthly fee: e.g. 10%
below 99.9%, 25% below 99.0%, 50% below 95.0%; customer must claim within 30
days; credits are the **sole and exclusive remedy**.

*For:* what enterprise buyers expect, and the exclusive-remedy clause is the
important half — it converts an unbounded availability argument into a bounded,
pre-agreed number.
*Against:* **43 minutes a month against a Hobby-tier host and no on-call is a
promise with teeth we currently cannot grow.** Credits also interact awkwardly
with the §15.2 cap ($100 or three months' fees): on a small subscription the
credit may exceed the cap, and on a large one it is noise — so the schedule has
to be drafted against the cap rather than beside it. Needs counsel.

### Option D — 99.9% *target* now, credits on a stated date

Publish 99.9% as a target immediately, with a commitment that it becomes a
credit-backed SLA on a named date — after a quarter of measured data and after
the Vercel Pro upgrade (AGL-723).

*For:* gives procurement a number today and a credible path to a real SLA;
makes the Pro upgrade and the measurement window into stated preconditions
rather than internal excuses.
*Against:* a dated promise is a promise. If the date arrives and the data does
not support 99.9%, we either publish a weaker number after promising a stronger
one — the one direction that is genuinely painful — or we honour a figure the
measurements do not back.

### The structural recommendations, which are not the number

Whatever is chosen:

1. **Never publish an SLA stronger than what our providers owe us.** Today
   Vercel owes us nothing, so *any* number is self-funded. Sequence AGL-723
   before any credit commitment.
2. **Measure at `/api/health` and say so in the terms.** An unstated
   measurement point is where every SLA dispute starts.
3. **Exclusions belong in the first draft**, not the second: scheduled
   maintenance with notice, upstream provider outages, customer-caused issues,
   force majeure. Adding an exclusion later reads as bad faith.
4. **Credits should be claimed, not automatic.** Every peer does it this way;
   it bounds the operational cost of the promise to the customers who care.
5. **Decide the support-response SLA in the same pass.** `SUPPORT_BY_PLAN`
   already publishes first-response windows per plan and is a live commercial
   commitment (`libs/aglyn/src/lib/app-utils/support-tiers.ts`). An availability
   SLA that ignores it will contradict it.

The commercial decision is AGL-1148. The plumbing it was gated on now exists.

## Afterwards

Within a week of any SEV1 or SEV2, write into the incident's Linear issue:
timeline, customer impact, root cause, what was done, what changes.

Then answer the two questions that matter more than the fix:

1. **How was it detected — an alarm, or a customer?** If a customer, name the
   alarm that would have caught it and file it. That is the highest-value
   output of the whole incident, and `docs/UPTIME_AND_SLA.md` §"What is
   deliberately NOT watched" is where the answer usually already is.
2. **Did the runbook hold?** Update this file with whatever was wrong in it. A
   runbook that survives an incident unchanged was probably not used.

## What cannot be kept today

| | Filed |
| --- | --- |
| **No server-error-rate monitoring.** A route can 500 for every paying customer while every check stays green. | AGL-1921, AGL-1799 |
| No on-call rotation. Overnight incidents wait for morning. | AGL-1148 |
| No incident-post mechanism on the status page. Comms are email. | AGL-1102 |
| No stored availability history to quote. Cloud Monitoring is accruing; a quarter is the bar. | AGL-1148 |
| The Vercel team is on Hobby — no provider SLA, no log drains — and the Pro upgrade targets mid-September, after launch. | AGL-723 |
| No APM, session replay or performance tracing. A browser-side misbehaviour that never throws is invisible. | AGL-1148 |

Last reviewed **2026-08-18**.
