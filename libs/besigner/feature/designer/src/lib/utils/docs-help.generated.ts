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
  besigner: '/building-sites/besigner/overview',
  bindings: '/building-sites/bindings/overview',
  dragDropHierarchy: '/building-sites/besigner/drag-drop-hierarchy',
  interactions: '/building-sites/besigner/interactions-and-custom-html',
  responsiveStyling: '/building-sites/besigner/responsive-styling',
  reusableComponents: '/building-sites/besigner/reusable-components',
  screens: '/building-sites/screens-and-layouts/overview',
  seo: '/building-sites/seo/overview',
  textEditing: '/building-sites/besigner/text-editing',
} as const satisfies Record<string, string>

export type BesignerDocsKey = keyof typeof BESIGNER_DOCS

export const BESIGNER_DOCS_ANCHORS = {
  besigner: ['#what-you-can-do', '#the-canvas', '#hierarchy-panel', '#inline-and-rich-text', '#reusable-components', '#ai-in-the-canvas', '#related'],
  bindings: ['#binding-tokens', '#rename-safe-id-tokens', '#insert-a-variable', '#token-pills', '#in-the-canvas-text-editor', '#typed-variables', '#no-code-functions', '#where-used--safety', '#workflows', '#related'],
  dragDropHierarchy: ['#where-you-can-drag', '#what-a-drag-does', '#drop-zones-edges-vs-center', '#containers-vs-leaf-elements', '#containers-accept-children', '#leaf-elements-dont--dropping-on-one-makes-a-sibling', '#adding-a-new-element', '#when-a-drop-is-rejected', '#multi-drag', '#tips', '#related'],
  interactions: ['#fluent-interactions', '#plan-availability', '#pick-the-target-by-clicking', '#interaction-cookbook', '#custom-html-block', '#related'],
  responsiveStyling: ['#style-per-breakpoint', '#box-stylers', '#style-groups', '#visibility-per-device-band', '#scheme-scoped-colors', '#custom-classes', '#custom-css-sx', '#semantic-sections--theme-mode', '#edit-json-for-one-element'],
  reusableComponents: ['#promote', '#insert-instances', '#manage', '#used-by', '#tips', '#related'],
  screens: ['#screens--routing', '#layouts', '#nested-layouts', '#used-by', '#reusable-components', '#versions--scheduled-publishing', '#error--maintenance-screens', '#related'],
  seo: ['#per-screen-seo', '#sitemap--robots', '#social-cards', '#structured-data', '#analytics-integration', '#related'],
  textEditing: ['#edit-inline', '#rich-text', '#the-text-attribute', '#bindings-in-text', '#related'],
} as const satisfies Partial<Record<BesignerDocsKey, readonly `#${string}`[]>>

type BesignerAnchorMap = typeof BESIGNER_DOCS_ANCHORS

/** Valid heading anchors for a besigner docs page (`never` when none). */
export type BesignerDocsAnchor<K extends BesignerDocsKey> =
  K extends keyof BesignerAnchorMap ? BesignerAnchorMap[K][number] : never
