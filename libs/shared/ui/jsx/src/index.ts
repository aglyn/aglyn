/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// ── Barrel discipline (AGL-1290, extending AGL-1151) ────────────────────────
// The tenant runtime reaches this barrel statically (the node renderer
// imports ShadowDom/ErrorBoundary through it), and Turbopack cannot prove a
// module with top-level `styled()`/`forwardRef()` calls side-effect-free —
// so EVERY component re-exported here ships eagerly on EVERY published
// customer page, used or not. Measured: RulerGuides, SplashScreen,
// NavigationDrawer, DialogConfirm and the whole MUI Dialog/Drawer/Popper
// stack were in /pricing's first-load chunks, imported by nothing.
//
// Rule: a component joins this barrel only if the tenant page graph or the
// besigner needs it by name. Console-/www-only components are imported by
// subpath instead: '@aglyn/shared-ui-jsx/components/<file>' (the tsconfig
// wildcard path already resolves it — same pattern as DataTable/GridList
// below). Pure modules (hooks, types, const data) are exempt: the bundler
// proves them pure and drops the unused ones.
export * from './lib/components/app-link'
// aspect-ratio, background-image, children-function-prop, dialog-confirm +
// confirmation-provider, ellipsis-pulse, grid-buttons, loading-layout,
// loading-modal, loading-text, navigation-view, next-link, popper-styled,
// resizeable-stack, ruler-guides, sandbox-frame, scroll-reaction,
// splash-screen, emotion-cache-provider and const/prebuilt-components are
// NOT in the barrel (AGL-1290) — subpath-import them (see rule above).
// navigation-drawer is the one deliberate exception, below.
export * from './lib/components/card-display'
export * from './lib/components/card-list-item'
// NOT in the barrel (AGL-1151). `DataTable` wraps MUI X DataGrid, which with
// its virtualizer is ~257 KB of the bundle — and exporting it here put all of
// that behind every `@aglyn/shared-ui-jsx` import, including the tenant
// runtime. Every visitor to every published site downloaded a data grid to
// render a page that has never contained one; nothing in the tenant or the
// node renderer references DataTable at all.
//
// Measured both ways: removing this line drops MuiDataGrid from the tenant
// bundle entirely (13741 KB → 13484 KB built output).
//
// Import it from '@aglyn/shared-ui-jsx/components/data-table.component' — the
// subpath already resolves. Kept out of the barrel rather than lazy-loaded
// because `GridOverlay` is used at module scope inside `styled()`, so the
// module cannot be deferred without splitting the component.
export * from './lib/components/container'
export * from './lib/components/error-boundary.component'
export * from './lib/components/grid-items'
// `grid-list` is deliberately NOT re-exported (AGL-1151). It is the only
// consumer of `react-virtuoso`, and the tenant runtime imports this barrel —
// so exporting it here put a virtualizer into every published customer page to
// render a list those pages never contain. Exactly what `DataTable` did with
// MUI X DataGrid in 828c43939. Import it from
// `@aglyn/shared-ui-jsx/components/grid-list` instead.
export * from './lib/components/help-tip.component'
export * from './lib/components/menu'
export * from './lib/components/mui-shadow-dom'
// navigation-drawer is NOT re-exported (AGL-1290): it kept the MUI Drawer
// stack in the tenant's first-load chunk. Import it from
// `@aglyn/shared-ui-jsx/components/navigation-drawer.component`.
export * from './lib/components/shadow-dom'
export * from './lib/components/sr-only'
export * from './lib/components/zoomable-panning-component'

export * from './lib/contexts/confirmation.context'
export * from './lib/contexts/loading.context'

export * from './lib/hooks/router-events'
export * from './lib/hooks/use-callback-param-ref'
export * from './lib/hooks/use-async-effect'
export * from './lib/hooks/use-client-rect'
export * from './lib/hooks/use-debounce'
export * from './lib/hooks/use-debounced-transition'
export * from './lib/hooks/use-effect-post-mount'
export * from './lib/hooks/use-element-position'
export * from './lib/hooks/use-id'
export * from './lib/hooks/use-observer-intersection'
export * from './lib/hooks/use-interval'
export * from './lib/hooks/use-isomorphic-layout-effect'
export * from './lib/hooks/use-local-storage-item-state'
export * from './lib/hooks/use-merge-refs'
export * from './lib/hooks/use-mouse-enter'
export * from './lib/hooks/use-mouse-over'
export * from './lib/hooks/use-mouse-position'
export * from './lib/hooks/use-observer-mutation'
export * from './lib/hooks/use-node-property'
export * from './lib/hooks/use-on-mouse-enter'
export * from './lib/hooks/use-on-mouse-over'
export * from './lib/hooks/use-observer-resize'
export * from './lib/hooks/use-subscribable'
export * from './lib/hooks/use-tag-name'
export * from './lib/hooks/use-timeout'
export * from './lib/hooks/use-timeout-delay'

// prebuilt-components is a module-scope `<LoadingModal open />` — rendering
// at import time is exactly the impurity the rule above exists for.
export * from './lib/const/svg-icons'

export * from './lib/hocs/create-hoc-with-context-consumer'
export * from './lib/hocs/with-hoc'

export * from './lib/utils/make-link-elements'
export * from './lib/utils/make-meta-elements'
export * from './lib/utils/vendor'

export * from './lib/types'

export * from './lib/hooks/mdi-icon/use-mdi-icon'
export * from './lib/hooks/mdi-icon/use-mdi-icons'
export * from './lib/hooks/mdi-icon/use-mdi-icons-fuzzy'

export * from './lib/components/mdi-icon/mdi-icon'
export * from './lib/components/mdi-icon/mdi-icon-from-id'

export * from '@aglyn/shared-data-mdi'

// import dynamic from 'next/dynamic'
// export const MdiIconFromId = dynamic(
//   () => import('./components/mdi-svg-icon'),
//   {loading: () => (<span />)},
// )
// MdiIconFromId.displayName = 'MdiIconFromId'
// MdiIconFromId.aglyn = true
