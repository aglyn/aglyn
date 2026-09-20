# @aglyn/tenant-runtime

Server-side host-event runtime shared by the tenant app and feature plugins
(AGL-396). Hosts the event seam that no single plugin owns, and runs none of
what an event triggers:

- `emitHostEvent` — the one emit point; hands an event to every registered
  host-event listener, returning any site alerts for request/response
  emitters (form submit, booking) to surface.
- `registerHostEventListener` — how a plugin hears host events. Registered by
  a call from the plugin's `serverDeclarations` entry, which both apps run at
  boot, so a core route that never loads the plugin still reaches it. The
  automation engine is one such listener, and lives in its plugin.
- `dispatchHostAutomation` — runs one automation by id for a site event the
  published page evaluated itself, through the listeners that dispatch.

It also hosts the server-side **screen-composition pipeline** — `getScreen`,
`composeScreenNodes`, and the `get-*` version/component/variable/dataset
loaders behind it — reached via subpath imports
(`@aglyn/tenant-runtime/compose-screen-nodes`, etc.). This is the tenant
render read-path shared by the app's SSR and any plugin that needs to
compose a screen server-side (e.g. commerce's members-only content route).

Depends only on `@aglyn/aglyn`, `@aglyn/tenant-data-admin`, and
`firebase-admin`, so it is importable from both `apps/tenant` API routes and
plugin `server.ts` handlers without pulling app code into a lib.
