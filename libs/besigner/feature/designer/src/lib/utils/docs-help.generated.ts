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
// GENERATED FILE — do not edit. Regenerate with:
//   node tools/scripts/generate-docs-help.mjs
// Source of truth: apps/docs/docs frontmatter + headings (AGL-602).

// The besigner designer lib can't import the console constants, so it carries
// its own generated subset of the docs help registry.

export const BESIGNER_DOCS = {
  responsiveStyling: '/building-sites/besigner/responsive-styling',
} as const satisfies Record<string, string>

export type BesignerDocsKey = keyof typeof BESIGNER_DOCS

export const BESIGNER_DOCS_ANCHORS = {
  responsiveStyling: ['#style-per-breakpoint', '#box-stylers', '#style-groups', '#gradient-backgrounds', '#visibility-per-device-band', '#scheme-scoped-colors', '#custom-classes', '#custom-css-sx', '#semantic-sections--theme-mode', '#edit-json-for-one-element'],
} as const satisfies Partial<Record<BesignerDocsKey, readonly `#${string}`[]>>

type BesignerAnchorMap = typeof BESIGNER_DOCS_ANCHORS

/** Valid heading anchors for a besigner docs page (`never` when none). */
export type BesignerDocsAnchor<K extends BesignerDocsKey> =
  K extends keyof BesignerAnchorMap ? BesignerAnchorMap[K][number] : never
