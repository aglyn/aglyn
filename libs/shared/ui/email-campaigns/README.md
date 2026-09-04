# @aglyn/shared-ui-email-campaigns

The email-campaign document model and the figures that render it, owned by
neither of the two plugins that read it.

## Why it is not in a plugin

An email campaign is written by one plugin and reported by another. The
Marketing plugin owns the `campaigns` console section; the Email plugin owns
the message, template and list surfaces. Both are independently toggleable —
`release_marketing` and `release_email` are separate flags in
`libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts` — so an organization
can have either one without the other.

A shape that lives inside one of them is therefore a shape the other reaches
past a switch to get. Because every plugin compiles into the same console
bundle, such an import resolves at runtime whether or not the owning plugin is
enabled, and the plugin switchboard is bypassed silently rather than failing.
Putting the shared half here makes both plugins peers of it: each depends on
this library, neither depends on the other for a rate, a field name or a
`<Figure>`.

The boundary is enforced in
`libs/plugins/marketing/src/lib/plugin-email-boundary.spec.ts`, which fails if
Marketing re-acquires an import of anything this library owns from
`@aglyn/plugins-email`.

## Two entry points, deliberately

```typescript
// Pure. No React, no MUI — safe in a /server handler.
import {
  campaignReport,
  CAMPAIGN_SEND_CONTAINER_FIELD,
} from '@aglyn/shared-ui-email-campaigns/model'

// Renders MUI. Console surfaces only.
import {
  Figure,
  RateRow,
  Section,
} from '@aglyn/shared-ui-email-campaigns/components/report-figures'
```

The package barrel (`@aglyn/shared-ui-email-campaigns`) re-exports the model
and nothing else, so a webhook handler that needs one stored field name does
not pull a component graph in behind it. `report-figures` is reachable by
subpath only — the same barrel discipline `@aglyn/shared-ui-jsx` runs under.

## What is here

| Module                      | Answers                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `model/campaign-container`  | The campaign's window, its lists, its sends, and the rollup across them           |
| `model/campaign-report`     | The rate math, the population each rate describes, and the link rollup            |
| `model/campaign-revenue`    | What a campaign earned, per currency, gross and refunded                          |
| `model/email-record`        | One message: its state, its audience, and when it went out                        |
| `components/report-figures` | The renderers those figures print through, so a rate always shows its denominator |

`model/campaign-revenue` re-exports the attribution window and model name from
`@aglyn/shared-util-email`, which is where the writer in `tenant-data-admin`
takes them from — one definition of the window on both sides of the join.

## What is not here

Sending. The send loop, the composer, the topic subscriptions and the
send-time API all stay in `@aglyn/plugins-email`: they are behavior that the
Email plugin's switch is supposed to govern, not shapes that two plugins share.

## Running unit tests

Run `nx test shared-ui-email-campaigns` to execute the unit tests via
[Jest](https://jestjs.io).
