---
sidebar_position: 10
title: Tasks & follow-ups
description: Calls, emails, meetings and to-dos with a due date, an assignee and a link to the contact, company or deal they are for — overdue and today read off the clock, a snooze, and a morning digest of what is owed.
---

# Tasks & follow-ups

A **task** is a piece of work somebody on your team owes a person in the CRM: a call to
return, an email to send, a meeting to hold, or a plain to-do. Every task has a title, a
kind, a priority, an optional due date and time, an optional assignee, notes, and a link
to the **contact**, **company** or **deal** it is about.

Tasks live in the CRM hub at `…/hosts/{site}/crm/tasks`, and every record page carries
its own short list of them. They follow the same per-site visibility as the contacts
themselves: a task made from one site's console is seen from that site (and the sites it
shares an audience with), and an organization that has widened its default sharing sees
every task everywhere.

## The tasks page

The **Tasks** section is one list with six views, chosen from the control above it:

| View | What it shows |
| --- | --- |
| **My tasks** | Open tasks assigned to you, soonest due first. Tasks with no due date come last. |
| **Overdue** | Open tasks whose due date is before today. |
| **Today** | Open tasks due at any time today. |
| **Upcoming** | Open tasks due tomorrow or later. |
| **All open** | Every open task, whoever it is assigned to. |
| **Done** | Completed tasks, most recently due first. |

"Overdue" and "today" are not stored on the task — nothing runs at midnight to stamp
them. Each view is a window over the due date computed from **your own clock and time
zone** when you look, and a tab left open across midnight repaints yesterday's work as
overdue on its own.

Each row shows a checkbox, the title (with the first line of notes under it), the kind,
the priority, the due date colored by where it stands — red when overdue, amber when due
today — with a snooze beside it, the assignee, and the record it is for, as a link into
that record's page. A view shows at most 200 rows and says so when it is full; narrow the
view to see the rest.

### Snoozing a task

The alarm icon beside an open task's due date offers **Tomorrow**, **Next week** and
**Pick a date…**. Each moves the due date and changes nothing else — one write, no
notification to the assignee, and no trip through the edit drawer. The same three
choices sit beside the **Due** field in the drawer.

Tomorrow and next week count from **today**, not from the old due date: a task a week
overdue snoozed to "tomorrow" is due tomorrow. The task keeps its time of day, so a
9:00 call stays a 9:00 call; a task that had no due date lands at 9:00 in the morning.
The same snooze is on each record page's Tasks card.

### Creating a task

**New task** opens a drawer over the list. Give the task a title, pick a kind and a
priority, set a due date and time (or leave it empty for a task with no deadline), choose
an assignee from your team, link it to a contact, a company or a deal by name, and add
notes. A new task is assigned to you unless you pick somebody else.

Opening a row opens the same drawer to edit it. **Delete** at the bottom of the drawer
removes the task for everyone who can see it; a task that was finished is better ticked
done, which keeps it in the Done view.

### Assigning a task to someone else

When you assign a task to a teammate — on creation, or by changing the assignee later —
they get a console **notification** ("Task assigned to you") that opens the task's
contact, deal or company page, or the tasks list when it is linked to nothing.
Assigning a task to yourself sends nothing, and re-saving a task's title does not tell
the assignee again. Anyone can mute these under the operational (content) notification
category in their account settings.

The assignee must be a member of your organization; the picker offers the current
roster.

That notification is also the reminder for work due soon: assigning a task due within the
next day tells the assignee once, with the due time in the message. There is no separate
per-task alarm — the [daily digest](#the-daily-digest) below is what says, each morning,
what is due today and what is already late.

### Completing and reopening

Tick the checkbox to complete a task. Completing is the one task action with a side
effect beyond the task itself: it fires the **`taskCompleted`** event on the site, which a
[workflow](../../marketing-and-automation/workflows-and-actions/overview.md) can trigger
on. Ticking a done task in the Done view reopens it; reopening fires nothing.

The `taskCompleted` payload carries `taskId`, `title`, `kind`, `priority`, `dueAtMs`,
`completedAtMs`, `completedByUid`, `assigneeUid`, `createdByUid`, `contactId`,
`companyId`, `dealId` and `taskHostId` (the site the task was created on). Every optional
field is present as an empty string rather than absent, so a filter such as
`contactId != ""` works without knowing whether the key exists.

## Tasks on a contact, company or deal

Each record's page has a **Tasks** card listing that record's open tasks, soonest due
first, with the same checkbox to complete one inline; the card's heading counts how many
are open and how many are done. **New task** on the card opens the drawer with the record
already linked, and **All tasks** jumps to the section.

## The daily digest

Because overdue and today are read off the clock, nothing on a task ever fires on its
own. What does is the **daily CRM digest**: once a morning, at 8:00 (America/Chicago),
every member with open work gets **one** console notification and **one** email saying
what they owe — for example, "3 tasks due today, 2 overdue, 1 unworked lead".

It counts, per organization:

- **Overdue** and **due today** — your open tasks, by the same day boundaries the Tasks
  page paints with, read in the digest's time zone rather than yours.
- **Unworked leads** — leads on the sites you can reach that are still **New** after two
  days and have no owner, plus any lead whose owner is you. A lead with an owner is only
  on that owner's list.

The notification opens the Tasks section of the site the first task belongs to (or the
Leads section when only leads are owed). The email lists each section — up to ten items
apiece, with a count of the rest — and links to the same pages. Members who have nothing
due, nothing late and no unworked lead get nothing; a digest is sent at most once per
member per day, so a re-run on the same day reaches only whoever the first run missed.

The digest goes only to members who can open the CRM (the same **manage data**
permission as everything else here), and only in organizations whose plan includes it.

### Turning it off

**Daily CRM digest** is a switch under Account settings → **Notifications**, on by
default. Off, it stops both the notification and the email, on every workspace you
belong to. Muting the **Forms & bookings** category on that same page silences the
console notification only — the email still arrives while the digest is on. See
[Workspace settings & notifications](../../getting-started/console-tour.md#workspace-settings--notifications).

## The dashboard card

The site dashboard shows a **Tasks due** card: how many of your tasks are overdue, how
many are due today, and the next five assigned to you, each with its due date. **View
all** opens the Tasks section. The card appears only on a workspace that has at least
one open task, and only for readers who can open the CRM; a workspace that has never
made a task sees no card at all.

## Who can do what

Tasks share the CRM's permission: anyone whose role can **manage data** (owners,
admins and editors by default, or a custom role granting it) can read, create, edit,
complete and delete tasks on the sites they can reach. A collaborator scoped to one site
sees that site's tasks and no others.

## Related

- [CRM overview](./overview.md)
- [Activities & the timeline](./activities.md) — what happened, as opposed to what is owed
- [Reports](./reports.md) — open, overdue and due-today tasks by assignee
- [Automations for the CRM](./automations.md) — the **Create a CRM task** step and the **CRM task completed** event
- [Workflows & actions](../../marketing-and-automation/workflows-and-actions/overview.md)
- [REST API — tasks](/api/resources/tasks)
