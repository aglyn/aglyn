# @aglyn/shared-ui-jsx

Aglyn's general-purpose React and Material UI component library: layout and card primitives, links, menus, an icon component for Material Design Icon paths, shadow-DOM hosts, an error boundary, loading and confirmation contexts, and a set of hooks. The renderer, Besigner, the tenant runtime and every feature plugin build their UI on it. Nothing in it knows about Aglyn's data model, so it can be used in any React and MUI app.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-ui-jsx@beta

Peer dependencies: `react`, `react-dom`, `next`, `@mui/material`, `@mui/system`, `@mui/utils`, `@mui/base`, `@mui/styles` and `@mui/x-data-grid`. `next` is needed by the link and router-event modules, and `@mui/x-data-grid` by the data table.

## What's in it

**The root entry is deliberately small.** A published Aglyn site imports this barrel, so it re-exports only what a rendered page or the designer needs by name. Everything else is imported by subpath, which keeps heavy components out of bundles that do not use them. The package declares `"sideEffects": false`.

From `@aglyn/shared-ui-jsx`:

- Components: `AppLink` (a Next.js link rendered as a MUI link, button, icon button or fab, chosen by `variant`), `CardDisplay`, `CardListItem`, `Container`, `GridItems`, `Menu`, `HelpTip`, `AglynText`, `SrOnly`.
- Icons: `MdiIcon` renders an SVG path inside a MUI `SvgIcon`. `MdiIconFromId` takes an `iconId` that is an `@mdi/js` export name and loads the path on demand, as `useMdiIcon` and `useMdiIcons` do. The root also re-exports all of `@aglyn/shared-data-mdi`, and the Aglyn and Besigner logo components.
- Isolation and errors: `ShadowDom` and `MuiShadowDom` (render children inside a shadow root, the latter with MUI styles scoped into it), `ErrorBoundaryComponent` and `withErrorBoundary`.
- Contexts: `LoadingProviderComponent` / `useLoading`, and `ConfirmationContext` / `useConfirmationContext`.
- Hooks: `useAsyncEffect`, `useSubscribable` (subscribe to an RxJS-style observable), `useMergeRefs` / `mergeRefs`, `useCallbackParamRef`, `useId`, `useIsomorphicLayoutEffect`, and the `useOnRouteChangeStart` family of router-event hooks.
- Helpers: `createHocWithContextConsumer`, `withHocFactoryBuilder`, `makeLinkElements`, `makeMetaElements`.

By subpath, `@aglyn/shared-ui-jsx/components/<file>`, for example:

- `data-table.component` — `DataTableComponent`, over MUI X Data Grid
- `grid-list` — `GridList`, a virtualized grid
- `empty-state.component` — `EmptyStateComponent`
- `list-pagination.component` — `ListPagination`
- `dialog-confirm` — `DialogConfirm`; `confirmation-provider.component` — `ConfirmationProviderComponent`
- `navigation-drawer.component`, `splash-screen`, `loading-modal`, `sandbox-frame`, `usage-meter.component`

## Usage

```tsx
import { CardDisplay, MdiIcon, mdiAbacus } from '@aglyn/shared-ui-jsx'

export function Example() {
  return (
    <CardDisplay header="Totals" subheader="This month">
      <MdiIcon path={mdiAbacus.path} fontSize="large" />
    </CardDisplay>
  )
}
```

A component that is not in the root barrel:

```tsx
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
```

Components expect a MUI theme above them. `@aglyn/shared-ui-theme` provides the themes Aglyn uses, including the palette additions some of these components reference.

## How it fits

A `shared` UI package. It depends on `@aglyn/shared-ui-theme`, `@aglyn/shared-data-mdi`, `@aglyn/shared-util-tools` and `@aglyn/shared-util-vendor`. `@aglyn/shared-ui-jsx-forms`, `@aglyn/shared-ui-next`, `@aglyn/shared-ui-json-editor`, the node renderer, Besigner, the tenant runtime and the feature plugins depend on it. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/jsx
