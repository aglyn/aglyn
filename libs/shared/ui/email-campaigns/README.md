# @aglyn/shared-ui-email-campaigns

The email-campaign document model, owned by none of the plugins that read it.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

```bash
npm install @aglyn/shared-ui-email-campaigns@beta
```

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

## The model only

```typescript
// Pure. No React, no MUI — safe in a /server handler.
import {
  campaignReport,
  CAMPAIGN_SEND_CONTAINER_FIELD,
} from '@aglyn/shared-ui-email-campaigns/model'
```

The library renders nothing. The figure renderers live in
`@aglyn/shared-ui-jsx`, and the control that files a record under a campaign
is the core's generic `ContainerPicker` (`@aglyn/tenant-feature-instance`),
handed the `campaign` kind the Marketing plugin declares.

## What is here

| Module                      | Answers                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `model/campaign-container`  | The campaign's window, its lists, its sends, and the rollup across them           |
| `model/campaign-report`     | The rate math, the population each rate describes, and the link rollup            |
| `model/email-record`        | One message: its state, its audience, and when it went out                        |

## What is not here

What a campaign caused and earned — the conversions it is credited with and
its revenue per currency. Only the Marketing plugin reads them, so they are
its model (`libs/plugins/marketing/src/lib/model/`), not a shape two plugins
share.

Sending. The send loop, the composer, the topic subscriptions and the
send-time API all stay in `@aglyn/plugins-email`: they are behavior that the
Email plugin's switch is supposed to govern, not shapes that two plugins share.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/email-campaigns
