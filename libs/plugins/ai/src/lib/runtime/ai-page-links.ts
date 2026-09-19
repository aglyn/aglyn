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

import {
  nodeIdFromInteractionSelector,
  nodeInteractionSelector,
  type NodeInteraction,
} from '@aglyn/aglyn/app-utils/node-interactions'

/**
 * A link to a section of the same page (AGL-3097).
 *
 * A call to action often belongs on the page it is on: a hero's "Request a
 * Consultation" takes the visitor to the consultation form further down. The
 * platform does that with the Scroll to element interaction (AGL-2867), never
 * with an anchor: a placed element carries no id an `href` fragment could
 * name, and the palette validator drops a bare fragment. A generated node may
 * not write an interaction either, and when a page's first section is written
 * the section it points at does not exist yet.
 *
 * So a page's link names a section of the page by its name in the plan, with
 * `scrollTo`, or with an `href` fragment made of that name's words, and the
 * page step writes the interaction for it. Every section's root id is minted
 * from the job and the section's place in the plan before any is built, so
 * the interaction can name its target on the pass that writes the link.
 */

/** The prop a link names a section of its own page with, by the section's name in the plan. */
export const AI_PAGE_SCROLL_TO_PROP = 'scrollTo'

/** The id of the interaction a link scrolling to a section of its page carries. */
export const AI_PAGE_SCROLL_INTERACTION_ID = 'ai-scroll-to-section'

/** The words of a name or an anchor, as they are compared: lowercase, letters and digits. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/**
 * The section of the page a link names, by its place in the plan, or `null`
 * when it names none, or more than one. A name matches a section whose name
 * has the same words in any case and spacing, as "consultation-request-form"
 * matches "consultation request form"; failing that, the one section whose
 * name holds every word of it, as "#consultation-form" names that section. An
 * `href` is read as a fragment, `#` and all.
 */
export function aiPageLinkSection(text: string, sections: readonly string[]): number | null {
  const words = wordsOf(text.trim().replace(/^#/, ''))
  if (!words.length) return null
  const named = sections.map(wordsOf)
  const exact = named.flatMap((section, index) => (section.join(' ') === words.join(' ') ? [index] : []))
  if (exact.length) return exact.length === 1 ? exact[0] : null
  const holding = named.flatMap((section, index) => (words.every((word) => section.includes(word)) ? [index] : []))
  return holding.length === 1 ? holding[0] : null
}

/** An `href` that is only a fragment: `#consultation-form`, and never `#` alone. */
export function isAiFragmentHref(value: unknown): value is string {
  return typeof value === 'string' && /^#\S+$/.test(value.trim())
}

/** Where a written link says it goes on its own page: a section, or a name no section has. */
export type AiPageLinkTarget =
  | { kind: 'section'; section: number }
  | { kind: 'unknown'; value: string; via: 'scrollTo' | 'href' }

/**
 * Where a link node, as the model wrote it, goes on its own page: the section
 * its `scrollTo` names, or else the one its `href` fragment names, by its
 * place in the plan; the name it wrote when no section has it; `null` when it
 * names no section of the page at all.
 */
export function aiPageLinkTarget(written: unknown, sections: readonly string[]): AiPageLinkTarget | null {
  const props = isRecord(written) && isRecord(written['props']) ? written['props'] : {}
  const scrollTo = props[AI_PAGE_SCROLL_TO_PROP]
  const [value, via] =
    typeof scrollTo === 'string' && scrollTo.trim()
      ? [scrollTo.trim(), 'scrollTo' as const]
      : isAiFragmentHref(props['href'])
        ? [props['href'].trim(), 'href' as const]
        : [null, null]
  if (value === null || via === null) return null
  const section = aiPageLinkSection(value, sections)
  return section === null ? { kind: 'unknown', value, via } : { kind: 'section', section }
}

/**
 * The Scroll to element interaction a link carries to a section of its page,
 * in the shape the interactions editor stores on a node: a click, every time,
 * scrolling smoothly to the section's root with no offset, which are the
 * editor's own defaults. The selector is the one the renderer stamps.
 */
export function aiPageScrollInteraction(sectionRootId: string, sectionName: string): NodeInteraction {
  return {
    id: AI_PAGE_SCROLL_INTERACTION_ID,
    name: `Scroll to the ${sectionName} section`,
    enabled: true,
    trigger: { event: 'elementClick', everyTime: true },
    steps: [{ type: 'scrollTo', selector: nodeInteractionSelector(sectionRootId) }],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The nodes a stored node scrolls to when it is clicked: every enabled click
 * interaction's Scroll to element steps, by the ids their selectors name.
 * Read only from a page as the page step stores it, where the palette
 * validator has already dropped every interaction a model wrote.
 */
export function aiStoredScrollTargets(node: unknown): string[] {
  const interactions = isRecord(node) && Array.isArray(node['interactions']) ? node['interactions'] : []
  return interactions.flatMap((interaction: unknown) => {
    if (!isRecord(interaction) || interaction['enabled'] === false) return []
    const trigger = isRecord(interaction['trigger']) ? interaction['trigger'] : {}
    if (trigger['event'] !== 'elementClick' || !Array.isArray(interaction['steps'])) return []
    return interaction['steps'].flatMap((step: unknown) => {
      const target = isRecord(step) && step['type'] === 'scrollTo' ? nodeIdFromInteractionSelector(step['selector']) : undefined
      return target ? [target] : []
    })
  })
}
