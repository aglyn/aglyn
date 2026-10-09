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

![Webhook steps run inside workflows](/img/workflows-and-actions/workflows-page.png)

## Outbound webhooks

Send an HTTP request to a URL you control when a site event fires — for example, post to a
Slack endpoint or your own API when a form is submitted or a new booking comes in.

1. Add an **outbound webhook** and paste the destination URL.
2. Choose the **event** that should fire it.
3. Save. Aglyn calls your URL with the event payload each time it fires.

Each delivery is a `POST` of JSON with four keys: `event` (such as `formSubmission`),
`payload` (the event's data — for a form, `formName`, `path` and every submitted field),
`sentAt`, and `text`, a readable summary of the same event. When the webhook has a
secret, the `X-Aglyn-Signature` header is the HMAC-SHA256 of the body under it.

### Post every form submission to Slack {#slack}

Slack, Google Chat and Microsoft Teams incoming webhooks post the `text` key as the
message, so no translating service is needed in between.

1. In Slack, create an app with **Incoming Webhooks** turned on, add a webhook to the
   channel you want, and copy its `https://hooks.slack.com/services/…` URL.
2. Under **Automation → Webhooks**, add an **outbound** webhook named e.g. `Slack` and
   paste the URL.
3. Under **Automation → Workflows**, choose **New workflow**, pick **Form submitted** as
   the trigger, and add one step: **Send a webhook**, picking `Slack`. Save.

Each submission then arrives as:

```text
New form submission — Contact us
• name: Jane Doe
• email: jane@example.com
Page: /pricing
```

The workflow's **Runs** read `webhook 200` for each one Slack accepted. To post only one
form's submissions, build it as an [action](actions-builder.md) on **Form submitted** with
a **Form is** condition and the same **Send a webhook** step instead.

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
