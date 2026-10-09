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
import { createElement, lazy, Suspense } from 'react'
import type { PluginDocsSectionExcerptProps } from './docs-help-section-excerpt-text'

const PluginDocsSectionExcerptText = lazy(
  () => import('./docs-help-section-excerpt-text'),
)

/**
 * A plugin card's section prose, fetched when its tooltip first opens
 * (AGL-3707) — the plugin counterpart of the console's `DocsHelpExcerpt`.
 *
 * The plugin help subset is imported by every plugin console up front, and
 * the linked sections' prose is ~30 KB gzipped that nothing reads until
 * someone hovers a `?`. A tooltip's content mounts only when it opens, so the
 * chunk loads then; the page's own description stands in for the moment it
 * takes.
 */
// Written with createElement, not JSX: docs-help.ts imports this module and
// server.ts re-exports docs-help, so plain-TS loaders (jiti in the ops scripts,
// ts-jest under `jsx: preserve`) must be able to parse it.
export function PluginDocsSectionExcerpt(props: PluginDocsSectionExcerptProps) {
  return createElement(
    Suspense,
    { fallback: props.fallback },
    createElement(PluginDocsSectionExcerptText, props),
  )
}

export default PluginDocsSectionExcerpt
