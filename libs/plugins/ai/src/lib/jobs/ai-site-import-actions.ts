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

/*==========================================
 * A PAGE'S CALLS TO ACTION UNDER IMPROVE IT (AGL-4152).
 *
 * The mechanical tidying of a section's buttons, the same whether a
 * redesign drew the page or the page kept its source's layout: each call to
 * action once, where it belongs. No model is asked; nothing is reworded.
 *=========================================*/

import type { AiLayoutBlock, AiLayoutItem, AiLayoutSection } from '../layout-language/ai-layout-language'

const clean = (text: unknown): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')

/** A button's words and where it goes, as one key: two that share it are the same action. */
const actionKey = (text: string | undefined, to: string | undefined): string => `${clean(text).toLowerCase()}\u0000${to ?? ''}`

/** Whether a button is drawn filled: the compiler's default, `primary` or `large`. */
const filled = (block: AiLayoutBlock): boolean => block.kind === 'button' && (block.style === undefined || block.style === 'primary' || block.style === 'large')

/**
 * A redesigned section's calls to action, each once and each where it belongs
 * (AGL-4152), whatever the answer and the source's kept groups gave:
 *
 * - Buttons placed in a row's columns under a group that runs the row's width,
 *   with nothing else in those columns, sit in the cards they go to where each
 *   goes where exactly one card does, else together under the group: a row of
 *   two buttons under three cards read as a grid half filled.
 * - A link with the same words to the same place on every item of a group
 *   (each review's "See more reviews") is shown once, as a button after the
 *   group, unless the section already has that button. Where only some items
 *   carry it, each is that item's own action and stays.
 * - The same button twice in a section is shown once, the first.
 * - Two buttons side by side to the same place are one: the one with the
 *   header's words where one has them, else the first. Of buttons side by
 *   side, only the first is filled; the rest are outlined.
 */
export function aiSiteImportSectionActions(section: Pick<AiLayoutSection, 'cols' | 'blocks'>, cta?: string | null): Pick<AiLayoutSection, 'cols' | 'blocks'> {
  let { cols, blocks } = section
  // Buttons in columns under a group across the row.
  const placed = blocks.filter((block) => block.col !== undefined)
  const group = blocks.find((block) => block.col === undefined && (block.items?.length ?? 0) >= 2 && block.kind !== 'list' && block.kind !== 'faq')
  if (cols && cols.length >= 2 && group && placed.length && placed.every((block) => block.kind === 'button')) {
    const items = group.items as AiLayoutItem[]
    const cards = placed.map((button) => items.flatMap((item, at) => (button.to && item.to === button.to && !item.links?.length ? [at] : [])))
    const own = cards.every((found) => found.length === 1) && new Set(cards.map((found) => found[0])).size === cards.length
    if (own) {
      const into = new Map(placed.map((button, at) => [cards[at]?.[0] as number, button]))
      const carded = { ...group, items: items.map((item, at) => (into.has(at) ? { ...item, links: [{ text: into.get(at)?.text ?? '', to: item.to as string, style: 'secondary' as const }] } : item)) }
      blocks = blocks.flatMap((block) => (block === group ? [carded] : placed.includes(block) ? [] : [block]))
    } else blocks = blocks.map((block) => (placed.includes(block) ? (({ col: _col, ...rest }) => rest)(block) : block))
    cols = undefined
  }
  // A link repeated across a group's items, once after the group.
  const buttons = new Set(blocks.flatMap((block) => (block.kind === 'button' ? [actionKey(block.text, block.to)] : [])))
  blocks = blocks.flatMap((block) => {
    const items = block.items
    if (!items || items.length < 2) return [block]
    const counted = new Map<string, { text: string; to?: string; style?: AiLayoutBlock['style']; on: number }>()
    for (const item of items) {
      for (const key of new Set((item.links ?? []).map((link) => actionKey(link.text, link.to)))) {
        const link = item.links?.find((entry) => actionKey(entry.text, entry.to) === key)
        const was = counted.get(key)
        if (link) counted.set(key, { text: link.text, ...(link.to ? { to: link.to } : {}), ...(link.style ? { style: link.style } : {}), on: (was?.on ?? 0) + 1 })
      }
    }
    const repeated = new Map([...counted].filter(([, entry]) => entry.on === items.length))
    if (!repeated.size) return [block]
    const stripped = items.map((item) => {
      if (!item.links?.length) return item
      const links = item.links.filter((link) => !repeated.has(actionKey(link.text, link.to)))
      const { links: _links, ...rest } = item
      return links.length ? { ...rest, links } : rest
    })
    const after = [...repeated].flatMap(([key, entry]): AiLayoutBlock[] => {
      if (buttons.has(key)) return []
      buttons.add(key)
      return [{ kind: 'button', text: entry.text, ...(entry.to ? { to: entry.to } : {}), ...(entry.style ? { style: entry.style } : {}), ...(block.col !== undefined ? { col: block.col } : {}) }]
    })
    return [{ ...block, items: stripped }, ...after]
  })
  // The same button twice, once.
  const seen = new Set<string>()
  blocks = blocks.filter((block) => {
    if (block.kind !== 'button' || !block.to) return true
    const key = actionKey(block.text, block.to)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // Buttons side by side: one to each place, the first filled.
  const wanted = clean(cta).toLowerCase()
  const out: AiLayoutBlock[] = []
  for (const block of blocks) {
    const before = out[out.length - 1]
    if (block.kind === 'button' && before?.kind === 'button' && before.col === block.col) {
      // Back over the run this button stands in.
      let start = out.length - 1
      while (start > 0 && out[start - 1]?.kind === 'button' && out[start - 1]?.col === block.col) start -= 1
      const run = out.slice(start)
      const same = block.to ? run.findIndex((entry) => entry.to === block.to) : -1
      if (same !== -1) {
        // The header's words win the place; the run keeps its first button's place and fill.
        const kept = run[same] as AiLayoutBlock
        if (wanted && clean(block.text).toLowerCase() === wanted && clean(kept.text).toLowerCase() !== wanted) {
          const { style: _style, ...words } = block
          out[start + same] = { ...words, ...(kept.style ? { style: kept.style } : {}) }
        }
        continue
      }
      out.push(run.some(filled) && filled(block) ? { ...block, style: 'secondary' } : block)
      continue
    }
    out.push(block)
  }
  return { ...(cols ? { cols } : {}), blocks: out }
}
