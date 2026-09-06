---
sidebar_position: 9
title: Tasks & follow-ups
description: Calls, emails, meetings and to-dos with a due date, an assignee and a link to the contact, company or deal they are for — with overdue and today read off the clock as you look.
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

Each row shows a checkbox that completes or reopens the task, the title (with the first
line of notes under it), the kind, the priority, the due date colored by where it stands
— red when overdue, amber when due today — the assignee, and the record it is for, as a
link into that record's page. A view shows at most 200 rows and says so when it is full;
narrow the view to see the rest.

### Selecting, exporting and acting on many

The rows have a second checkbox, for selection: tick some and a
[bulk bar](./bulk-actions.md#tasks) appears above the list to complete them, assign
them, set their due date, export them or delete them. Completing and assigning go
through the server exactly as the row's checkbox and the drawer do, so every completion
fires its event and every new assignee is told.

**Export CSV** beside the view control downloads the view on screen as `tasks.csv`:
title, kind, priority, status, the due date and the completion as timestamps, the
assignee by email address, the contact, company and deal by name, and notes. The bar's
**Export CSV** writes the same file over the selection.

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
- [Bulk actions](./bulk-actions.md#tasks) — complete, assign, reschedule, export and delete over a selection
- [Reports](./reports.md) — open, overdue and due-today tasks by assignee
- [Automations for the CRM](./automations.md) — the **Create a CRM task** step and the **CRM task completed** event
- [Workflows & actions](../../marketing-and-automation/workflows-and-actions/overview.md)
- [REST API — tasks](/api/resources/tasks)
