---
sidebar_position: 6
title: Plugin configuration
description: Declare a settings schema and get a console form for free — plus the three layers a setting is answered at, workspace defaults with per-site overrides, and the one write that clears one.
---

# Plugin configuration

A plugin declares the settings it takes; Aglyn stores the answers and renders
the form. You write no settings UI, and you never invent your own inheritance —
a setting can be answered at three levels, and the platform resolves them the
same way for every plugin.

## The three layers {#layers}

| Layer | Where it lives | Who sets it |
| --- | --- | --- |
| Schema defaults | Your code | You, the plugin author |
| Workspace value | `orgs/{orgId}/pluginSettings/{pluginId}` | An org manager, in **Plugins & add-ons** |
| Site override | `hosts/{hostId}/pluginSettings/{pluginId}` | A site admin, in that site's plugin settings |

Each layer narrows the one before it, **per key**. A workspace sets a value once
and every site it enabled the plugin on follows it; a site that needs a
different answer overrides that one field and keeps inheriting the rest. One
booking horizon across a chain, with the flagship branch taking bookings further
out, is the shape this exists for.

Only the keys the **site document actually holds** are overrides. The site
document is not a full copy of the config — it is a sparse patch.

## Declare a schema {#declare}

There is no manifest field for this. A schema is registered in code, at module
scope, from a file imported by **both** your client barrel and your `/server`
entry — so whichever surface loads first, the schema is there.

```ts
// plugin-config.ts — pure data, type-only import.
import type { PluginConfigSchema } from '@aglyn/aglyn'

export const BOOKINGS_CONFIG_SCHEMA: PluginConfigSchema = {
  pluginId: 'bookings',
  fields: [
    {
      key: 'maxDaysAhead',
      label: 'How far ahead visitors may book',
      type: 'number',
      min: 1,
      max: 365,
      description: 'Days. Slots beyond this are not offered.',
    },
    {
      key: 'timeFormat',
      label: 'Time format',
      type: 'select',
      options: [
        { value: '12h', label: '12-hour' },
        { value: '24h', label: '24-hour' },
      ],
    },
  ],
  defaults: { maxDaysAhead: 60, timeFormat: '12h' },
  validate: (values) =>
    Number(values.maxDaysAhead) < 1 ? 'Booking horizon must be at least a day' : null,
}
```

```ts
// plugin.ts (client barrel) AND server.ts — both.
Aglyn.registerPluginConfigSchema(BOOKINGS_CONFIG_SCHEMA)
```

Registration is idempotent and keyed by `pluginId`; registering again replaces
the schema.

### Field types {#field-types}

| `type` | Editor | Coercion |
| --- | --- | --- |
| `string` | Text field | Anything that is not a string falls back. An empty string is a valid value and is kept. |
| `number` | Number field | Must be a finite number, then **clamped** to `min` / `max` — a value outside the range is pulled to the bound, not rejected. |
| `boolean` | Switch | Must be an actual boolean. `"true"` is not one. |
| `select` | Dropdown | Must match one of `options[].value`. |

`label` is required and `description` is optional help text under the field.

`validate` is a cross-field hook run against the merged values before a save.
Return an error string to block the save, or `null` to allow it.

:::warning Values are not trusted
The settings documents are client-writable by org managers and site admins, so
every read coerces defensively. A value of the wrong type falls back rather than
reaching your code — and **keys your schema does not declare are dropped
entirely**, so a field left behind by an older version of your plugin cannot
resurface as config.
:::

## Read the config {#read}

**On the server**, from a handler:

```ts
import { getPluginConfig } from '@aglyn/aglyn/server'

const config = await getPluginConfig(orgId, 'bookings', { hostId })
```

**Pass `hostId` whenever you have one.** Without it you get the workspace's
answer and the site's override is silently ignored — which is worse than not
having the feature: the console shows the number the operator typed while your
handler keeps using the workspace's, a disagreement with no error and no surface
that shows both sides. The site read is conditional and runs alongside the org
read, so passing it costs no extra round trip.

**In the console or another client surface:**

```ts
// Workspace scope.
const { config, ready } = usePluginConfig(orgId, 'bookings')

// Site scope — the resolved view, plus which keys this site is answering.
const { config, overrides, ready } = useSitePluginConfig(orgId, hostId, 'bookings')
```

`ready` is false until every document it needs has answered. Do not read
`config` before then; it is the schema defaults, which is a plausible-looking
wrong answer.

### With no registered schema {#no-schema}

Both readers degrade rather than failing: you get the raw stored documents with
the site's spread over the workspace's, key for key, and no coercion. That keeps
a handler working when its schema module has not loaded, but it is not the
behavior to design against.

## Resolution, exactly {#resolution}

1. Start from `schema.defaults`.
2. Apply the workspace document, for declared keys only.
3. Apply the site document, for the keys it actually holds.
4. Coerce **once, at the end**.

Step 4 is the subtle one. Because coercion happens last, a site override of the
wrong type falls back to the **workspace value it was trying to replace**, not to
the schema default. The other way round, one malformed site setting would
silently discard a workspace answer the operator can see in their own console.

A key is an override when it is **present** on the site document. `undefined`
counts as absent — a form that writes `{ key: undefined }` to mean "stop
overriding" is doing the same thing as one that never wrote the key, and
treating the two differently would make "revert to the workspace value" depend
on which code path cleared it.

:::danger Clearing an override means deleting the field
`setDoc(..., { merge: true })` leaves an existing field exactly as it is when
the new object omits it. A form that drops empty inputs therefore **cannot clear
anything by saving** — the override survives, invisibly, and the site keeps
ignoring a workspace value the operator has since changed.

Deleting the field is the only write that returns a key to inherited. The
console's own settings form does this behind its **Inherited** control.
:::

## What the console renders {#console-ui}

The **Plugins & add-ons** hub builds a form from your schema, so a plugin gets a
settings UI without writing one. At site scope the same form marks each field
**Set for this site** or **Inherited**, and offers a control to drop the
override.

Who may write which document is enforced by security rules, not by the form: the
workspace document takes an org manager, the site document takes a **site
admin**. Writes to either are frozen while the organization is suspended or the
site's writes are frozen.

:::danger Never put a secret in plugin config
There is no secret field type and no redaction. Both documents are read
**client-side** — the workspace document by any member of the organization — so
anything stored here should be assumed visible to everyone in the workspace and
present in the browser. API keys, tokens and signing secrets belong in the
environment; see [Manifests & environment](./manifest-and-envs.md).
:::

## API summary {#api}

| Symbol | From | Purpose |
| --- | --- | --- |
| `registerPluginConfigSchema(schema)` | `@aglyn/aglyn` | Declare the settings. Idempotent per `pluginId`. |
| `getPluginConfigSchema(pluginId)` | `@aglyn/aglyn` | The registered schema, or `undefined`. |
| `listPluginConfigSchemas()` | `@aglyn/aglyn` | Every registered schema — what the console's hub enumerates. |
| `mergePluginConfig(schema, stored)` | `@aglyn/aglyn` | Defaults merged with one document, coerced. |
| `resolvePluginConfig(schema, { org, host })` | `@aglyn/aglyn` | The full three-layer resolution. |
| `pluginConfigOverrides(schema, host)` | `@aglyn/aglyn` | Which keys a site is answering for itself. |
| `validatePluginConfigValues(schema, values)` | `@aglyn/aglyn` | Pre-save check: coerce, then run `validate`. |
| `getPluginConfig(orgId, pluginId, { hostId })` | `@aglyn/aglyn/server` | The resolved config for a request. |
| `usePluginConfig(orgId, pluginId)` | client | Workspace-scope resolved config. |
| `useSitePluginConfig(orgId, hostId, pluginId)` | client | Site-scope resolved config, plus `overrides`. |

## Related

- [Plugin-manager API reference](./plugin-manager-api.md)
- [Manifests, trust lifecycle & environment](./manifest-and-envs.md)
- [Building feature plugins](../building-feature-plugins.md)
