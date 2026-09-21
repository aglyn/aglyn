# @aglyn/besigner

The logic of Besigner, Aglyn's visual editor, with no UI in it: editor app and
interface state, selection and hover, drag-and-drop rules, the element and
style clipboards, and node moves. Install it if you are building your own
editor UI over Aglyn's node model. If you want the editor as it ships, take
`@aglyn/besigner-ui`, which is built on this package.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/besigner@beta

Peer dependencies:

- `react` (used for ref types only; the package renders nothing)

This is the "logic only" consumer story: `@aglyn/besigner` together with
`@aglyn/aglyn` installs with `react` as the only peer. It needs no `next`, no
Firebase SDK, no MUI and no `@aglyn/besigner-ui`. The framework peers of
`@aglyn/aglyn` are all optional.

## What's in it

Editor app and interface state:

- `initializeBesignerApp`, `getBesignerApp`, `doesBesignerAppExist` and
  `deleteBesignerApp` manage named editor app instances
  (`BesignerAppController`). With no name, the default app is used.
- `BesignerInterfaceController` holds the editor's flags and panel state.
  `setBesignerFlag`, `setBesignerFlags`, `setBesignerPanel` and
  `setBesignerPanels` update it for a given app.
- Constants and types for that state: `InteractionModeFlag`,
  `BesignerDeviceFlag`, `BesignerPanelViewFlag`, `BesignerPanelTabFlag`,
  `BesignerContext` and the flag and panel key types.

Managers, which act on the canvas of `@aglyn/aglyn`:

- `focus` is the selection, hover and tree-expansion state: `setSelectedNode`,
  `getSelected`, `rangeSelectNode`, `clearSelection`, `setHoveredNode`,
  `expandNode`, `collapseNode` and others.
- `dnd` is a `DndManager` instance tracking the current drag, drop target and
  drop region. Beside it are `confirmValidLinealRelationship`, which checks
  whether an item may sit under a given parent (the lineal rules),
  and the drop-region geometry helpers such as `determineDropRegion`.
- `clipboard` copies and pastes elements (`copyNodes`, `pasteInto`,
  `hasContent`, `clear`), and `styleClipboard` does the same for styles. The
  clipboard mirrors itself into `localStorage`.
- `moveNodeIn`, `moveNodeOut`, `canMoveNodeIn`, `canMoveNodeOut`,
  `resolveMoveIn` and `resolveMoveOut` move a node one level into or out of
  its neighbors.
- `pick` is the "pick an element on the canvas" mode: `startPick`,
  `cancelPick`, `isPicking`, `handlePickClick`.
- `refs` maps node ids to their rendered DOM refs, for a UI to fill.
- `isTextEntryElement` and `isTextEntryFocused` tell a shortcut handler when
  the user is typing.
- `devicePreviewWidth` and `isRootElementId` are small helpers.

Every file under `src/lib` is also reachable by subpath, for example
`@aglyn/besigner/focus-manager/focus-manager`.

## Usage

```ts
import { canvas } from '@aglyn/aglyn'
import {
  canMoveNodeOut,
  clipboard,
  focus,
  initializeBesignerApp,
  moveNodeOut,
} from '@aglyn/besigner'

const app = initializeBesignerApp()

// `nodes` is a NodesMap loaded from a stored screen version
canvas.setNodes(nodes)

const [first] = canvas.rootNode.children
focus.setSelectedNode(first)

clipboard.copyNodes(focus.getSelected())
const pasted = clipboard.pasteInto(canvas.rootNode)
if (pasted.error) console.warn(pasted.error)

if (canMoveNodeOut(first)) moveNodeOut(first)
```

## How it fits

This is the `besigner` scope of the package map: the designer's logic,
publishable without its UI. It imports the core (`@aglyn/aglyn`) and the
generic `@aglyn/shared-*` packages only. It never imports the designer UI, the
renderer or a plugin. `@aglyn/besigner-ui` is the React surface over it, and a
plugin may import it too.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/besigner/core
