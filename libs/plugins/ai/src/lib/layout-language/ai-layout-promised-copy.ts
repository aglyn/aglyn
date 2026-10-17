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

import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'

/**
 * No section that promises its own content later (AGL-3887). A guided start
 * publishes what it builds, so a section whose words say it is still being
 * filled — "We are building this space for the words of families we have
 * worked with", the live Whitmore Lane Family Law home of 2026-10-16 — is a
 * stand-in a visitor reads as an unfinished site. A page answer holding one
 * is asked again; the last answer a generation takes has the section taken
 * out instead (`aiLayoutPageCheck`), its first section aside.
 *
 * Scoped to the page speaking of itself: "this space", "this section", the
 * site's own reviews, photos or portfolio promised for later. "Coming soon"
 * alone is never one: an event, a menu item or a new location is genuinely
 * coming soon on a dated list. A coming-soon site, whose whole point is what
 * is coming, is not held to it.
 */

/** The violation code a section that promises its content later is named by. */
export const AI_LAYOUT_PROMISED_COPY_CODE = 'layout-promised-copy'

/** What a site owes and may promise later: its customers' words, its pictures, its work. */
const OWED =
  '(?:testimonials?|reviews?|kind words|feedback|client stories|success stories|stories from (?:our )?\\w+|words from (?:our )?\\w+|photos|pictures|gallery|portfolio|case studies)'

const PROMISED_COPY: readonly RegExp[] = [
  // The page building itself: "We are building this space", "we're putting together this section".
  /\b(?:we(?:['’]re| are)|we(?:['’]ll| will) be)\s+(?:still\s+)?(?:building|growing|gathering|collecting|putting together|working on|filling|adding to)\s+(?:this|the)\s+(?:space|section|page|area|corner)\b/i,
  // "This space will soon…", "This section is being built", "This page is under construction".
  /\bthis\s+(?:space|section|area|corner|page)\s+will\s+soon\b/i,
  /\bthis\s+(?:space|section|area|corner|page)\s+is\s+(?:being\s+(?:built|filled|prepared)|(?:currently\s+)?under\s+construction|reserved\s+for|still\s+(?:empty|growing|being))\b/i,
  /\bthis\s+(?:space|section|area|corner)\s+will\s+(?:hold|feature|carry|fill with|share|be filled|be home to)\b/i,
  /\b(?:page|site|section|space|website)\s+(?:is\s+)?(?:currently\s+)?under\s+construction\b/i,
  // What the site owes, promised for later: "Reviews coming soon", "photos are on their way".
  new RegExp(`\\b${OWED}\\b[^.!?]{0,50}\\b(?:coming soon|on (?:the|its|their) way|to come|being (?:gathered|collected|added))\\b`, 'i'),
  new RegExp(`\\b(?:coming soon|check back|stay tuned)\\b[^.!?]{0,60}\\b(?:${OWED}|this (?:space|section|page))\\b`, 'i'),
  new RegExp(`\\b${OWED}\\b[^.!?]{0,60}\\b(?:check back|stay tuned)\\b`, 'i'),
]

/** Whether a line promises the page's own content later, rather than saying it. */
export function aiLayoutPromisesContent(text: string): boolean {
  return PROMISED_COPY.some((pattern) => pattern.test(text))
}

interface WordNode {
  componentId?: string
  props?: Record<string, unknown>
  nodes?: string[]
}

/** The props a node's own words are in, as a visitor reads them. */
const WORD_PROPS = ['children', 'primary', 'secondary', 'label'] as const

/** Every line a node and everything under it says. */
function linesUnder(nodes: Readonly<Record<string, WordNode>>, id: string): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const next = stack.pop() as string
    const node = nodes[next]
    if (!node || seen.has(next)) continue
    seen.add(next)
    for (const prop of WORD_PROPS) {
      const value = node.props?.[prop]
      if (typeof value === 'string' && value.trim()) lines.push(value.trim())
    }
    stack.push(...(node.nodes ?? []))
  }
  return lines
}

/**
 * The plan indices of a built page's sections that promise their content
 * later, each with the line that does, in page order.
 */
export function aiLayoutPromisedSections(
  nodes: NodesMap,
  sectionIds: readonly string[],
): Array<{ index: number; line: string }> {
  const map = nodes as unknown as Readonly<Record<string, WordNode>>
  return sectionIds.flatMap((id, index) => {
    if (!id || !map[id]) return []
    const line = linesUnder(map, id).find(aiLayoutPromisesContent)
    return line ? [{ index, line }] : []
  })
}

/** The violation that asks again for the sections that promise their content later. */
export function aiLayoutPromisedCopyViolations(
  screen: { sections: ReadonlyArray<{ name: string }> },
  found: ReadonlyArray<{ index: number; line: string }>,
): AiDoctrineViolation[] {
  return found.map(({ index, line }) => ({
    rule: 14,
    code: AI_LAYOUT_PROMISED_COPY_CODE,
    message: `Section ${index + 1} ("${screen.sections[index]?.name ?? ''}") promises content that is not there: "${line}". This site is published exactly as written.`,
    detail: `Write section ${index + 1} about what is true now, in the site's voice: what working together is like, how the work goes, what a visitor can expect. Never say a space is being built or something is coming soon, and never write a review, testimonial or quote nobody gave.`,
  }))
}
