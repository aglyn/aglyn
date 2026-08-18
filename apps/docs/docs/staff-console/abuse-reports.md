---
sidebar_position: 11
title: Abuse reports
description: The public abuse-report queue — where outside reports land, how to triage by severity, which lever answers which report, and the CSAM and DMCA paths that are not takedown buttons.
---

# Abuse reports

:::warning Aglyn staff only
The queue lives at **Staff → Abuse reports** (`/admin/abuse-reports`) and requires
a staff claim. The `abuseReports` collection is `allow read: if isStaff()` and
`allow write: if false` — every write comes from the Admin SDK, so nothing you do
in a Firestore console tab is a supported path.
:::

This is the intake for people who are **not our customers**. A bank's fraud desk,
a browser vendor, a photographer whose work was lifted, a stranger who clicked
something wrong — none of them can open a support ticket (that route needs a
token and a paid plan), and all of them have somewhere else to go if they cannot
reach us. For a phishing site the somewhere else is a domain-level block on
`*.aglyn.app`, which takes every legitimate customer site down with it. That is
the failure this queue exists to prevent, and it is the reason an unanswered
report is more expensive than it looks.

## Where reports come from {#where-reports-come-from}

One URL, on every origin we serve:

```
https://<any-site>/api/report-abuse
```

It works on `aglyn.com` and on every `*.aglyn.app` site, because it lives under
`/api`, which the tenant middleware excludes from its per-host rewrite. So a
reporter who was looking at `dodgy.aglyn.app` and a reporter who was looking at
our marketing site land on the same form. `?url=` pre-fills the reported address.

Things about the form worth knowing before you read a row:

- **No JavaScript, no account, no App Check.** `GET` renders plain HTML, `POST`
  takes either a urlencoded form or JSON. The reporters this exists for are often
  on a locked-down corporate or law-enforcement browser, and an automated
  phishing feed posts JSON.
- **It does not refuse while a site is suspended.** Every other public write on
  the tenant runtime stops during a lockdown. This one deliberately does not — a
  suspended site is the most likely subject of a report, and the person who just
  saw the 503 is the most motivated reporter we will ever get.
- **It does not require the reported site to exist.** A mistyped subdomain or an
  already-deleted site still produces a row. `hostId` and `orgId` are resolved
  when the URL is one of ours and left empty when it is not — so an empty
  `hostId` means "we could not resolve it", never "there is nothing here".
- **Rate limit: 5 reports per IP per 10 minutes.** A refusal answers 429 and
  hands the reporter `support@aglyn.com` rather than a wall. The first report
  from any source always lands, which matters because a corporate NAT puts a
  whole fraud department behind one address.
- **A honeypot hit writes nothing.** The form carries a hidden `website` field;
  a bot that fills it gets a receipt page that looks exactly like success and no
  document is created. So the queue being empty is weak evidence that nobody
  reported anything.

Each report gets a reference like `AR-3F9A1C2B4D` shown to the reporter. It is
the first ten characters of the document id, uppercased — so if someone quotes a
reference at you, the row is the one whose `reference` field matches. **The
reporter's IP is stored nowhere.** It goes into the hash that produces the
document id and into the rate-limit key, both one-way. The same source reporting
the same URL for the same reason merges onto one document and bumps
`reportCount`, so one person cannot make one site look widely reported.

The two timestamps mean different things and both are trustworthy. `createdAt`
is written **once**, on the first report, and never touched again — so on a row
with `reportCount` above 1 it still answers "when did we first know", which is
the question that matters afterwards. `updatedAt` moves on every repeat.

A repeat also never re-opens a report. Once you have moved a row to `actioned`
or `dismissed`, the reporter filing again bumps `reportCount` and leaves your
decision where you put it.

## Triage by severity {#triage-by-severity}

Every category carries a severity. It is not a mood — it says how fast a human
has to look.

| Severity | Categories | What it means |
|---|---|---|
| **urgent** | `phishing`, `csam`, `malware` | Look now. |
| **high** | `dmca`, `impersonation`, `illegal` | Same day. |
| **normal** | `spam`, `other` | Work the queue. |

**Urgent is urgent because the cost of delay is not paid by us and not paid by
our customer.** It is paid by whoever clicks the phishing page next, or by the
child in the material, or by the visitor whose machine the download takes. That
is a different kind of cost from a customer waiting on a billing question, and it
does not get cheaper by being ignored overnight.

The second reason, for phishing specifically: an unanswered phishing report is
exactly what turns into a domain-level block on `*.aglyn.app`. The reporter who
cannot reach us escalates to a browser vendor or a blocklist, and that block does
not distinguish the phishing subdomain from the four hundred honest customer
sites beside it. Answering one report quickly is the cheapest insurance we have
on the whole platform.

## CSAM is not a takedown button {#csam}

If a report is `csam`, stop reading the rest of this page and do this:

1. **Do not delete the content.** Do not delete the site, do not empty the media,
   do not "clean up" the workspace, do not delete the report.
2. **Preserve it.** Lock the site down (host scope) so the public cannot reach
   it. Lockdown suppresses; it does not erase. That is the correct instrument
   here and quarantine is too, for the same reason — a quarantined file still
   exists and can still be produced.
3. **Escalate to Zach immediately.** Whatever hour it is.

The lever is **preservation plus notification**, not erasure. Deleting the
material feels like the responsible act and is close to the opposite of one: it
destroys what an investigation needs, and reporting obligations are not
discharged by the content going away.

:::danger Open item — the reporting mechanics do not exist yet
Who files the report with NCMEC, under whose account, and on what timeline is
**not established**. There is no registered account, no runbook step you can
follow, and nothing in the code that does it for you. Until that is settled, the
only correct action a staff member can take on a `csam` report is preserve,
suppress, and escalate to Zach — do not improvise a filing, and do not assume
someone else has already made one.
:::

## Which lever answers which report {#which-lever}

The response tooling is good. Match the size of the lever to the size of the
problem — the whole point of having three is that the widest one punishes people
who did nothing.

| The problem is | Reach for | Where |
|---|---|---|
| **One bad file** — malware in a PDF, an infringing image, one abusive asset | Media quarantine | `/admin/media-quarantine` |
| **One bad site** — a phishing page, a whole site built to deceive | Lockdown, **host** scope | `/admin/lockdown` |
| **A whole workspace acting in bad faith** — the same operator rebuilding the same scam across their sites | Lockdown, **org** scope | `/admin/lockdown` |

Media quarantine's reason codes already include `abuse` and `dmca`, which is
deliberate: a report's category maps onto a quarantine reason with no translation
step. It is reversible, keyed on the file's content digest, and it does not
delete or bill anything — see [Asset quarantine](lockdown.md#quarantine-keys) for
which digest to send and what each key reaches.

**Host scope now genuinely freezes the site's client writes.** Until AGL-1965,
a host-scope suspension stopped the public site and every Admin-SDK route and
did *not* stop the browser's direct Firestore writes — so an editor with a live
session could keep editing a phishing site staff had just suspended, and
republish it. The Firestore rules now carry a `hostSuspended` arm, so a suspended
site cannot be republished.

:::caution That is only true once the rules are deployed
`cloud/firebase-firestore.rules` deploys **separately from the app**. An app
deploy that carries the rules file in the repo has not applied it. If you are
relying on a host-scope lock to stop republishing — and on a phishing takedown
you are — confirm the rules in force are the ones with the host arm, rather than
assuming the last deploy included them.
:::

Two known edges of a host-scope lock, both carried in AGL-1981, both worth
knowing before you promise a customer or yourself that a site is frozen:

- **A timed suspension never expires in the rules.** The server-side helpers
  honour `suspendedUntilMs` and the rules do not. So when a timed lock lapses the
  site starts serving again while the client SDK stays frozen — the customer gets
  their site back and cannot edit it, with no error explaining why. Prefer an
  untimed lock you come back and lift by hand.
- **Org-level data is not frozen by a host-scope lock.** A host suspended in
  read-only mode keeps serving, and the pages it serves render org-level datasets
  and media that the host arm does not reach. If the offending content is
  org-level rather than site-level, host scope is the wrong scope.

Whatever you pull, the lockdown and quarantine surfaces both read the state back
after they write it and say `NOT CONFIRMED` when the re-read disagrees. Believe
the re-read, not the click.

## Statuses {#statuses}

| Status | What it means |
|---|---|
| `open` | Nobody has looked at it. Every report starts here. |
| `reviewing` | You are working it right now. Set it so a second person does not duplicate the investigation — and so an urgent row that has been `reviewing` for hours is visibly stuck rather than invisibly stuck. |
| `actioned` | We did something: a quarantine, a lockdown, a scope escalation. Say what, in the row. |
| `dismissed` | We looked and are doing nothing. A dismissal is a decision and needs a reason — "not our host", "the page is what it claims to be", "duplicate of AR-…". |

`dismissed` is not the same as unread. If you dismiss without a reason, the next
person to receive a report about the same site has no idea whether we already
considered it.

## What we do not tell people {#disclosure}

Two rules, both narrow and both firm.

**We do not tell the reporter what we decided about a specific site.** Not
"we suspended them", not "we found nothing". A reporter has standing to know
their report arrived — that is the reference number — and no standing to learn
what enforcement exists against a named customer. The receipt page says this
plainly, so a reporter who expected a verdict was told up front they would not
get one.

**We do not pass reporter details to the site owner.** One exception, and it is
required rather than optional: on a **DMCA notice** the site owner needs the
notice, including who sent it, because their right to counter-notice is
meaningless without knowing what and who they are answering. That is why a
copyright notice cannot be anonymous and every other category can be.

## The DMCA path {#dmca}

A valid takedown notice under 17 U.S.C. §512(c)(3) carries, among other things:

1. **Identification of the copyrighted work** said to be infringed.
2. **A good-faith statement** that the use is not authorised by the owner, its
   agent, or the law.
3. **A statement under penalty of perjury** that the information is accurate and
   the sender is authorised to act for the owner.
4. **A physical or electronic signature.**

The form enforces all four — plus a reply address, which the other categories do
not require — and refuses a `dmca` submission missing any of them. So a report in
the queue with `category: dmca` has the affirmations on it or it would not be
there. Read them anyway: enforcing that a field is non-empty is not the same as
the field saying something.

**We do not adjudicate the claim.** Nothing here decides whether the copyright
claim is good. We record what was asserted, by whom, at what time. If the notice
is facially complete and points at content we host, the proportionate response is
usually quarantining the specific asset rather than locking the site.

**The site owner has a right to counter-notice.** A counter-notice is how a
customer says the notice was mistaken, and the process assumes they get one.

:::danger Open items — do not assume safe harbour is secured
Two pieces of the §512 process are **not built and not filed**:

- **There is no counter-notice path.** No form, no route, no documented process.
  A customer who wants to contest a takedown currently has nowhere to do it.
- **No designated agent is registered with the U.S. Copyright Office.**
  Registration is a precondition of the §512(c) safe harbour, and it has not been
  done.

Do not tell a reporter, a customer, or yourself that we are operating inside the
safe harbour. Handle notices carefully and proportionately because it is the
right thing to do and because it will matter later — not because a legal
protection is already in place. If a customer asks to counter-notice, escalate to
Zach rather than inventing a process.
:::

## Known gaps {#known-gaps}

Honest list. Every one of these is a thing you will otherwise discover during an
incident.

- **Only the urgent categories are pushed at you.** A first report in
  `phishing`, `csam` or `malware` fans out through `notifyStaff` and appears in
  the console notifications menu for every staff-claim holder. Everything else —
  `dmca`, `impersonation`, `illegal`, `spam`, `other` — waits in the queue, and
  **opening the queue is the only way anyone learns about those.** That is a
  deliberate trade, not an oversight: notifying on every report would make the
  notification unread, and the one it would cost us is the phishing one. It does
  mean a copyright notice can sit for as long as nobody looks, so looking is a
  habit somebody has to keep.
- **The notification fires once per report, not per submission.** A reporter
  resubmitting cannot re-alert you, which is right — and also means a situation
  getting worse does not raise its voice.
- **No auto-acknowledgement email to the reporter.** They get the receipt page
  with their reference at submit time and nothing afterwards. If they close the
  tab before reading it, they have no record they reported anything.
- **`abuse@aglyn.com` and `dmca@aglyn.com` are unconfirmed mailboxes**
  (AGL-1973). They are named in the published Acceptable Use and Copyright
  policies, and it is not established that either exists — worse, Gmail default
  routing can accept mail for a non-existent `@aglyn.com` address and discard it,
  so a report sent there may be lost while the sender believes it was delivered.
  **The form is the reliable route.** If someone asks where to send a report,
  send them to `/api/report-abuse`, and the address printed on the form is
  `support@aglyn.com` for exactly this reason.
- **No NCMEC mechanics.** See [CSAM](#csam) — preserve, suppress, escalate.
- **No counter-notice path and no designated agent.** See [the DMCA
  path](#dmca).
