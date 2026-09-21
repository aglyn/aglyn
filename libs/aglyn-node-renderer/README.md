# @aglyn/aglyn-node-renderer

Renders a stored Aglyn node tree as React. It is the one renderer the Besigner
canvas, the console preview and a published site all mount. Install it if you
want to display Aglyn node trees in your own React app.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/aglyn-node-renderer@beta

Peer dependencies:

- `react`

The package depends on `@aglyn/shared-ui-theme` and `@aglyn/shared-ui-jsx`,
which peer on MUI (`@mui/material`, `@mui/system` and related packages). The
renderer reads the active theme, so render it inside a theme provider.

## What's in it

The tree components, from the outside in:

- `TreeRoot` (also exported as `AglynNodeRenderer`) takes the root `node` and
  provides the component set to everything below it.
- `Trunk`, `Stem` and `Branch` walk the tree. `Stem` wraps each node in an
  error boundary, so one failing node does not take the page down.
- `Leaf` renders one node. It looks up the node's `componentId` in the
  `components` registry of `@aglyn/aglyn`, resolves the node's `sx` against
  the active theme and color scheme, and applies element animation attributes.

Replacing a level:

- `TreeRoot` accepts `TrunkComponent`, `StemComponent`, `BranchComponent` and
  `LeafComponent` props. The Besigner editor uses this to swap in a leaf that
  adds selection and drag behavior. The `RendererComponents` context carries
  the chosen set.
- `LeafSxTransformContext` lets a host transform the merged `sx` of every
  leaf just before it reaches the element. A published site does not mount
  it.

Helpers:

- `createAglynComponent(schema, component, options?)` wraps a React component
  for registration: it returns the `{ schema, component }` pair, with the
  component styled and wrapped in an error boundary.
- `useAglynSiteTheme` and `createAglynSiteTheme` build the theme a site renders
  with from a stored host theme.
- `resolveSchemeSx`, `resolvePaletteVars`, `resolvePaletteVarsSx` and related
  `sx` helpers, re-exported from `@aglyn/aglyn`.

Every file under `src/lib` is also reachable by subpath, for example
`@aglyn/aglyn-node-renderer/components/tree-root`.

## Usage

Register a component with the core, then render a node that names it:

```tsx
import { components } from '@aglyn/aglyn'
import { TreeRoot } from '@aglyn/aglyn-node-renderer'
import { createTheme, ThemeProvider } from '@aglyn/shared-ui-theme'

const Box = (props) => <div {...props} />

components.registerComponent(Box, {
  $id: 'box',
  pluginId: 'example',
  displayName: 'Box',
})

const node = {
  $id: 'root',
  componentId: 'box',
  pluginId: 'example',
  props: { id: 'hello' },
  children: [],
}

export function Page() {
  return (
    <ThemeProvider theme={createTheme({ palette: { mode: 'light' } })}>
      <TreeRoot node={node} />
    </ThemeProvider>
  )
}
```

In Aglyn itself the components come from plugins such as `@aglyn/plugins-mui`,
and the root node comes from the core's canvas (`canvas.rootNode`) after a
stored `NodesMap` is loaded into it.

## How it fits

This is the `renderer` scope of the package map: it imports the core
(`@aglyn/aglyn`) and the generic `@aglyn/shared-*` packages, and nothing else.
It knows no plugin; components reach it only through the core's component
registry. `@aglyn/besigner-ui`, the tenant runtime and the plugins build on
it.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/aglyn-node-renderer
