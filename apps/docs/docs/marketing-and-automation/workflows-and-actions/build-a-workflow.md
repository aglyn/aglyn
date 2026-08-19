---
sidebar_position: 2
title: Build a workflow
description: Create a multi-step workflow that runs when a site event fires.
---

# Build a workflow

A **workflow** is a sequence of steps that runs automatically when something happens on your
site. This guide builds one end to end.

:::info Plan availability
**Pro+**. Workflow **runs are metered** per tier.
:::

![The workflows page](/img/workflows-and-actions/workflows-page.png)

## 1. Open the workflows page

In the console, go to **Data → Workflows** and choose **New workflow**. Give it a name that
describes the outcome (e.g. "Welcome new member").

## 2. Choose a trigger

Pick the **site event** that starts the workflow — for example a form submission, a new
member, or an order. The event's data is available to every step that follows.

## 3. Add steps

Add steps in order. Steps run through a **pure step runner**, so each step is predictable
and repeatable. You can:

- Reference [variables and functions](../../building-sites/bindings/overview.md) inside steps.
- Compose an existing workflow **inside** a function or variable, and vice versa — workflows
  are composable.

## 4. Save and test

Save the workflow. When the trigger fires, the workflow runs and each run counts toward your
tier's metered allowance.

At the top of the **Workflows** tab, `12 workflow runs this month · 5,000 included`
reports the metered allowance you're spending. When the month's runs reach the limit,
triggered workflows stop running — silently, without queueing and without billing on —
so it's a number worth glancing at before you wonder why an automation went quiet.

Each workflow row has a **Runs** button. It opens the run-history table described under
[Run history](actions-builder.md#run-history) — **Time**, **Trigger**, **Result**,
**What happened**.

:::caution Workflow executions don't appear in that table yet
The table reads the records the **actions** runner writes. A workflow execution is
recorded in an older shape that the table doesn't recognise, so it is filtered out — a
workflow that has run can still show *"No runs yet"* in its own **Runs** dialog. Read
workflow executions in the site's activity instead: the dashboard's **Recent Activity**
card shows each one as *"Workflow ran on formSubmission"*, with how long it took
appended and failures in red carrying the error, and **Setup → Activity** is the full
paginated log.
:::

## Tips

- Keep steps small and named — a workflow reads like a checklist.
- Watch your metered run count on the [billing](../../workspace-and-billing/billing-and-plans/overview.md) usage
  meters if a workflow runs on a high-frequency event.

## Related

- [Actions builder](actions-builder.md)
- [Webhooks](webhooks.md)
- [Bindings, variables & functions](../../building-sites/bindings/overview.md)
