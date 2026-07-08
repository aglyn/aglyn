---
sidebar_position: 1
title: Workflows, Actions & Webhooks
description: Automate your site — run multi-step workflows on host events, and connect to other systems with webhooks.
---

# Workflows, Actions & Webhooks

Automate what happens on your site. **Workflows** run multi-step logic when something
happens; the **actions builder** maps an event to an action; **webhooks** connect Aglyn to
outside systems.

```mermaid
flowchart LR
  E["Host event<br/>(form submit, order, member)"] --> W["Workflow<br/>(ordered steps)"]
  W --> S1[Step 1]
  S1 --> S2[Step 2]
  W --> WH["Outbound webhook<br/>→ external system"]
```

:::info Plan availability
**Pro+** for actions and workflows (metered runs per tier). **Webhooks** are **Business**.
:::

## Workflows

- Build workflows on the **workflows page** with a pure step runner.
- Trigger them from **host events**, and compose [functions and variables](../bindings/overview.md)
  inside them.
- Runs are **metered** per tier.

## Actions builder

The **actions builder** turns an event into an action — event → action automation without
code. Available on **Pro+** with metered runs.

## Webhooks

**Outbound** and **inbound** webhooks let Aglyn notify other systems and receive events from
them. Webhooks are a **Business**-tier feature.

:::note More detailed how-tos coming
Recipes for common automations (notify on form submit, sync orders, etc.) are on the way.
:::

## Related

- [Bindings, variables & functions](../bindings/overview.md)
- [Billing & plans](../billing-and-plans/overview.md)
