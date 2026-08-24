---
sidebar_position: 5
title: Security & compliance
description: Where the security material for a procurement review lives, and what we do not have.
---

# Security & compliance

The full write-up lives on **[Trust & security](/trust)**. It is written for
the security review that precedes an enterprise purchase, and it is kept as one
page on purpose — a reviewer should be able to send a single link rather than
assemble an answer from several.

## What it covers

- **What we do not have**, first rather than buried: no SOC 2 report and no
  audit in progress, no ISO 27001 / HIPAA / FedRAMP, no third-party penetration
  test, no bug bounty.
- Authentication, including [SSO](./sso.md), and how sessions work.
- Data handling — where data lives, what is encrypted, and who can reach it.
- Availability, and the fact that there is **no committed uptime percentage**
  (see [Availability & status](./uptime-and-status.md)).
- How to report a security issue.

## Contract documents

Both are published pages — read them without asking anyone, and send them to
your reviewers directly:

- **[Data Processing Addendum](https://aglyn.com/legal/dpa)** — the processing
  terms, including the export and deletion obligations the product implements.
- **[Subprocessor list](https://aglyn.com/legal/subprocessors)** — the
  authoritative one. The table on [Trust & security](/trust) is the engineering
  view of the same set and may lag it.

Neither of those two is acceptance-pinned, so neither carries a version bump
your people have to re-accept when it changes. The **Terms of Service** and the
**Privacy Policy** are the opposite: each acceptance is pinned to a version and
to the exact text published under it, and a new version is put back in front of
every user. See below.

## When the Terms or Privacy Policy change {#legal-reacceptance}

Accepting the Terms accepts the Privacy Policy with them, as one versioned set.
An acceptance is recorded against the individual — not against the workspace —
with the version, a content hash of each document exactly as it was published
at that version, the time from our clock, and which door the acceptance came
through. Records are additive and immutable: a later acceptance adds a row
rather than overwriting the earlier one, so the history of what a person agreed
to, and when, stays intact.

When we publish a new version, the next time that person opens the console they
see a banner. It opens by acknowledging the acceptance we already hold and
names the **date** they agreed, then says the documents have been updated and
asks them to confirm. Where we can tell which of the two documents actually
moved — by comparing the content hashes on their record against the ones
published now — the banner names them; where that comparison cannot be made it
says nothing rather than guessing. **I agree** records the new acceptance and
the banner goes. It appears on every console page until it is answered, and it
does not lock anyone out of the product in the meantime.

A banner also appears for an account we hold **no** acceptance for at all —
accounts created before we captured acceptance, and people who arrived through
SSO or an invite without passing a consent control. The wording there is
deliberately different, because the fact is different: it says we have no
record of acceptance on this account and gives the usual reason, which is a gap
in our records rather than anything the person failed to do.

Two consequences worth naming for a review:

- **Acceptance is per person, not per organization.** Every member of your
  workspace is asked separately, because "the organization accepted" and "this
  person accepted" are not the same statement.
- **The 30-day arbitration opt-out window** in the Terms runs from a person's
  **first** acceptance of any version. Re-accepting a later version does not
  restart it.

## Why the gaps are listed first

Because a reviewer needs them, and because a questionnaire surfaces them
anyway — three weeks later, with more people in the thread. Leading with the
absences is faster for both sides than leading with the controls.

If a certification is a hard requirement for your purchase, raise it at the
start. We would rather tell you early that we do not have it than discover it
at contract stage.

## Reporting a vulnerability

Security reports are read even though there is no bug bounty. The reporting
route is on [Trust & security](/trust).
