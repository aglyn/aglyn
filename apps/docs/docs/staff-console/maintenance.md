---
sidebar_position: 11
title: Maintenance
description: The staff maintenance jobs — whether each scheduled job is still running, what a run would do, and how to run one by hand without firing an irreversible sweep by accident.
---

# Maintenance

:::warning Aglyn staff only
This page lives at **Staff → Maintenance** and requires a staff claim. Two of the jobs
here permanently destroy data.
:::

Some platform work happens on a schedule rather than in response to anything: audit rows
age out, orphaned plugin bundles accumulate, plugin verdicts go stale when the verifier
moves on. Those jobs used to be reachable only from a shell holding the production cron
secret, which meant nobody looked at them.

This page answers two questions, and they are not equally important.

## Is the job still running?

This is the important one, and being able to trigger a job does not answer it.

Both scheduled jobs here fail *silently*. An archival job that stopped running looks
exactly like one with nothing to archive — same empty result, same green tick. That is
the same failure that left backups unusable for eleven days behind a healthy badge.

So every job carries a schedule row above its controls:

- **Scheduled** — the job has reported a run within its window. A job in a legitimately
  idle stretch is green here on purpose.
- **NOT RUNNING** — it missed its window. The row names the cadence, when it last
  reported, and the run it missed.
- **No schedule reading** — the crons probe did not report this job at all. This is its
  own state and is never folded into "fine".

A red row is not fixed by pressing **Run for real**. Running the job by hand does one
run; it does not put the schedule back. Check that the job still has its `cron:` line in
the scheduled-workflow file, then look at that workflow's recent runs.

## Running a job by hand {#running-a-job-by-hand}

For when something genuinely cannot wait for the next scheduled run.

**1. Preview first.** **Preview (dry run)** reports what a real run would do and changes
nothing. For the two destructive jobs, this preview *is* the list of things about to be
permanently destroyed. The real-run button stays locked until you have taken a preview —
"show what would happen first" is worth nothing if the button beside it can be pressed
without looking.

**2. Give a reason.** At least eight characters, recorded in the audit log against your
account. Say why this could not wait for the schedule; that is the question someone will
have when they read the row later.

**3. Type the confirmation phrase**, on the destructive jobs only. It is compared
exactly — case and spacing included. A confirmation that accepts an approximation of
itself is one that can be fired by accident.

Every one of these is enforced by the server, not just by the page. The run is refused
without them regardless of how the request is made.

A staff-triggered run is recorded in the audit log **before** it does anything, so a run
that dies halfway still leaves a record of who started it and why.

Running a job by hand never counts as a scheduled run: it does not stamp the heartbeat
the health board reads, so it cannot make a job that stopped being scheduled look alive.

## The jobs

### Audit archive

Moves `adminAudit` entries past the 90-day retention window into the Storage compliance
trail, then deletes them from Firestore.

**A real run destroys data.** Archived rows stop being queryable from the audit log; the
copy that remains is JSON lines in a bucket. Rows are written to Storage before they are
deleted, so an interrupted run duplicates rather than loses.

### Plugin artifact reaper

Deletes plugin bundles in the artifacts bucket that no version document claims. That
bucket is invisible to the Firebase console, so this page is the only place it can be
inspected.

**A real run destroys data.** The bucket has no object versioning, so nothing can be
restored. Two safety margins are built into the job itself: objects younger than seven
days are never reaped, and an orphaned *listing* is reported rather than reaped, because
its installs still load. Everything the preview lists as an orphan will go.

### Plugin verdict re-verification

Re-runs the static verifier across stored plugin versions and updates each cached
verdict. Versions whose verdict is already current are skipped without downloading
anything.

**This one is reversible** and has no confirmation phrase. It writes verdicts back and
notifies staff about regressions on live versions — it delists nothing and revokes
nothing, and a wrong verdict is recomputed on the next run. The verifier is a lint, and a
lint that can stop a plugin in every workspace would be a kill switch with no human in
it.

## Jobs that live elsewhere

Two maintenance routes have their own cards on [Platform health](platform-health.md)
rather than appearing here, because a second surface for the same route is how two
surfaces come to disagree:

- **Sharing-scope drift** — the detector and its repair.
- **Pending erasures** — the GDPR erasure queue and its runner.

## Related

- [Platform health](platform-health.md)
- [Audit log](audit.md)
- [Staff console overview](overview.md)
