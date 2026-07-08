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

1. Open the **actions builder** from **Data**.
2. Choose the **event** (the trigger).
3. Choose the **action** to run in response.
4. Save.

That's it — no multi-step logic to manage. Reach for a [workflow](build-a-workflow.md) when
you need several steps, branching, or composition.

## When to use which

| Use the actions builder | Use a workflow |
| --- | --- |
| One event → one action | Several ordered steps |
| Simple, no branching | Composes functions/variables |
| Fastest to set up | More control |

## Related

- [Build a workflow](build-a-workflow.md)
- [Webhooks](webhooks.md)
