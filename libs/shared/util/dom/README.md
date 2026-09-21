# @aglyn/shared-util-dom

DOM measurement helpers and type guards: bounding and clipping rects, scroll parents, offset parents, the owning window of a node (including across iframes), and event coordinates. It is mainly an internal building block of the Besigner visual editor (`@aglyn/besigner-ui`) and of `@aglyn/shared-ui-next`, and is usable on its own.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-dom@beta

No peer dependencies. `mobx` and `rxjs` are regular dependencies, used only by the page-title controller.

## What's in it

Everything below is exported from the package root.

- Rect and geometry: `getElementClientRectBounding`, `getElementClientRectBoundingInner`, `getElementRectAsClientRect`, `getElementClippingRect`, `getElementViewportRect`, `getElementDocumentElementRect`, `getElementFragmentRects`, `getElementWindowScrollBarX`.
- Tree walking: `getElementScrollParent`, `getElementListScrollParents`, `getElementOffsetParent`, `getElementParentNode`, `getElementDocumentElement`, `getElementNodeName`, `getElementComputedStyle`.
- Windows and frames: `getNodeWindow`, `getNodeWindowScroll`, `getIframeDocument`. These resolve the window that owns a node rather than assuming the global one, so they work on elements inside an iframe.
- Events: `getEventCoordinates`, `eventHasViewportCoordinates`, `isTouchEvent`, `isKeyboardEvent`.
- Guards: `isNodeObject`, `isNodeElement`, `isElementHTMLElement`, `isSVGElement`, `isNodeShadowRoot`, `isNodeTableElement`, `isNodeDocument`, `isElementWindow`, `isElementScrollParentElement`, `elementContainsChildElement`.
- Types and constants: `Rect`, `ClientRectObject`, `Coordinates`, `VirtualElement`, `Boundary`, `RootBoundary`, and the `clippingParents` / `viewport` constants.
- A page-title controller: `PageTitle` (a MobX observable class), the shared instance `$title`, the RxJS observable `$pageTitle`, and the setters `setScreenName`, `setScreenNumber`, `setScreenSuffix`, `setScreenSeparator`, `setScreenTitle`.

Each file under `src/lib` is also importable by subpath, for example `@aglyn/shared-util-dom/get-element-scroll-parent` or `@aglyn/shared-util-dom/guards/is-touch-event`. `getOwnerDocument` is available only that way, as `@aglyn/shared-util-dom/get-owner-document`.

## Usage

```ts
import {
  getElementListScrollParents,
  getEventCoordinates,
  getNodeWindow,
} from '@aglyn/shared-util-dom'

function onPointerDown(event: PointerEvent) {
  const { x, y } = getEventCoordinates(event)
  const win = getNodeWindow(event.target)
  const scrollers = getElementListScrollParents(event.target as Element)
  // ...
}
```

## Import-time effect

This package imports the root of `@aglyn/shared-util-tools`, and that root defines a set of non-enumerable `$_`-prefixed methods on `Array.prototype` when it loads. See that package's README for the exact list.

## How it fits

A `shared` package: generic, with no knowledge of Aglyn's model. Shared packages may only import other shared packages; this one depends on `@aglyn/shared-util-tools`. `@aglyn/besigner-ui` and `@aglyn/shared-ui-next` depend on it.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/dom
