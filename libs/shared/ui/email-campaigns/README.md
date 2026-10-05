# @aglyn/shared-ui-email-campaigns

The bulk-send reporting math, owned by none of the plugins that send in bulk.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

```bash
npm install @aglyn/shared-ui-email-campaigns@beta
```

## Why it is not in a plugin

Two plugins mail in bulk and report what their mail did: the Marketing plugin
sends campaigns, and the Outreach plugin runs one-to-one sequences. Each send
records the same counters — sent, delivered, opens, clicks, bounces — and each
report divides them. A rate taken in two places is a rate that drifts: one
reader divides opens by `sent`, the other by `delivered`, and the same mail
reads two ways. So the division lives here, once, and both plugins are its
peers; neither imports the other.

## The model only

```typescript
// Pure. No React, no MUI — safe in a /server handler.
import { sendRate, sendLinkReport, type SendStats } from '@aglyn/shared-ui-email-campaigns/model'
```

The library renders nothing. The figure renderers live in
`@aglyn/shared-ui-jsx`.

## What is here

| Module              | Answers                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `model/send-report` | A send's stored counters, a rate with its denominator named, and the per-link click rollup |

## What is not here

A campaign's own model (AGL-3080): its container and window, a send's report
and the populations it measured, a message's record, what a design's sends
did, and what a campaign caused and earned. Only the Marketing plugin reads
them, so they are its model (`libs/plugins/marketing/src/lib/model/`), not a
shape two plugins share. The Email plugin's template page shows what a
design's sends did through a zone the Marketing plugin fills.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/email-campaigns
