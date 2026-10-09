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

// PLUGIN_DOCS + anchor types are GENERATED from the docs site — see
// docs/DOCS_HELP_REGISTRY.md. The first-party plugin consoles live in
// libs/plugins/* and cannot import the console's constants, so they read this
// subset instead. Regenerate with:
//   node tools/scripts/generate-docs-help.mjs
import { createElement, type ReactNode } from 'react'
import PluginDocsSectionExcerpt from './docs-help-section-excerpt'
import {
  PLUGIN_DOCS,
  PLUGIN_DOCS_SECTION_TITLES,
  type PluginDocsAnchor,
  type PluginDocsKey,
  type PluginDocsTopic,
} from './docs-help.generated'

export {
  PLUGIN_DOCS,
  PLUGIN_DOCS_ANCHORS,
  PLUGIN_DOCS_SECTION_TITLES,
  type PluginDocsAnchor,
  type PluginDocsKey,
  type PluginDocsTopic,
} from './docs-help.generated'

/**
 * The docs-site origin, resolved exactly as the console's
 * `constants/docs-links.ts` and the besigner's `utils/docs-help.ts` resolve it.
 *
 * Canonical name first, older name as a fallback (AGL-2186). Dot notation
 * rather than the bracket form (AGL-2037): these modules ship in the client
 * bundle, where the bracket form is never substituted and every help link
 * would point at Aglyn's docs regardless of what an operator configured.
 */
export const DOCS_BASE_URL = (
  process.env.NEXT_PUBLIC_DOCS_ORIGIN ||
  process.env.NEXT_PUBLIC_AGLYN_DOCS_URL ||
  'https://docs.aglyn.com'
).replace(/\/+$/, '')

export interface PluginDocsHelpOverrides<
  K extends PluginDocsKey = PluginDocsKey,
> {
  /**
   * Heading anchor on the topic's docs page, type-checked against that page's
   * real headings — a renamed heading is a compile error here rather than a
   * link that drops the reader at the top of a long page and lets them believe
   * they are in the right place.
   */
  anchor?: PluginDocsAnchor<K>
  /** Override the tooltip title (defaults to the anchor's heading, else the
   * topic's docs page title). */
  title?: string
  /**
   * Override the tooltip excerpt (defaults to the anchor's section, else the
   * page's description).
   *
   * Worth doing whenever the card is one subject on a page that covers
   * several: the page's own description is written for the page, and a card's
   * reader is standing in front of one control.
   */
  excerpt?: string
}

/**
 * Resolve a plugin docs topic into the `HelpTipContent` shape the shared UI
 * help affordances accept — the `libs/plugins` counterpart of the console's
 * `docsHelp()` (AGL-2213).
 *
 * The title and href are strings, resolved here: they are the help button's
 * accessible name and destination. An anchored excerpt is a node that fetches
 * its section's prose when the tooltip opens (`PluginDocsSectionExcerpt`),
 * because the prose of every linked section is more than every plugin console
 * should carry for a hover most visits never make.
 */
export function pluginDocsHelp<K extends PluginDocsKey>(
  topic: K,
  overrides: PluginDocsHelpOverrides<K> = {},
): {
  title: string
  excerpt: ReactNode
  /** The excerpt as text for an attribute (`title=`): the override, else the
   * page's description — a section's prose arrives only with a tooltip. */
  excerptText: string
  href: string
} {
  const { path, title, excerpt }: PluginDocsTopic = PLUGIN_DOCS[topic]
  const { anchor } = overrides
  // An anchored tip shows its heading and that section's opening sentence,
  // not the page's (AGL-3707): twenty cards deep-linking twenty sections of
  // one page used to print one blurb between them.
  const sectionTitle = anchor
    ? (
        PLUGIN_DOCS_SECTION_TITLES[topic] as
          | Readonly<Record<string, string>>
          | undefined
      )?.[anchor]
    : undefined
  return {
    title: overrides.title ?? sectionTitle ?? title,
    excerpt:
      overrides.excerpt ??
      (anchor && sectionTitle
        ? createElement(PluginDocsSectionExcerpt, {
            topic,
            anchor,
            fallback: excerpt,
          })
        : excerpt),
    excerptText: overrides.excerpt ?? excerpt,
    href: `${DOCS_BASE_URL}${path}${anchor ?? ''}`,
  }
}
