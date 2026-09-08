/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export * from './lib/change-case'
// deep-equal is NOT re-exported (AGL-2682), the same removal as
// `platform-identification` below and by far the most expensive of the three.
// `deep-equal` is an es-shim package: it reaches `object-inspect`,
// `get-intrinsic`, `object-keys`, `es-get-iterator` and 47 more, and every
// one of them rode this line onto every published customer page. Measured on
// `aglyn.com/solutions/small-business` from the production source maps:
// **51 packages, 47.6 KB raw**, in a chunk no visitor executes.
//
// It also explains a Lighthouse finding that looked like ours and was not.
// The "Legacy JavaScript — `Object.assign` / `Object.is` / `Object.keys`
// shims" charged against `42sr79qh0v5oi.js` is `object.assign`, `object-is`
// and `object-keys` — members of THIS tree, not polyfills Next emitted for a
// stale browserslist, and no browserslist setting would have moved them.
//
// The one consumer is `apps/console/components/theme-editor`, which is
// console-only and now takes the deep import. Still importable as
// `@aglyn/shared-util-vendor/deep-equal`.
// fuse is NOT re-exported (AGL-2486), for the reason recorded below for
// `platform-identification` and measured the same way. `export *` here put
// `fuse.js` in front of every file that takes anything at all from this
// index — ten of them in the published page's eager graph, mostly for
// `hoistNonReactStatics` — so a matcher no visitor runs was downloaded and
// parsed by every visitor to every customer site.
//
// All four real consumers are off the published page's CLIENT path, which is
// what makes the removal safe rather than merely tidy:
//   - `use-mdi-icons-fuzzy` → the icon picker, console-only,
//   - `media-search.ts` → the console DAM,
//   - `plugins-mui/collection.tsx` → tenant, but behind the LAZY
//     `import('@aglyn/plugins-mui')` in `plugins.client.generated.ts`, so it
//     arrives only on a page that actually mounts a collection,
//   - `apps/tenant/utils/search-content.ts` → tenant, but SERVER-only: it
//     imports `@aglyn/aglyn/server` and `tenant-data-admin`, and
//     `search-facets.ts` exists precisely so the `'use client'` results page
//     never value-imports it. Fuse runs on the server for `/search` and has
//     never been shipped to that page's browser.
//
// Worth stating plainly, because it is the trap this change was nearly lost
// to: dropping the `use-mdi-icons-fuzzy` re-export from the shared-ui-jsx
// barrel — the obvious fix, and the one the audit named — removes ZERO
// packages on its own. Measured: 30 packages before, 30 after, with `fuse.js`
// still "first reached from libs/shared/util/vendor/src/lib/fuse.ts". THIS
// line was the live edge the whole time. Still importable as
// `@aglyn/shared-util-vendor/fuse`.
export * from './lib/hoist-non-react-statics'
// mitt is NOT re-exported (AGL-2682), same treatment as `platform-identification`
// below and for the same reason: NOTHING in the repo reads `Mitt` — not an app,
// not a plugin, not a tool — so the only thing this line did was put `mitt` in
// front of every file that takes anything at all from this index. Aglyn's own
// event bus is `EmitManager` (eventemitter2), which is what the runtime
// actually uses. Still importable as `@aglyn/shared-util-vendor/mitt-emitter`.
export * from './lib/object-deep-merge'
// object-deep-fill-in is NOT re-exported (AGL-2682). It was a second package
// (`mout`) inside `object-deep-merge`, whose OTHER export the host theme calls
// on every published page — so `mout` was emitted to every visitor of every
// customer site for a function nothing calls. Split out rather than deleted,
// and importable as `@aglyn/shared-util-vendor/object-deep-fill-in`.
// object-flatten is NOT re-exported (AGL-2682). Its one consumer,
// `element-styles-form.component.tsx`, is the besigner's styles panel —
// console-only — and it now takes the subpath. `flat` was never emitted to a
// published page (Turbopack shakes it), so this is graph hygiene rather than
// bytes: it keeps the allowlist honest about what a tenant page can reach, so
// the NEXT import of anything from this index cannot quietly ship a flattener.
// Still importable as `@aglyn/shared-util-vendor/object-flatten`.
// platform-identification is NOT re-exported (AGL-2486). Nothing in the repo
// imports it — not the apps, not a plugin, not a tool — so its only effect
// was that every file taking anything at all from this index (and there are
// ten in the published page's eager graph alone, mostly for
// `hoistNonReactStatics`) also pulled in the `platform` UA-parsing package.
// Measured at -4.7 KB gz off the eager barrel graph. Still importable as
// `@aglyn/shared-util-vendor/platform-identification`.
// uid-alphabets is NOT re-exported (AGL-2682), the same shape as
// `object-deep-fill-in`: `nanoid-dictionary` was a second package inside
// `unique-identification`, whose `createUid` the loading context and
// `createResourceUid` do call on every published page. Split out rather than
// deleted, and importable as `@aglyn/shared-util-vendor/uid-alphabets`.
export * from './lib/unique-identification'
// use-debounce is NOT re-exported (AGL-2682), same shape as `object-flatten`
// above. Its one consumer is `icon-select.component.tsx` — the icon picker,
// console-only — which now takes the subpath. Note that a page-side debounce
// already exists and is unrelated: `@aglyn/shared-ui-jsx`'s own `useDebounce`
// is built on lodash-es, which the tenant page carries anyway. Still importable
// as `@aglyn/shared-util-vendor/use-debounce`.
