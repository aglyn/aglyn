---
sidebar_position: 4
title: Webhooks
description: Connect Aglyn to other systems with outbound and inbound webhooks.
---

# Webhooks

**Webhooks** connect Aglyn to the outside world. **Outbound** webhooks notify another system
when something happens on your site; **inbound** webhooks let another system trigger
something in Aglyn.

:::info Plan availability
**Business**. Webhooks are a Business-tier feature.
:::

## Outbound webhooks

Send an HTTP request to a URL you control when a site event fires — for example, post to a
Slack endpoint or your own API when an order is placed.

1. Add an **outbound webhook** and paste the destination URL.
2. Choose the **event** that should fire it.
3. Save. Aglyn calls your URL with the event payload each time it fires.

## Inbound webhooks

Expose an endpoint that external systems can call to trigger Aglyn — for example to kick off
a [workflow](build-a-workflow.md) from a third-party tool.

## Tips

- Pair an outbound webhook with a [workflow](build-a-workflow.md) when you need to transform
  data before sending it.
- Treat webhook URLs as secrets — anyone with the inbound URL can trigger it.

## Related

- [Build a workflow](build-a-workflow.md)
- [Actions builder](actions-builder.md)
