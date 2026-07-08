---
sidebar_position: 2
title: Build a workflow
description: Create a multi-step workflow that runs when a host event fires.
---

# Build a workflow

A **workflow** is a sequence of steps that runs automatically when something happens on your
host. This guide builds one end to end.

:::info Plan availability
**Pro+**. Workflow **runs are metered** per tier.
:::

## 1. Open the workflows page

In the console, go to **Data → Workflows** and choose **New workflow**. Give it a name that
describes the outcome (e.g. "Welcome new member").

## 2. Choose a trigger

Pick the **host event** that starts the workflow — for example a form submission, a new
member, or an order. The event's data is available to every step that follows.

## 3. Add steps

Add steps in order. Steps run through a **pure step runner**, so each step is predictable
and repeatable. You can:

- Reference [variables and functions](../bindings/overview.md) inside steps.
- Compose an existing workflow **inside** a function or variable, and vice versa — workflows
  are composable.

## 4. Save and test

Save the workflow. When the trigger fires, the workflow runs and each run counts toward your
tier's metered allowance.

## Tips

- Keep steps small and named — a workflow reads like a checklist.
- Watch your metered run count on the [billing](../billing-and-plans/overview.md) usage
  meters if a workflow runs on a high-frequency event.

## Related

- [Actions builder](actions-builder.md)
- [Webhooks](webhooks.md)
- [Bindings, variables & functions](../bindings/overview.md)
