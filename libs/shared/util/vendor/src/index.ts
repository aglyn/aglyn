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
export * from './lib/deep-equal'
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
export * from './lib/mitt-emitter'
export * from './lib/object-deep-merge'
export * from './lib/object-flatten'
// platform-identification is NOT re-exported (AGL-2486). Nothing in the repo
// imports it — not the apps, not a plugin, not a tool — so its only effect
// was that every file taking anything at all from this index (and there are
// ten in the published page's eager graph alone, mostly for
// `hoistNonReactStatics`) also pulled in the `platform` UA-parsing package.
// Measured at -4.7 KB gz off the eager barrel graph. Still importable as
// `@aglyn/shared-util-vendor/platform-identification`.
export * from './lib/unique-identification'
export * from './lib/use-debounce'
