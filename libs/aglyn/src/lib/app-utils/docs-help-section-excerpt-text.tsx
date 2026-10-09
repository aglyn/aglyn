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
import { PLUGIN_DOCS_SECTION_EXCERPTS } from './docs-help-sections.generated'
import type { PluginDocsKey } from './docs-help.generated'

export interface PluginDocsSectionExcerptProps {
  topic: PluginDocsKey
  anchor: string
  /** The page's own description, for a section the generator did not carry. */
  fallback: string
}

/**
 * One section's tooltip prose. The static import of the section registry
 * belongs to this module alone: `docs-help-section-excerpt.tsx` reaches it
 * through `lazy()`, so the prose is the payload of that chunk (AGL-3707).
 */
export function PluginDocsSectionExcerptText({
  topic,
  anchor,
  fallback,
}: PluginDocsSectionExcerptProps) {
  const sections = PLUGIN_DOCS_SECTION_EXCERPTS[topic] as
    | Readonly<Record<string, string>>
    | undefined
  return <>{sections?.[anchor] ?? fallback}</>
}

export default PluginDocsSectionExcerptText
