---
sidebar_position: 3
title: Actions builder
description: Map a single event to a single action without building a full workflow.
---

# Actions builder

When you just need "**when X happens, do Y**", the **actions builder** is faster than a full
workflow. It maps one **event** to one **action**.

:::info Plan availability
**Pro+**, with **metered** runs.
:::

## Create an action

1. Open the **actions builder** from **Workflows**.
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

### Only run when a field matches

Every action can carry a **condition** over the event's payload — for form submissions,
that's the submitted field values. Pick an operator in the **"Only run when"** select:

- **A field is not empty** — e.g. the `subscribe` checkbox was ticked.
- **A field equals…** — an exact match (trimmed, case-insensitive), e.g.
  `plan` equals `Pro`.
- **A field contains…** — a partial match, handy for checkbox groups that submit
  all ticked options joined with `, ` (e.g. `topics` contains `Pricing`).

When the condition isn't met the action is simply skipped — it doesn't count as a
metered run. Conditions are the no-code sibling of the free-text **Filter**
expression; use whichever reads better (both must pass when both are set).

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

Each automation row offers a **Runs** log (its recent executions) and, for page
triggers, a **Test** button that exercises the server-side steps immediately.

## Steps

Steps run in order and mix **in-page effects** with **server-side work**:

- **In the page**: show a popup or bar from your Marketing overlays, make the navigation
  sticky, add/remove a CSS class, show custom HTML, run custom JS (Business), redirect,
  track an analytics event, show a site alert.
- **On the server**: run a workflow, write to or update a dataset, send a webhook
  (Business), send an email, notify site admins, enroll the contact in a list, assign a
  campaign, fire a custom event to chain more actions.

Every reference (workflow, dataset, webhook, overlay, list, campaign) is picked from a
list and stored by id — renaming things never breaks an automation. Deleting can,
though, so the **Logic** page's **Reference health** card audits every automation,
workflow, and computed-variable reference and lists any that point at something that no
longer exists.

![The Logic page in the Aglyn console: Variables and Functions cards with the Reference health audit reporting that every reference resolves](/img/workflows-and-actions/logic-page.png)

## Interactions from the Besigner

Select any element in the Besigner and use the **Interactions** section of the
attributes panel to attach a "when clicked" or "when scrolled into view" trigger to that
exact element — no CSS selectors to write. The interaction is created disabled with a
placeholder step; finish and enable it on the Workflows page. The same panel lists the
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
