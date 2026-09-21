# @aglyn/aglyn

The core of Aglyn: the platform's data model (hosts, screens, layouts, node
trees), the runtime managers that hold components, plugins and the canvas, and
the framework-independent utilities the rest of the `@aglyn` packages are built
on. Install it if you are building on Aglyn's model: a renderer, an editor, a
plugin, or a tool that reads and writes Aglyn documents.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/aglyn@beta

Peer dependencies:

- `react` is required.
- `next`, `firebase`, `@mui/material` and `@mui/system` are declared optional
  (`peerDependenciesMeta`). The package installs and bundles with only `react`.
  Bring the optional ones only for the modules that use them:
  - `@mui/material` for the consent UI modules
    (`@aglyn/aglyn/app-utils/consent-banner-ui`,
    `@aglyn/aglyn/app-utils/consent-preferences-dialog`); `@mui/material` and
    `@mui/system` also supply types that some node and component type
    definitions refer to.
  - `next` for `@aglyn/aglyn/app-utils/advertising-tag-mounts`, which uses
    `next/script`.
  - `firebase` is declared for apps that pair the model with Firebase, as
    Aglyn's own apps do. No module in this package needs it to load.

This is the "logic only" consumer story: `@aglyn/aglyn` together with
`@aglyn/besigner` installs with `react` as the only peer, and needs no UI
library, no `next`, and no Firebase SDK.

## What's in it

Entry points:

- `@aglyn/aglyn` is the full barrel, for client code.
- `@aglyn/aglyn/server` is the server-safe barrel. It re-exports the same
  model, managers and pure utilities without the client React contexts, so it
  can be imported from React Server Components. It also carries the modules
  that use Node built-ins or a JavaScript parser and are therefore kept out of
  the client barrel: the Web-to-`(req, res)` API adapter, API idempotency,
  the person key, the plugin bundle checks, and the server side of realm
  plugins.
- `@aglyn/aglyn/*` maps to a file under `src/lib`, for example
  `@aglyn/aglyn/aglyn` or `@aglyn/aglyn/app-utils/markdown-lite`. A subpath
  names a file, not a folder. Importing by subpath keeps a bundle to what it
  uses.

Main areas under `src/lib`:

- `aglyn` is the runtime singleton. It exports `aglyn` and its parts:
  `emitter`, `plugins`, `components`, `canvas` and `logger`. The instance is
  keyed on `globalThis`, so duplicate module copies in one JavaScript realm
  share one runtime.
- `types` holds the node and screen model: `NodeSchema`, `NodesMap`,
  `ComponentSchema`, `PresetSchema`, `ScreenSchema`, routing and AST types.
- `foundation` holds the platform document types (`AglynHost`, `AglynScreen`,
  `AglynLayout`, `AglynHostTheme`, organization and billing shapes, and their
  id types) and shared constants.
- `emit-manager` is `EmitManager` (an `eventemitter2` emitter) and the
  `AglynEvent` enum of lifecycle and action events.
- `components-manager` is `ComponentManager`, the registry of component
  factories, their schemas, and presets.
- `plugin-manager` is `PluginManager` (plugin registration and dependency
  status) plus the plugin seams: the plugin loader (`createPluginLoader`),
  contributions, configuration, permissions, entitlements, events, services
  and jobs. Aglyn's feature plugins attach to the platform through these.
- `canvas-manager` is `CanvasManager`, the observable node tree: set, create,
  delete, duplicate, reparent and reorder nodes, with undo and redo history.
- `app-utils` is a large set of pure helpers over the model: node composition
  and sanitizing, binding tokens and variables, datasets and collections, SEO
  and sitemap helpers, the markdown-lite dialect, permissions and roles,
  consent, analytics keys, media references, and more. Its React contexts
  (site context, media picker, enabled plugins and others) are exported from
  the client barrel only.
- `utils` has the feature-flag predicates such as `isFeatureEnabled`.

## Usage

```ts
import { AglynEvent, canvas, components, emitter } from '@aglyn/aglyn'

emitter.on(AglynEvent.COMPONENT_REGISTERED, ({ $id }) => {
  console.log('registered', $id)
})

components.registerComponent(MyBox, {
  $id: 'my-box',
  pluginId: 'my-plugin',
  displayName: 'My box',
})

components.getSchema('my-box')

// `nodes` is a NodesMap: node id -> NodeSchema
canvas.setNodes(nodes)
const root = canvas.rootNode
```

From a Server Component or other server code:

```ts
import type { AglynScreen, NodeSchema } from '@aglyn/aglyn/server'
```

## How it fits

`@aglyn/aglyn` is the `core` scope of the package map. It imports only itself
and the generic `@aglyn/shared-*` packages. It holds no rendering, no designer,
no tenancy and no plugin: the core never imports a plugin, and a plugin's
domain lives in that plugin. Everything else stands on it:
`@aglyn/aglyn-node-renderer` turns its node trees into React,
`@aglyn/besigner` and `@aglyn/besigner-ui` edit them, the `@aglyn/tenant-*`
packages serve them, and every `@aglyn/plugins-*` package registers into its
managers.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/aglyn
