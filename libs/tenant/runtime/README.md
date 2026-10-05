# @aglyn/tenant-runtime

The server-side runtime that serves a published Aglyn site: the host-event
seam that plugins listen on, and the screen-composition pipeline that turns a
stored screen into the node tree a page renders. Install it if you are running
Aglyn's tenant server, or writing plugin server code that needs to emit host
events or compose a screen.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/tenant-runtime@beta

Peer dependencies:

- `firebase-admin`

This package is server-only. It reads Firestore through `firebase-admin` and
must not be imported from client code.

## What's in it

From the package root, the host-event runtime. It hosts the event seam that no
single plugin owns, and runs none of what an event triggers:

- `emitHostEvent` is the one emit point. It hands an event to every registered
  host-event listener and returns any site alerts, so request/response
  emitters (a form submission, a booking) can surface them.
- `registerHostEventListener` is how a plugin hears host events. A plugin
  registers from its server declarations entry, which the apps run at boot, so
  a core route that never loads the plugin still reaches it. The automation
  engine is one such listener, and lives in its own plugin.
- `dispatchHostAutomation` runs one automation by id for a site event the
  published page evaluated itself, through the listeners that dispatch.
- `listHostEventListeners` and `runHostEventListeners` for diagnostics and
  direct use.

Contact capture and owner assignment are the CRM's
(`@aglyn/plugins-crm/server/capture-host-contact`,
`@aglyn/plugins-crm/server/assign-contact-owner`): another plugin reports a
person through the platform's capture contract (`plugin-contact-capture`).
Finding a dataset by its id or name is the data plugin's
(`@aglyn/plugins-data/server/resolve-dataset`).

By subpath, the screen-composition pipeline. This is the render read-path
shared by the tenant app's server rendering and any plugin that needs to
compose a screen on the server:

- `@aglyn/tenant-runtime/get-screen` (`getScreen`) and
  `@aglyn/tenant-runtime/get-screen-version` (`getScreenVersion`)
- `@aglyn/tenant-runtime/compose-screen-nodes` (`composeScreenNodes`,
  `composeNodesWithChrome`)
- the loaders behind them: `get-layout-version`, `get-components`,
  `get-variables`, `get-forms`, `get-plugin-installs` — a repeat's rows come
  from the plugin that keeps them, through `@aglyn/aglyn/plugin-manager/repeat-rows`
- page composers for collection, author and search pages:
  `compose-collection-page`, `compose-author-page`, `compose-search-page`
- `apply-publish-schedule` (`applyDuePublishSchedule`)

Each subpath maps to a file under `src/lib`.

## Usage

Listening to host events from a plugin's server code:

```ts
import { registerHostEventListener } from '@aglyn/tenant-runtime'

registerHostEventListener('my-plugin', {
  async onEvent(hostId, event, payload, context) {
    // react to the event; optionally return site alerts.
    // `context.actor` is who caused it, when the emitting door knew:
    // { kind: 'member' | 'visitor' | 'apiKey' | 'platform', uid?, email?, apiKeyName? }
  },
})
```

Raising one, with who caused it:

```ts
await emitHostEvent(hostId, 'contactStageChanged', payload, {
  actor: { kind: 'member', uid, email },
})
```

Loading a screen on the server:

```ts
import { getScreen } from '@aglyn/tenant-runtime/get-screen'

const screen = await getScreen({ hostId, screenId })
```

## The render path never awaits unbounded I/O

A page render, and everything it awaits — the layouts, the page-data loader,
this pipeline, plugin page enrichers, resolvers, redirect resolvers, repeat
readers and computed variables, and the middleware in front of them — never
waits on outbound network I/O without a deadline of its own (AGL-3565).

- Wrap the await in `boundedAwait(work, ms, fallback, label)` from
  `@aglyn/shared-util-http/bounded-await`: a real timer race that answers with
  `fallback` when `ms` passes, whatever the work does. Pass its `signal` to
  `fetch` so the request is canceled too, and put the body read inside the
  work. An `AbortSignal` on its own is not a deadline: on Vercel, Next's
  patched `fetch` handed back a promise that never settled with
  `AbortSignal.timeout(2500)` on it, and every uncached page on the platform
  waited for the 60-second function limit.
- Pick a fallback the page can render with, and say what it means: the
  linked font stylesheet, the verdict "unreachable", a redirect rule held.
- A process cache that outlives a request holds settled values only
  (`createSettledValueCache`, which refuses a promise). A cached in-flight
  promise is awaited by every later render, each with a fresh deadline in
  front of nothing.
- Work nothing needs the answer of is detached with `void`, never awaited.

`apps/tenant/specs/render-path-bounded-io.spec.ts` sweeps every symbol a
render can reach for a `fetch`, a `fetch` passed on as a value, a token
exchange or `http(s).request`, and refuses one that is not behind
`boundedAwait` or `void`. Its allowlist carries a reason per row and may only
shrink. Firestore reads through `firebase-admin` are outside it: they carry
the client's own deadlines.

## How it fits

This is the `tenant` scope of the package map. It depends only on
`@aglyn/aglyn`, `@aglyn/tenant-data-admin` (its server data layer) and
`firebase-admin`, so it is importable from the tenant app's API routes and
from a plugin's server handlers without pulling app code into a library. A
plugin may import it; it never imports a plugin. Plugins reach it by
registering a listener, and the runtime knows them only through that
registration and the loader manifests.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/tenant/runtime
