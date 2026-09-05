---
sidebar_position: 3
title: Actions builder
description: Map a single event to a single action without building a full workflow.
---

# Actions builder

When you just need "**when X happens, do Y**", the **actions builder** is faster than a full
workflow. It maps one **event** to one **action**.

:::info Plan availability
**Basic interactions are on every plan** (including Free): menu and drawer
open/close, show/hide an element, toggle a CSS class, sticky nav, navigation, and
site alerts — pure in-page effects with no server cost and no metering.

The **automations engine** — server-side steps, custom JS, analytics events, and
Marketing overlays — is **Pro+**, with **metered** runs. You build both in the same
place; steps that need a higher plan are labeled in the editor.
:::

## Create an action

1. Open the **actions builder** from **Automation → Actions**.
2. Choose the **event** (the trigger).
3. Choose the **steps** to run in response.
4. Save.

That's it — no multi-step logic to manage. Reach for a [workflow](build-a-workflow.md) when
you need several steps, branching, or composition.

## Triggers

Beyond server events (form submissions, page views, sign-ins, leads, bookings), actions
can fire on **visitor behavior in the page**:

- **Scroll depth** — the visitor scrolls past a percentage.
- **Scroll to / element visible** — a CSS-selected element enters the viewport.
- **Element click** — a CSS-selected element is clicked.
- **Exit intent** — the pointer leaves toward the top of the window.
- **Time on page** — a dwell-time threshold passes.
- **Page visit** — the page loads.

Page triggers can be limited to certain paths (`/pricing`, `/blog/*`), and a
**Frequency** setting controls re-fires: every matching pageview, **once per session**,
**once per visitor**, or **with a cooldown** (a minimum number of minutes between fires
for the same browser).

### CRM events {#crm-events}

Six server events come from the [CRM](../../content-and-data/contacts/overview.md) —
two about contacts, three about deals and one about tasks. Pick one and the **Filter**
field's helper text lists the keys below, so a filter such as
`lifecycleStage == "customer"` or a condition such as *`source` equals `booking`* can be
written without leaving the editor.

| Event | Fires when | Keys in scope for filters and conditions |
| --- | --- | --- |
| **Contact created** (`contactCreated`) | A capture on your site makes a **new** contact: a form submission, a member sign-up, a newsletter subscription, an order or a booking from an address your workspace did not already hold. A repeat visit by somebody already on the list is recorded as an interaction and does **not** fire it. | `contactId` · `email` · `name` (empty when the capture had none) · `source` (`form`, `member`, `newsletter`, `order` or `booking`) · `hostId` · `campaignIds` (comma-joined; present only when the capture came through a campaign) |
| **Contact changed stage** (`contactStageChanged`) | A contact's **lifecycle stage** is moved — from the contact's page in the console, or by a **Set the contact's lifecycle stage** step in another automation. Setting the stage a contact already has fires nothing. | `contactId` · `email` · `lifecycleStage` (the new stage) · `previousStage` (empty when the contact had none) |
| **Deal moved** (`dealStageChanged`) | A [deal](../../content-and-data/contacts/deals.md#moving-winning-and-losing) moves between open stages, or is reopened — from the board, the deal's page or the REST API. | `dealId` · `title` · `amountCents` · `currency` · `stageId` · `previousStageId` · `ownerUid` · `contactId` · `companyId` |
| **Deal won** (`dealWon`) | A deal is marked won. | The same keys as **Deal moved**. |
| **Deal lost** (`dealLost`) | A deal is marked lost. | The same keys as **Deal moved**, plus `lostReason`. |
| **CRM task completed** (`taskCompleted`) | A [task](../../content-and-data/contacts/tasks.md#completing-and-reopening) is ticked done — from the Tasks list, a record's Tasks card or the dashboard card. Reopening fires nothing. | `taskId` · `title` · `kind` · `priority` · `dueAtMs` · `completedAtMs` · `completedByUid` · `assigneeUid` · `createdByUid` · `contactId` · `companyId` · `dealId` · `taskHostId` |

:::note Events are announced by the server, not watched in the database
An event fires because the server path that performed the write announced it; nothing
watches the database for changes. Every capture door on your site, the console's
stage control, a deal's stage moves and a task's completion all go through the server,
so in ordinary use every one of these is announced. Contacts **added by hand** in the
console, **imported**, or created through the **REST API** are written without an
announcement and fire nothing.
:::

### Only run when a field matches

Every action can carry a **condition** over the event's payload — for form submissions,
that's the submitted field values. Pick an operator in the **"Only run when"** select:

- **A field is not empty** — e.g. the `subscribe` checkbox was ticked.
- **A field equals…** — an exact match (trimmed, case-insensitive), e.g.
  `plan` equals `Pro`.
- **A field contains…** — a partial match, handy for checkbox groups that submit
  all ticked options joined with `, ` (e.g. `topics` contains `Pricing`).

When the condition isn't met the action is skipped, and the skip is **recorded**: the
[run history](#run-history) gets a `Skipped` row naming the field or fields whose
condition stopped it — *"Condition on subscribe, plan not met"*. That row is the answer
to "why didn't my automation fire?", and it sits in the same place as the runs that did
fire. A skip still **doesn't count as a metered run**: nothing executed, so nothing is
charged.

Conditions are the no-code sibling of the free-text **Filter** expression; use whichever
reads better (both must pass when both are set). One difference worth knowing: only a
condition writes a `Skipped` row. A **Filter** expression that evaluates false — or that
throws, which also stops the action — records nothing at all, so an automation that
never fires because of a broken filter has an empty run history rather than an
explanation. Prefer a condition when you want the skip on the record.

**Example — grow an email list from a signup form:** add a **Checkboxes** field named
`subscribe` with a single option `Yes, keep me posted` to your form. Then create an
action on **formSubmission** with the condition *"A field is not empty" → `subscribe`*
and one step: **Enroll in a list**, picking your audience. Visitors who tick the box
join the list; everyone else just submits the form.

### Chain multiple conditions (AND/OR)

One condition rarely tells the whole story, so a condition can be a **chain**: click
**Add condition** to append another row (up to five), and remove a row with its **×**
button. With two or more rows a **Match** select appears:

- **All conditions match (AND)** — the default; the action runs only when *every* row
  passes. E.g. `subscribe` is not empty **and** `plan` equals `Pro`.
- **Any condition matches (OR)** — the action runs when *at least one* row passes.
  E.g. `topics` contains `Pricing` **or** `topics` contains `Billing`.

Each row keeps the single-condition operators and semantics unchanged (trimmed,
case-insensitive matching). Existing automations with a single condition keep working
exactly as before — editing one simply shows it as a one-row chain.

Each automation row offers a **Runs** log — its recent executions, including the
skipped ones, described under [Run history](#run-history) below — and, for page
triggers, a **Test** button that exercises the server-side steps immediately.

## Steps

Steps run in order and mix **in-page effects** with **server-side work**:

- **Basic in-page effects (all plans)**: open/close/toggle a menu or drawer, show/hide or
  toggle an element, add/remove/toggle a CSS class, make the navigation sticky, redirect,
  show a site alert. These are pure DOM choreography — they run everywhere and are never
  metered.
- **Advanced in-page effects (Pro+)**: show a popup or bar from your Marketing overlays,
  show custom HTML, track an analytics event, and run custom JS (Business).
- **On the server (Pro+)**: run a workflow, write to or update a dataset, send a webhook
  (Business), send an email, notify site admins, enroll the contact in a list, assign a
  campaign, fire a custom event to chain more actions.
- **In the CRM (Pro+)**: set the contact's lifecycle stage, tag the contact, assign the
  contact an owner, create a CRM task, log a CRM activity. See [CRM steps](#crm-steps).
- **Flow steps (Pro+)**: **Wait**, **Wait for something to happen**, and **End the flow
  here**. See [Sequences](#sequences) below.

On plans without the automations entitlement, an automation that mixes tiers still runs
its basic in-page steps — the Pro+ steps are simply skipped until you upgrade.

### CRM steps {#crm-steps}

Five server steps act on the [CRM](../../content-and-data/contacts/overview.md).
None of them asks *which* contact: each acts on the person the triggering event names —
by `contactId` when the event carries one (every [CRM event](#crm-events) does), otherwise
by the `email` in the event's data, which is what a form submission, a sign-up, a booking
or a lead carries. When neither names a contact this site can see, the step writes
nothing and the run is recorded as **Failed** with the reason (*"no contact this site can
see for …"*), in the same [run history](#run-history) every other step reports to.

| Step | Fields | What it writes |
| --- | --- | --- |
| **Set the contact's lifecycle stage** | Stage | The stage on **this site's** view of the contact. A stage the contact already has is left alone and announces nothing; a real change announces **Contact changed stage**, so an automation listening for it runs — under the same nesting limit a custom event has. |
| **Tag the contact** | Tag (up to 60 characters) | Adds the tag to this site's tags on the contact; a tag already there is not duplicated. |
| **Assign the contact an owner** | Assign to (A team member, or Round robin), Owner's email | Sets the owner to the team member with that address, matched when the automation runs — an address nobody on your team has is a failed step, not a stored string — or, in round robin, to the next member of the pool under [CRM → Settings](../../content-and-data/contacts/settings.md#round-robin), moving the rotation on; an empty pool is a failed step. Either way the contact is reassigned if it had an owner, the site's lead follows, and the new owner is notified. |
| **Create a CRM task** | Title, Kind (Call, Email, Meeting, To-do), Due in (0–365 days), Assignee's email (optional) | A new open task on the CRM's **Tasks** list, linked to the contact (and to the contact's company when it has one), due that many days from the run. Leave the assignee blank to give it to the contact's owner. |
| **Log a CRM activity** | Kind (Call, Email, Meeting, Note, Other), What happened | An activity on the contact's timeline, stamped as made by the automation rather than by a person. |

Tasks and activities an automation creates are visible to exactly the sites a record a
person made on this site would be — the same per-site visibility the contacts themselves
follow.

### Only run this step {#step-conditions}

Every step has its own **Only if** condition, under the step. It reads the same fields
the trigger's conditions read, and when it is not met that one step is skipped and the
automation carries on with the next.

The trigger's conditions decide whether the automation runs at all. A step's condition
decides whether that step runs — which is what lets one automation say "wait three days,
then, only if they have not ordered, send the reminder."

## Sequences {#sequences}

A **Wait** step splits an automation in two. Everything before it runs immediately, and
everything after it runs later, on its own — so a welcome series, a win-back, or a
"three days after they sign up, ask how it's going" is one automation rather than several.

- **Wait** holds for anything from a minute to 90 days.
- **Wait for something to happen** continues as soon as the event you pick happens for
  that person, or when the time you set runs out — whichever comes first. Put an
  **Only if** condition of `_waitTimedOut` **is not empty** on the next step to make it
  the "they never did it" path.
- **End the flow here** stops the rest. With an **Only if** condition it is the exit —
  "stop if they have ordered."

A few things worth knowing before you build one:

- **A waiting automation needs to know who it is waiting for.** The trigger's information
  has to include an email address; a wait step reports an error without one.
- **One at a time per person.** Somebody already partway through an automation is not
  enrolled in it a second time until they finish.
- **Editing an automation does not change it for people already waiting inside it.** They
  finish the version they started. Your edit applies to everybody who enters afterwards.
- **Turning an automation off, or deleting it, stops it for everyone** — including people
  mid-wait.
- **In-page steps after a wait do not run.** By the time the wait ends the visitor's
  browser has long since moved on, so put popups, alerts and element effects before the
  first wait.

Emails sent from a step after a wait are treated as marketing: they carry an unsubscribe
link and header, skip anyone who has unsubscribed or bounced, respect the topic the step
is set to, count toward how much mail one person receives from your site in a day, and go
only to people with a marketing consent record. An email sent *before* any wait is an
immediate reply to what the visitor just did and is treated as transactional.

Every reference (workflow, dataset, webhook, overlay, list, campaign) is picked from a
list and stored by id — renaming things never breaks an automation. Deleting can,
though, so the **Logic** page's **Reference health** card audits every automation,
workflow, and computed-variable reference and lists any that point at something that no
longer exists.

![The Logic page in the Aglyn console: Variables and Functions cards with the Reference health audit reporting that every reference resolves](/img/workflows-and-actions/logic-page.png)

## Run history {#run-history}

Every automation row has a **Runs** button. It opens **Runs — *your automation*** with a
**Recent runs** table of that one automation's executions, in four columns:

| Column | What's in it |
| --- | --- |
| **Time** | The clock time of the run; hover it for the full date and time. |
| **Trigger** | The event, in words — `formSubmission` shows as **Form submitted**. A custom event keeps the name you gave it. |
| **Result** | **Succeeded**, **Failed**, or **Skipped**. |
| **What happened** | For a run, what each step did, joined with `·`. For a failure, the errors. For a skip, which condition stopped it. |

**Skipped** is a result, not an absence — see
[Only run when a field matches](#only-run-when-a-field-matches). A run that fired but
whose steps errored is **Failed**, and the errors are in the last column rather than in a
log you have to go and find.

At the top of the **Actions** tab — and again on the **Workflows** tab, counting workflow
runs — a line reads `1,284 action runs this month · 50,000 included`: how many metered
runs this site has used this calendar month, against the number your plan includes. This
line is the only place action runs are counted for you — the
[billing usage meters](../../workspace-and-billing/billing-and-plans/overview.md#usage-meters)
meter *workflow* runs, not action runs. Watch it: once the month's runs reach the limit,
triggered automations stop running rather than queueing or billing on. The line renders
nothing at all while the counter or the plan is still loading —
`0 runs this month` on a site that has run thousands is the one reading that would make
you stop debugging.

### What is and isn't recorded {#what-is-and-isnt-recorded}

Reference detail. Runs and skips are recorded on different rules, and the gaps are
deliberate:

- **A skip on `pageView` is never logged.** Page-view actions run on every visit to
  every published page, so a record per visitor per non-matching action would be a write
  storm, not a run history. A `pageView` run that **does** execute is logged like any
  other. Page-view conditions are tuned by watching the site, not by reading this table.
- **A skip is only recorded for server events** — form submissions, sign-ups, bookings,
  leads. An action dispatched from an in-page trigger (scroll depth, element click, exit
  intent, time on page) logs its runs, but a condition that stops one of those writes
  nothing.
- **A `Filter` expression rejection writes nothing**, as above.
- **The table is a recent sample, not a guaranteed tail.** It reads a bounded window of
  the site's activity records — which also carry publishes, media saves and member
  changes — keeps this automation's runs from that window, sorts them newest-first and
  shows up to 25. On a quiet site that is your last 25 runs. On a busy one the window can
  fill with other activity, and the newest runs are not guaranteed to be in it. There's
  no paging in the dialog.
- **Nothing prunes run records on a schedule**, so an automation's history keeps
  accumulating in the site's activity log even though this dialog only ever shows a
  window of it. **Admin → Activity** is the full log, ordered newest-first and paginated
  — go there when the Runs dialog doesn't show the run you're looking for.

## Interactions from the Besigner

Select any element in the Besigner and use the **Interactions** section of the
attributes panel to attach a **when clicked**, **when hovered**, or **when scrolled into
view** trigger to that exact element — no CSS selectors to write. Pairing a **when
hovered** trigger with an **open menu** or **open drawer** step is how you build
hover-to-reveal navigation, and — like all basic in-page effects — it works on every
plan. The interaction is saved and enabled on the element itself — it belongs to the
document it is on, not to this section. The same panel lists the
element's existing interactions with an **enable switch and a remove button** — so you
can pause or retire one without leaving the canvas — and offers **"A/B test this
section"**, which creates a draft section experiment for the element.

## When to use which

| Use the actions builder | Use a workflow |
| --- | --- |
| One event → one action | Several ordered steps |
| Simple, no branching | Composes functions/variables |
| Fastest to set up | More control |

## Related

- [Build a workflow](build-a-workflow.md)
- [Webhooks](webhooks.md)
