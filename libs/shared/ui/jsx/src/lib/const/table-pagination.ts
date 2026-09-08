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
 * ONE table footer, everywhere a list is paged (AGL-2501).
 *
 * Left to themselves the lists disagree: layouts paged 5 at a time, components
 * and templates 10, the team list and the screens tree 25, with labels ranging
 * from `Rows per page` to `Top-level screens per page`. Some footers are MUI X
 * `DataGrid` and some a hand-rolled `TablePagination`, so without one source
 * the same control offers a different menu depending on which list a reader is
 * standing in.
 *
 * The options are the same everywhere BECAUSE they are arbitrary: nothing
 * about layouts makes 5 the right first page and 10 wrong. What is not
 * arbitrary is that a reader learns the control once.
 *
 * ## Why these live in the shared library rather than the console
 *
 * The console is not the only surface with lists. Plugin console cards —
 * commerce, contacts, marketing — render their own, and an app cannot be
 * imported from a library, so a constant that lived in `apps/console` was one
 * every plugin had to re-invent. A pure module is exempt from the barrel's
 * weight rule, so this costs published tenant pages nothing.
 */
/**
 * Row height for every console list, in pixels.
 *
 * One number rather than a per-list choice: MUI X's `DataGrid` and a plain MUI
 * `size="small"` table default to different heights, so a console that let
 * each list pick showed two table designs. `ListRowActions` centres its
 * cluster against this height.
 *
 * Here rather than beside the component for the reason the docblock above
 * gives: a pure module costs a published page nothing, while importing the
 * table itself to read a number drags the whole grid in behind it.
 */
export const TABLE_ROW_HEIGHT = 48

/**
 * The room a list reserves for its empty state, in pixels.
 *
 * MUI X sizes the no-rows overlay from `--DataGrid-overlayHeight` and falls
 * back to two rows when nothing sets it. The console's empty state is taller
 * than that on every list: a 120px illustration, a label, a create button and
 * the paddings around them come to about 230px before a single line of
 * description is counted. The overlay is centered in its slot and
 * `.MuiDataGrid-main` clips what leaves it, so an empty state larger than the
 * slot is not merely cramped — half of it is drawn over the column headers and
 * the rest is cut off mid-sentence.
 *
 * 360 is that composition plus about six wrapped lines of description at
 * body-2's 20px line box; the longest ones in the console today wrap to three
 * or four against the 420px the description is capped at. The slack is the
 * point. Reserving too much leaves an empty list looking airy, which is a
 * paragraph of whitespace; reserving too little does not leave a gap, it puts
 * the illustration back on the headers, and it does so on whichever list
 * someone has just given a longer sentence.
 *
 * One number for every list, so that an empty list is the same height
 * whichever one a reader is standing in, and so that no single call site's
 * copy can make the reserve wrong. The loading overlay is sized from the same
 * variable, so a list that comes back empty does not change height when the
 * read lands.
 */
export const TABLE_EMPTY_STATE_HEIGHT = 360

export const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50]

/**
 * The default page size: THE SMALLEST OPTION, always.
 *
 * Every paginated list starts at the minimum count. Derived from the options
 * rather than written as a number, so the rule survives the options changing —
 * a hardcoded default is how five different ones appear.
 *
 * It is also the cheaper default, and not only in pixels. A list whose
 * listener is bounded by its page size reads exactly this many DOCUMENTS on
 * load, so the smallest page is the smallest bill (AGL-703). A reader who
 * wants more says so once, and only then pays for it.
 *
 * ⚠️ The screens tree pages TOP-LEVEL screens and drag-to-reorder cannot cross
 * a page boundary — dnd-kit only knows about mounted rows. A smaller default
 * makes that limit reachable on a smaller site; see the pagination block in
 * `screens-hierarchy-table.component.tsx`.
 */
export const TABLE_PAGE_SIZE_DEFAULT = TABLE_PAGE_SIZE_OPTIONS[0]

/**
 * The label beside the size menu, on every list.
 *
 * Deliberately the generic noun even on the screens tree, which pages
 * TOP-LEVEL screens and carries each one's subtree along with it: that
 * distinction belongs in the count — see `labelDisplayedRows` there — and a
 * different label in the same slot reads as a different control.
 */
export const TABLE_ROWS_PER_PAGE_LABEL = 'Rows per page:'
