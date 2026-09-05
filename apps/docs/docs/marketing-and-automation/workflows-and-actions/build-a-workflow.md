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

In the console, go to **Automation → Workflows** and choose **New workflow**. Give it a name that
describes the outcome (e.g. "Welcome new member").

## 2. Choose a trigger

Pick the **site event** that starts the workflow — for example a form submission, a new
member, an order, or a [CRM event](actions-builder.md#crm-events) such as **Contact
created**. The event's data is available to every step that follows, and the **Filter**
field's helper text names the keys the chosen event puts in scope.

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

A workflow row reads **Ran** under *What happened*, or the error when it failed, with
the time it took beneath.

:::note Runs recorded before this shipped are not in the table
Workflow executions were written in a shape the table did not recognize, so anything
that ran before AGL-2222 is filtered out of it. Those runs are not lost — the
dashboard's **Recent Activity** card and **Admin → Activity** show every one of them,
as *"Workflow ran on formSubmission"* with the duration appended and failures in red.
:::

## Tips

- Keep steps small and named — a workflow reads like a checklist.
- Watch your metered run count on the [billing](../../workspace-and-billing/billing-and-plans/overview.md) usage
  meters if a workflow runs on a high-frequency event.

## Related

- [Actions builder](actions-builder.md)
- [Webhooks](webhooks.md)
- [Bindings, variables & functions](../../building-sites/bindings/overview.md)
