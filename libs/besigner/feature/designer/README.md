# @aglyn/besigner-ui

The React UI of Besigner, Aglyn's visual editor, as it ships in the Aglyn
console: the workspace, canvas viewport, element tree, inspector forms,
toolbars, drag and drop, and working drafts. Install it if you want to mount
the Aglyn editor in your own app. If you want to build a different UI over the
same editing logic, take `@aglyn/besigner` instead.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/besigner-ui@beta

Peer dependencies, all required today:

- `react`
- `@mui/material`, `@mui/system`, `@mui/lab`
- `next`
- `firebase`

`next` and `firebase` are peers an embeddable editor should not need, and they
are still needed today. `next` is a peer because the viewport canvas and the
workspace editor load parts of themselves with `next/dynamic`. `firebase` is a
peer because the shared working-draft store (`drafts/besigner-server-draft`)
reads and writes Firestore itself. The package has been proven to install and
bundle from the registry with these peers present, together with `react-dom`
and MUI's Emotion packages, and without `firebase-admin`, any `@aglyn/tenant-*`
package or any `@aglyn/plugins-*` package.

## What's in it

The pieces named below are exported from the package root unless a subpath is
given; every file under `src/lib` is also reachable by subpath.

- Root and providers: `BesignerRootProviderComponent` and the
  `withBesignerContext` wrapper set up the editor app context, the
  drag-and-drop context, the rendered-elements registry, the components drawer
  and the clipboard shortcuts.
- Workspace and viewport: `WorkspaceEditorComponent`,
  `WorkspacePanelComponent`, `AsidePanelComponent`, `ViewportRootComponent`,
  `ViewportCanvasComponent` and `ViewportFrameComponent`. The frame renders
  the canvas with `@aglyn/aglyn-node-renderer`, swapping in the editor's own
  leaf (`NodeLeaf`) for selection and drag behavior.
- Toolbars and controls: `AppBarPrimaryComponent`, the secondary app bar and
  breadcrumbs, `HistoryControlsComponent`, `DevicePreviewControlsComponent`,
  `PanelControlsComponent`, and the scheme preview, zoom, interact and add
  controls.
- Element tree and canvas chrome: `NodeTreeView`, `NodeOverlay`,
  `NodeOutline`, `NodeContextMenu`, node quick actions and node cards.
- Inspector: `ElementPropsForm` for a component's attributes, the element
  styles form, the properties dialog, property value forms, and token fields
  (`token-text-field`, `token-pill`). The box styler (`BoxStyler`) is at the
  subpath `@aglyn/besigner-ui/box-styler/index`.
- Documents and drafts: `useBesignerDocument` loads and saves the document
  being edited through a source the caller supplies; `useBesignerDraft`,
  the browser draft store (`readBesignerDraft`, `writeBesignerDraft`,
  `clearBesignerDraft`) and the Firestore draft store (`readServerDraft`,
  `writeServerDraft`, `clearServerDraft`) keep work in progress.
  `BesignerDraftAlertComponent` and `BesignerConflictAlertComponent` surface
  them.
- Hooks: `useAglynBesignerFlag`, `useAglynBesignerPanel`,
  `useBesignerAppContext`, `useLeafDrag`, `useLeafDrop`,
  `useDeleteElementCallback` and others.
- Host seams, as React contexts the embedding app fills:
  `MediaPickerContext`, `BindingPickerContext`,
  `BesignerInspectorExtrasContext`, `BesignerToolbarExtrasContext`, and the
  component promotion, interactions and layout chrome contexts.

## Usage

The editor is composed from these pieces rather than mounted as one component.
Import from the root:

```tsx
import {
  NodeTreeView,
  ViewportCanvasComponent,
  ViewportRootComponent,
  WorkspaceEditorComponent,
  useBesignerDocument,
  withBesignerContext,
} from '@aglyn/besigner-ui'
```

The reference composition is the console's screen editor page in the
monorepo, under
`apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx`.
It wraps the page with `withBesignerContext`, loads the document with
`useBesignerDocument`, and lays out the workspace, viewport and panels. The
components the canvas can render come from plugins registered with the core,
such as `@aglyn/plugins-mui`.

## How it fits

This is the `besigner-ui` scope of the package map, the top of the designer
stack: it imports `@aglyn/besigner` (the logic), `@aglyn/aglyn-node-renderer`,
`@aglyn/aglyn-markdown-editor`, the core `@aglyn/aglyn`, and the generic
`@aglyn/shared-*` packages. It imports no plugin, and a plugin never imports
the designer UI.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/besigner/feature/designer
