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

// The contextual-help topic registry is GENERATED from the docs site — see
// docs/DOCS_HELP_REGISTRY.md. Titles, excerpts, and heading anchors mirror
// apps/docs/docs; this module adds the URL builder and the docsHelp() resolver
// on top. Regenerate with: node tools/scripts/generate-docs-help.mjs
import {
  type DocsHelpAnchor,
  DOCS_HELP_TOPICS,
  type DocsHelpTopic,
  type DocsHelpTopicKey,
} from './docs-help.generated'

export {
  DOCS_HELP_ANCHORS,
  type DocsHelpAnchor,
  DOCS_HELP_TOPICS,
  type DocsHelpTopic,
  type DocsHelpTopicKey,
} from './docs-help.generated'

// The docs Vercel project deploys from apps/docs; the canonical domain lives
// in apps/docs/docusaurus.config.ts — keep the two in sync.
export const DOCS_BASE_URL = (
  process.env.NEXT_PUBLIC_AGLYN_DOCS_URL || 'https://docs.aglyn.com'
).replace(/\/+$/, '')

/** Absolute docs URL for a docs-site path (docs serve from the site root). */
export function buildDocsUrl(path = '/'): string {
  return `${DOCS_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export interface DocsHelpOverrides<
  K extends DocsHelpTopicKey = DocsHelpTopicKey,
> {
  /** Heading anchor on the topic's docs page. Type-checked against the page's
   * real headings — a stale anchor is a compile error (AGL-602). */
  anchor?: DocsHelpAnchor<K>
  /** Override the tooltip title (defaults to the topic's docs page title). */
  title?: string
  /** Override the tooltip excerpt (defaults to the topic's docs excerpt). */
  excerpt?: string
}

/**
 * Resolve a registry topic (plus optional heading anchor and copy overrides)
 * into the `HelpTipContent` shape the shared UI help affordances accept
 * (AGL-600/601). The `anchor` is constrained to the topic page's real
 * headings, so a docs restructure surfaces as a type error here.
 */
export function docsHelp<K extends DocsHelpTopicKey>(
  topic: K,
  overrides: DocsHelpOverrides<K> = {},
): { title: string; excerpt: string; href: string } {
  const { path, title, excerpt }: DocsHelpTopic = DOCS_HELP_TOPICS[topic]
  return {
    title: overrides.title ?? title,
    excerpt: overrides.excerpt ?? excerpt,
    href: `${buildDocsUrl(path)}${overrides.anchor ?? ''}`,
  }
}
