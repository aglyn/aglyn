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
import * as appBar from './components/app-bar'
import * as toolbar from './components/toolbar'
import * as layoutSlot from './components/layout-slot'
import * as documentRoot from './components/document-root'
import * as section from './components/section'
import * as container from './components/container'
import * as box from './components/box'
import * as stack from './components/stack'
import * as grid from './components/grid'
import * as paper from './components/paper'
import * as typography from './components/typography'
import * as inlineText from './components/inline-text'
import * as button from './components/button'
import * as screenLink from './components/screen-link'
import * as linkBox from './components/link-box'
import * as image from './components/image'
import * as icon from './components/icon'

/**
 * The element tier: how a page's mui elements reach it (AGL-3401).
 *
 * `plugin.ts` imports this module lazily, and every element module is reached
 * through it — the common ones as part of it, the rest by an `import()` written
 * HERE. Where that `import()` is written is the whole point.
 *
 * ## Why not sixty sibling imports
 *
 * Each `import()` is a chunk group, and Turbopack gives each group every
 * module it needs that its PARENT group has not already loaded. Sixty element
 * imports written side by side in `plugin.ts` were sixty siblings: none of
 * them could count on another having loaded `@mui/material/Button`, so the
 * chunker merged a copy of Button, ButtonBase and its ripple, SvgIcon, Paper,
 * Stack, the link helpers and the field presets into group after group. On a
 * production aglyn.com build 30% of the module code a page downloaded was a
 * second-or-later copy (Button eight times, SvgIcon fifteen).
 *
 * No chunking switch fixes that without trading it for requests: turning the
 * merge off removed the copies and cost a page 280 files, which compress
 * worse than the bytes they saved (measured in AGL-3401).
 *
 * ## What this module does instead
 *
 * `CORE_ELEMENTS` are the elements nearly every page places — its frame, its
 * layout, its text, its links, buttons and images. They load together as one
 * chunk, and so do the MUI modules they share. Every other element's
 * `import()` is written below, which makes its group a CHILD of this one:
 * whatever this chunk carries is available to it, so none of it is copied.
 *
 * The price is on either side of that line. A page that places none of the
 * core elements but the frame still downloads them (a six-element page paid
 * 3.7 KB more), and an element outside the core arrives one request later,
 * after this chunk. Moving an element into the core is right when most pages
 * place it; `check:tenant-wire-weight`'s duplication measure is what says
 * whether the copies are coming back.
 *
 * Each core element is held as a module namespace, because the registry reads
 * a component, its schema and its presets off it by export name.
 */

export const CORE_ELEMENTS = {
  appBar,
  toolbar,
  layoutSlot,
  documentRoot,
  section,
  container,
  box,
  stack,
  grid,
  paper,
  typography,
  inlineText,
  button,
  screenLink,
  linkBox,
  image,
  icon,
}

/** The elements a page places less often, each loaded when it is placed. */
export const list = () => import('./components/list')
export const listItem = () => import('./components/list-item')
export const listItemText = () => import('./components/list-item-text')
export const blocks = () => import('./components/blocks')
export const dataTable = () => import('./components/data-table')
// The collection family is one module per element (AGL-3401): a page placing
// an entries list does not download the entry body's markdown renderer, the
// author cards' platform marks or the search box.
export const collectionEntries = () => import('./components/collection-entries')
export const collectionEntryBody = () =>
  import('./components/collection-entry-body')
export const collectionRelated = () => import('./components/collection-related')
export const collectionShare = () => import('./components/collection-share')
export const collectionEntryMeta = () =>
  import('./components/collection-entry-meta')
export const collectionEntryAuthor = () =>
  import('./components/collection-entry-author')
export const collectionAuthorProfile = () =>
  import('./components/collection-author-profile')
export const collectionCategories = () =>
  import('./components/collection-categories')
export const collectionSearch = () => import('./components/collection-search')
export const video = () => import('./components/video')
export const languageSwitcher = () => import('./components/language-switcher')
export const reusableInstance = () => import('./components/reusable-instance')
export const navMenu = () => import('./components/nav-menu')
export const drawer = () => import('./components/drawer')
export const product = () => import('./components/product')
export const plugin = () => import('./components/plugin')
export const customHtml = () => import('./components/custom-html')
export const searchBox = () => import('./components/search-box')
export const markdown = () => import('./components/markdown')
export const card = () => import('./components/card')
export const accordion = () => import('./components/accordion')
export const tabs = () => import('./components/tabs')
export const imageList = () => import('./components/image-list')
export const pagination = () => import('./components/pagination')
export const breadcrumbs = () => import('./components/breadcrumbs')
export const themeModeSwitcher = () =>
  import('./components/theme-mode-switcher')
