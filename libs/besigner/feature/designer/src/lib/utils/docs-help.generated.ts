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
  elementCatalog: '/building-sites/besigner/element-catalog',
  interactions: '/building-sites/besigner/interactions-and-custom-html',
  layouts: '/building-sites/screens-and-layouts/layouts',
  responsiveStyling: '/building-sites/besigner/responsive-styling',
  reusableComponents: '/building-sites/besigner/reusable-components',
  seo: '/building-sites/seo/overview',
  textEditing: '/building-sites/besigner/text-editing',
} as const satisfies Record<string, string>

export type BesignerDocsKey = keyof typeof BESIGNER_DOCS

export const BESIGNER_DOCS_ANCHORS = {
  besigner: ['#preview-vs-canvas', '#what-you-can-do', '#the-canvas', '#hierarchy-panel', '#the-inspector', '#inline-and-rich-text', '#reusable-components', '#editing-together', '#ai-in-the-canvas', '#related'],
  bindings: ['#binding-tokens', '#rename-safe-id-tokens', '#insert-a-variable', '#token-pills', '#in-the-canvas-text-editor', '#typed-variables', '#no-code-functions', '#where-used--safety', '#workflows', '#related'],
  dragDropHierarchy: ['#where-you-can-drag', '#what-a-drag-does', '#drop-zones-edges-vs-center', '#containers-vs-leaf-elements', '#containers-accept-children', '#leaf-elements-dont--dropping-on-one-makes-a-sibling', '#adding-a-new-element', '#when-a-drop-is-rejected', '#moving-an-element-without-dragging', '#multi-drag', '#tips', '#related'],
  elementCatalog: ['#finding-an-element', '#element-search', '#element-detail', '#layout', '#the-pages-main-landmark', '#header-and-footer-for-your-site-chrome', '#grid', '#surface', '#accordion', '#navigation', '#where-a-link-opens', '#tabs', '#tabs-that-go-to-another-screen', '#pagination', '#text', '#data-display', '#media', '#image-list', '#forms-input-commerce-members', '#related'],
  interactions: ['#fluent-interactions', '#interactions-belong-to-the-page-they-are-on', '#plan-availability', '#pick-the-target-by-clicking', '#interaction-cookbook', '#analytics-event-step', '#analytics-event-name', '#analytics-event-parameters', '#analytics-event-delivery', '#custom-html-block', '#related'],
  layouts: ['#what-a-layout-is', '#nested-layouts', '#used-by', '#layouts-vs-reusable-components', '#related'],
  responsiveStyling: ['#style-per-breakpoint', '#mute-a-style', '#interaction-states', '#you-can-see-the-state-while-you-style-it', '#fields-you-dont-touch-keep-inheriting', '#states-and-breakpoints-combine', '#focus-state', '#box-stylers', '#spacing-side-names', '#spacing-units', '#spacing-steps', '#spacing-custom-amounts', '#unit-px', '#unit-rem', '#unit-em', '#unit-percent', '#unit-ch', '#unit-viewport', '#unit-small-viewport', '#style-groups', '#borders-without-css', '#picking-a-font', '#gradient-backgrounds', '#visibility-per-device-band', '#scheme-scoped-colors', '#custom-classes', '#custom-css-sx', '#semantic-sections--theme-mode', '#edit-json-for-one-element'],
  reusableComponents: ['#promote', '#insert-instances', '#properties', '#declare-them', '#use-them', '#save-then-publish', '#fill-them-in-per-page', '#restyle-one-instance', '#override-an-attribute-on-one-instance', '#retrofit-duplicated-sections', '#detach', '#nesting', '#used-by', '#manage', '#copy--paste-vs-reusable-components', '#tips', '#related'],
  seo: ['#per-screen-seo', '#how-a-page-title-is-built', '#site-wide-defaults', '#search-engine-visibility', '#the-whole-site', '#a-single-page', '#sitemap--robots', '#one-index-one-file-per-section', '#social-cards', '#structured-data', '#analytics-integration', '#related'],
  textEditing: ['#edit-inline', '#committing', '#inline-toolbar', '#rich-text', '#the-text-attribute', '#text-field-read-only', '#remove-formatting', '#line-breaks', '#bindings-in-text', '#limits', '#wrapped-outlines', '#related'],
} as const satisfies Partial<Record<BesignerDocsKey, readonly `#${string}`[]>>

type BesignerAnchorMap = typeof BESIGNER_DOCS_ANCHORS

/** Valid heading anchors for a besigner docs page (`never` when none). */
export type BesignerDocsAnchor<K extends BesignerDocsKey> =
  K extends keyof BesignerAnchorMap ? BesignerAnchorMap[K][number] : never
