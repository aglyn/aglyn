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

/**
 * The one `import()` both collection search boxes arrive through (AGL-4220).
 *
 * Two elements draw the collection search box: the standalone Collection
 * Search block, and the Entries block once its `search` is on. Each used to
 * be its own `import()` — the block's in `element-tier.ts`, the variant's in
 * `collection-entries.tsx` — and so its own chunk group, and a page placing
 * both downloaded the box twice: MUI's Chip, InputBase and TextareaAutosize
 * and the box itself, 24 KB of module code, once per group.
 *
 * Both now reach `collection-entries-search.tsx`, which carries both
 * elements, through the `import()` written HERE. `element-tier.ts` imports
 * this module statically, so it sits in the tier's own chunk and the import
 * below is ONE chunk group, whose parent is the tier whichever element asks:
 * the box is fetched once, and whichever element arrives second costs no
 * request at all. Each element carries the other's few lines (about 2 KB).
 *
 * The marker lives here, not in `collection-entries.tsx`, so the searching
 * variant can stamp it without importing the plain block it replaces: that
 * import would put a second copy of the entries block and its presets in the
 * search chunk, whose parent is the tier, not the entries block.
 */

/**
 * What a searching entries block stamps on its root. The browser looks for it
 * before the page hydrates (`prepareEntriesSearch`); nothing styles or
 * targets it.
 */
export const ENTRIES_SEARCH_ATTRIBUTE = 'data-aglyn-entries-search'

type SearchModule = typeof import('./collection-entries-search')

// One import shared by every caller, as `formControls` in `element-tier.ts`:
// a loader that hands a second caller a module still being evaluated (jiti,
// in the AI palette and axe guards) would give it empty exports. A failed
// load is forgotten so the next placement retries.
let searchLoad: Promise<SearchModule> | undefined

/** Both search elements' module, fetched once per visit. */
export const loadCollectionSearch = (): Promise<SearchModule> =>
  (searchLoad ??= import('./collection-entries-search').catch(
    (error: unknown) => {
      searchLoad = undefined
      throw error
    },
  ))
