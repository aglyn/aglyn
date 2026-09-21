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

Also from the root: contact capture and owner assignment for a host
(`captureHostContact`, `assignOwnerForCapture`, `reassignContactOwner`), and
dataset lookup (`findDatasetByName`, `resolveDatasetDoc`).

By subpath, the screen-composition pipeline. This is the render read-path
shared by the tenant app's server rendering and any plugin that needs to
compose a screen on the server:

- `@aglyn/tenant-runtime/get-screen` (`getScreen`) and
  `@aglyn/tenant-runtime/get-screen-version` (`getScreenVersion`)
- `@aglyn/tenant-runtime/compose-screen-nodes` (`composeScreenNodes`,
  `composeNodesWithChrome`)
- the loaders behind them: `get-layout-version`, `get-components`,
  `get-variables`, `get-datasets`, `get-forms`, `get-plugin-installs`
- page composers for collection, author and search pages:
  `compose-collection-page`, `compose-author-page`, `compose-search-page`
- `apply-publish-schedule` (`applyDuePublishSchedule`)

Each subpath maps to a file under `src/lib`.

## Usage

Listening to host events from a plugin's server code:

```ts
import { registerHostEventListener } from '@aglyn/tenant-runtime'

registerHostEventListener('my-plugin', {
  async onEvent(hostId, event, payload) {
    // react to the event; optionally return site alerts
  },
})
```

Loading a screen on the server:

```ts
import { getScreen } from '@aglyn/tenant-runtime/get-screen'

const screen = await getScreen({ hostId, screenId })
```

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
