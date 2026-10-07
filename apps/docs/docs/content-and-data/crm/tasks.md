---
sidebar_position: 10
title: Tasks & follow-ups
description: Calls, emails, meetings and to-dos with a status, a due date, an assignee and a link to the record they are for — overdue and today read off the clock, a snooze, a reminder at its own time, and a morning digest.
---

# Tasks & follow-ups

A **task** is a piece of work somebody on your team owes a person in the CRM: a call to
return, an email to send, a meeting to hold, or a plain to-do. Every task has a subject, a
type, a priority, a status, an optional due date and time, an optional assignee, notes,
and a link to the **contact**, **company** or **deal** it is about.

Tasks live in the CRM hub at `…/hosts/{site}/crm/tasks` and, over every site at once, at
`…/{organization}/crm/tasks`; every record page carries its own short list of them. They
follow the same per-site visibility as the contacts themselves: a task made from one
site's console is seen from that site (and the sites it shares an audience with), and an
organization that has set **Default sharing for new records** to **All sites** sees every
task everywhere. A task is
also the one CRM record that can belong to **no site at all** — see
[Organization tasks](#organization-tasks).

:::info Plan availability
Tasks are part of the **CRM**, included from **Starter**. On Free the section is shown
locked, with the rest of the CRM. See
[What each plan includes](./overview.md#what-each-plan-includes).
:::

## Status, priority, type and subject {#task-picklists}

A task's **Status**, **Priority** and **Type** are picklists your organization keeps
under **CRM › Fields › Tasks**, each starting from Salesforce's standard values:

| Picklist | Standard values | What each value means to the CRM |
| --- | --- | --- |
| **Status** | Not Started, In Progress, Waiting on someone else, Deferred, Completed | Completed is **done**; the other four are **open** |
| **Priority** | High, Normal, Low | high, normal, low |
| **Type** | Call, Email, Meeting, To-do | call, email, meeting, to-do (Salesforce's *Other*) |

Every value **means** one of the CRM's own states, shown in the values card's **Means**
column. The meaning is what everything that runs on its own reads: the views below, the
overdue and today colors, [reminders](#reminders), the [daily digest](#the-daily-digest),
[Next activity](#next-activity), the reports and every automation. The label is your
organization's — rename **In Progress** to *Working* and every task that held it says
*Working*, and nothing that counts open tasks changes. A value you add names its meaning
(an *On hold* status that is **open**, a *Site visit* type that is a **meeting**); a
standard value's meaning is fixed. A value deleted with a replacement moves its tasks
only to a value of the same meaning, so a delete can never complete or reopen a task.

A task made before these lists existed holds only the meaning, and shows the first
active value of it — an open task reads **Not Started**, a done one **Completed** —
until it is saved with a label of its own.

**Subject** is a list of suggestions, not a picklist a task holds: **Call**, **Send
Letter**, **Send Quote** and **Other** to start. The drawer's **Subject** field offers
them as you type and takes any text, as Salesforce's does. Renaming or deleting a
suggestion changes no task's subject.

Rename, reorder, deactivate, add or make a value the default on the
[Fields page](./custom-fields.md#task-picklists); a new task starts on each list's
default (**Not Started**, **Normal**, **To-do**).

## The tasks page

The **Tasks** section is one list with six views, chosen under **Show** in the table's
**Filters** panel — **My tasks** unless you choose another:

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

Each row shows a checkbox that completes or reopens the task, the subject (with the first
line of notes under it), the type, the priority, the status, the due date colored by where it stands
— red when overdue, amber when due today — with a snooze beside it, the assignee, and
the record it is for, as a link into that record's page. The list shows a view a page
at a time, with the usual footer to pick how many rows a page holds and to turn to the
next page.

Beside **Show**, the **Filters** panel narrows a view by **Type** (call, email,
meeting, to-do), **Priority** (low, normal, high) and **Assignee** — each **is** one or
**is any of** several, the type and the priority by meaning, each named by your
organization's label for it — and
**Search** finds a task by a word of its title. The view, the filters and the search
are all answered by the list's query, so they reach every task in the view, page by
page, and add up with each other. The search matches whole words from their start —
"cof" finds *Coffee*, a fragment from the middle of a word does not — one word at a
time: type several and it searches the first, and says so. Under a site, a member
whose access is limited to particular sites cannot search the tasks, and the
notice says so. When a combination cannot
be answered by one query, the list does not apply that filter, and a notice above the
table names it and says why; see
[Filter and search a list](../../getting-started/console-tour.md#filter-and-search).

### The calendar view

**List** and **Calendar** sit beside the view control. The calendar draws one month,
placing each task on the day it is **due**, and clicking one opens the same drawer a
row does. The arrows page a month at a time and **Today** comes back.

The calendar draws the tasks of the **same view, with the same filters and search**,
up to 200 of them, and says so when the view holds more. A month that looks empty may
simply be a month the view's tasks are not in. It says so underneath: how many of them
are due outside the month on screen, and how many have no due date at all (a calendar
cannot place those).

A day that has more than three tasks lists three and counts the rest. Overdue titles are
red, completed ones are struck through, and today's square is outlined.

Selection is a list gesture: there is no bulk bar over the calendar. Switch back to
**List** to select and act on many.

### Snoozing a task

The alarm icon beside an open task's due date offers **Tomorrow**, **Next week** and
**Pick a date…**. Each moves the due date and changes nothing else — one write, no
notification to the assignee, and no trip through the edit drawer. The same three
choices sit beside the **Due** field in the drawer.

Tomorrow and next week count from **today**, not from the old due date: a task a week
overdue snoozed to "tomorrow" is due tomorrow. The task keeps its time of day, so a
9:00 call stays a 9:00 call; a task that had no due date lands at 9:00 in the morning.
The same snooze is on each record page's Tasks card.

### Selecting, exporting and acting on many

The rows have a second checkbox, for selection: tick some and a
[bulk bar](./bulk-actions.md#tasks) appears above the list to complete them, assign
them, set their due date, export them or delete them. Completing and assigning go
through the server exactly as the row's checkbox and the drawer do, so every completion
fires its event and every new assignee is told.

**Export…** in the card's header opens the [export dialog](./export.md) on the
view's tasks, and the bar's on the selection: **Subject**, **Type**, **Priority**
and **Status** by your organization's labels, the due date and the completion,
the assignee by email, the contact by email, the company and the deal by name
(or the deal's external id), and notes.

### Import and export {#import-from-csv}

**Import** in the card's header takes a file of tasks — a hand-off list, a
Salesforce or HubSpot tasks export — through the [import wizard](./import.md).
A row finds its task by **Aglyn ID** or by its **External ID** (the id it had
in the product it came from), so importing the same file again **updates**
those tasks rather than filing them twice. Importing needs the same **Manage
data** permission as creating a task, and nobody is notified of an imported
task.

| Field | What is read |
| --- | --- |
| **Subject** | Required for a new task. |
| **External ID** | Kept on the task; what a later import finds it by. |
| **Type**, **Priority**, **Status** | Your organization's values (*Site visit*, *In Progress*) or a meaning (`call`, `high`, `done`); empty, **To-do**, **Normal** and **Not Started**. A task whose status means done is stamped completed, by you, at the time of the import; one a file reopens loses its stamp. |
| **Due** | A date or a date and time. |
| **Assigned to** | A member of your workspace, by email or name. |
| **Contact** | A contact by email. |
| **Company** | A company by its domain or name. |
| **Deal** | A deal by its external id or its name. |
| **Notes** | Text. |

A person, company or deal the file names that your CRM does not hold is
listed on the wizard's **Values** step: use a similar record, leave the link
blank, or refuse the row. Every imported task is the chosen site's task; the
organization's own tasks — the ones with no site — are filed one at a time
from the [organization hub](#organization-tasks).

### Creating a task

**New task** opens a drawer over the list. Give the task a subject — type it, or pick
one of your organization's suggestions — pick a type, a priority and a status, set a
due date and time (or leave it empty for a task with no deadline), choose
an assignee from your team, link it to a contact, a company or a deal by name, and add
notes. A new task is assigned to you unless you pick somebody else. **Remind me**, under
the due date, is the task's [reminder](#reminders): the due time unless you move it, or
**No reminder**.

The drawer's **Status** offers the values of the task's own state only — an open
task's open statuses, a done task's done ones. Completing a task is the checkbox, below,
because completing is what runs your automations.

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

That notification says when the task is due, but it fires once, at assignment. The task's
own alarm is its [reminder](#reminders), sent at the task's own time; the
[daily digest](#the-daily-digest) is what says, each morning, what is due today and what
is already late.

### Completing and reopening

Tick the checkbox to complete a task: its status becomes the first active **done**
value — **Completed** unless you renamed it. Unticking reopens it as a new task starts,
**Not Started** by default. Completing is the one task action with a side
effect beyond the task itself: it fires the **`taskCompleted`** event on the site, which a
[workflow](../../marketing-and-automation/workflows-and-actions/overview.md) can trigger
on. From a site's hub the event fires on that site; from the organization's hub it fires
on the site the task was created from, and an [organization task](#organization-tasks)
fires none. Ticking a done task in the Done view reopens it; reopening fires nothing.

The `taskCompleted` payload carries the meanings, never the labels — so an automation
keeps working when the labels are renamed: `taskId`, `title`, `kind`, `priority`, `dueAtMs`,
`completedAtMs`, `completedByUid`, `assigneeUid`, `createdByUid`, `contactId`,
`companyId`, `dealId` and `taskHostId` (the site the task was created on). Every optional
field is present as an empty string rather than absent, so a filter such as
`contactId != ""` works without knowing whether the key exists.

## Organization tasks

Every other CRM record is captured *by* a site — a contact, a company, a deal is a fact
about a person some site met. A task need not be: renewing the agency's own insurance or
chasing the organization's own invoice is owed by nobody's brand. So on the organization's
hub the **New task** drawer's **Site** picker offers **This organization (no site)** beside
your sites — and shows even when the organization has only one site, because there is a
choice to make. Under a site's hub the picker never appears; a task made there belongs to
that site, as it always has.

An organization task records no site. It is listed from the organization's hub, and —
like any record shared with the whole organization — from every site's tasks list and
dashboard card too: sharing with the organization *is* sharing with its sites. What sets
it apart is that no site created it, so completing one fires no `taskCompleted` event
(there is no site whose automations could hear it), the assignee's notification opens the
organization's hub rather than a site's, and the [REST API](/api/resources/tasks) reports
its `siteId` as `null`. Opening an organization task at the org level says so under its
title — *Filed with the organization — no site* — where a site's task names its site.

A task made from a record's page on the organization's hub defaults to the record's own
site, as before; **This organization** is a choice you make, never a default.

## Tasks on a contact, company or deal

Each record's page has a **Tasks** card listing that record's open tasks, soonest due
first, with the same checkbox to complete one inline; the card's heading counts how many
are open and how many are done. **New task** on the card opens the drawer with the record
already linked, and **All tasks** jumps to the section.

## Reminders

Every task with a due date and time has a **reminder** at that time. Within the hour
after it, the assignee gets a console notification — **Task reminder**, opening the
task's contact, deal or company page, or the tasks list when it is linked to nothing —
and one email listing every task of theirs that fell due in that hour. The drawer's
**Remind me** field, under **Due**, shows it.

- **It follows the due date.** Move the due date — in the drawer, with a snooze, or over
  the API — and a reminder that sat on the old due time moves with it. Set **Remind me**
  to a time of your own (an hour before, the evening before) and it stays there when the
  due date moves. The bulk bar's **Set due** moves due dates only; a reminder on a task
  it touches stays where it was.
- **No reminder** clears it. A task with no due date has no reminder unless you set one,
  and a task made before reminders existed has none until you set one.
- **It fires once.** A reminder that has been sent is not sent again; changing its time
  makes a new one. Completing a task cancels a reminder that has not fired yet, and
  reopening the task does not bring it back.
- **It goes to the assignee**, and only to a member who can open the CRM (the same
  **manage data** permission as everything else here). A task assigned to nobody reminds
  nobody; the digest is where unassigned work shows up.

Reminders are checked once an hour, at the top of the hour, so "remind me at 3:00"
arrives between 3:00 and 4:00. The time in the message is written in the same time zone
the [daily digest](#the-daily-digest) uses. Reminders are sent only in organizations
whose plan includes the daily digest — a plan that gets no digest gets no reminders
either.

Tasks created by an [automation](./automations.md) or over the
[REST API](/api/resources/tasks) get the same default: a reminder at the due time,
unless the API call says otherwise (`remindAt`). Both store your organization's labels
beside the meanings: the **Create a CRM task** step names a type and a priority, and
the API takes a label (`"In Progress"`) or a meaning (`"open"`) for `kind`, `priority`
and `status`.

### Turning reminders off

A reminder is a **Forms & bookings** notification, like **Task assigned to you**. Muting
that category under Account settings → **Notifications** stops both the console
notification and the email, on every workspace you belong to. There is no separate
switch, because a reminder is one message about one task rather than a schedule you keep;
to silence one task, clear its **Remind me** field.

## Next activity {#next-activity}

Every contact, company and deal carries a **Next activity**: when its earliest
open task is due. It is a column on the [contacts](./contact-record.md),
[companies](./companies.md#the-companies-list) and [deals](./deals.md#the-board-and-the-table)
lists — overdue in the warning color, today emphasized, a dash when nothing is
scheduled — and filtering it by **is empty** in the table's **Filters** panel
keeps only the records with nothing planned. A view saved with that filter
reopens with it. On the reports page, the pipeline card's **Stuck deals**
counts the open deals with nothing scheduled.

The figure is kept by every task write: creating, editing, snoozing, completing,
reopening or deleting a task recomputes it for the records the task names, and
so does a task filed by an [automation](./automations.md) or over the
[API](/api/resources/tasks). A record that existed before the figure did shows a
dash until a task against it is written — or until **Recompute next activity**
in the [Fields section](./custom-fields.md#recompute-next-activity) rewrites
every record's figure from its open tasks.

## The daily digest

Because overdue and today are read off the clock, nothing on a task fires on its own
except its [reminder](#reminders). What says what is owed is the **daily CRM digest**:
once a morning, at 8:00 (America/Chicago),
every member with open work gets **one** console notification and **one** email saying
what they owe — for example, "3 tasks due today, 2 overdue, 1 unworked lead".

It counts, per organization:

- **Overdue** and **due today** — your open tasks, by the same day boundaries the Tasks
  page paints with, read in the digest's time zone rather than yours.
- **Unworked leads** — leads on the sites you can reach that are still **New** after two
  days and have no owner, plus any lead whose owner is you. A lead with an owner is only
  on that owner's list.
- **Leads in sequences or campaigns** — the same leads by the same rule, but
  [Nurturing](./leads.md#lead-statuses) rather than New: a sequence or a campaign email is
  already reaching them. The email counts them on one line ("12 leads are in sequences or
  campaigns") and does not list them, and they are never a reason on their own to send
  you a digest.

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
console notification only — the email still arrives while the digest is on. (A
[reminder](#turning-reminders-off) is the other way round: the category mute is its only
switch, and stops its email too.) See
[Workspace settings & notifications](../../getting-started/console-tour.md#workspace-settings--notifications).

## The dashboard card

The site dashboard shows a **Tasks due** card: how many of your tasks are overdue, how
many are due today, and the next five assigned to you, each with its due date. **View
all** opens the Tasks section. The card appears only on a workspace that has at least
one open task, and only for readers who can open the CRM; a workspace that has never
made a task sees no card at all.

The same card sits at the top of the organization's **Sites** page (**Organization →
Sites**), above the site grid, for an organization owner, admin or editor. There it
counts your open tasks **across every site** in the organization, and **View all**
opens the Tasks section of the [organization-level hub](./overview.md#at-the-organization-level).
A collaborator added to particular sites does not see the row — it reads across every
site, which is the one thing a site-scoped membership cannot do.

## Who can do what

Tasks share the CRM's permission: anyone whose role can **manage data** (owners,
admins and editors by default, or a custom role granting it) can read, create, edit,
complete and delete tasks on the sites they can reach. A collaborator scoped to one site
sees that site's tasks — and the organization's, which every site shares — and no other
site's. Filing or completing a task from the organization's hub takes what the hub itself
takes: a member of the whole organization holding *manage data*.

## Related

- [CRM overview](./overview.md)
- [Activities & the timeline](./activities.md) — what happened, as opposed to what is owed
- [Bulk actions](./bulk-actions.md#tasks) — complete, assign, reschedule, export and delete over a selection
- [Import contacts from CSV](./import.md) — the same three steps the tasks import walks
- [Reports](./reports.md) — open, overdue and due-today tasks by assignee
- [Automations for the CRM](./automations.md) — the **Create a CRM task** step and the **CRM task completed** event
- [Workflows & actions](../../marketing-and-automation/workflows-and-actions/overview.md)
- [REST API — tasks](/api/resources/tasks)
