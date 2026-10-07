/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
import { AI_LAYOUT_GAP_CODE, aiLayoutGapViolations, aiLayoutWithoutGaps } from './ai-layout-gaps'

type Spec = { componentId: string; props?: Record<string, unknown>; nodes?: string[]; interactions?: unknown[] }
const map = (nodes: Record<string, Spec>) => nodes as unknown as NodesMap
const text = (children: string, variant = 'body1'): Spec => ({ componentId: 'muiTypography', props: { children, variant } })

/** A hero, a CTA section whose small print has a gap, and a "Visit us" section of contact rows. */
function page(): NodesMap {
  return map({
    root: { componentId: 'div', nodes: ['hero', 'cta', 'visit'] },
    hero: { componentId: 'section', props: { ariaLabel: 'Hero' }, nodes: ['h1', 'toVisit'] },
    h1: text('Gentle grooming in Austin', 'h1'),
    toVisit: {
      componentId: 'muiButton',
      props: { children: 'Find us' },
      interactions: [{ id: 'go', enabled: true, trigger: { event: 'elementClick' }, steps: [{ type: 'scrollTo', selector: '[data-aglyn="leaf:visit"]' }] }],
    },
    cta: { componentId: 'section', props: { ariaLabel: 'Book' }, nodes: ['ctaHead', 'ctaNote', 'form'] },
    ctaHead: text('Ready to book?', 'h2'),
    ctaNote: text('Prefer to talk first? Reach us at [phone number] or visit our Contact page.', 'body2'),
    form: { componentId: 'form', props: { formId: 'form-contact' } },
    visit: { componentId: 'section', props: { ariaLabel: 'Visit us' }, nodes: ['visitHead', 'rows'] },
    visitHead: text('Visit us', 'h2'),
    rows: { componentId: 'muiStack', nodes: ['row1', 'row2'] },
    row1: { componentId: 'muiStack', nodes: ['icon1', 'line1'] },
    icon1: { componentId: 'icon', props: { iconId: 'pin', iconPath: 'M12 2C8.13 2 5 5.13 5 9Z' } },
    line1: text('[street address], Portland'),
    row2: { componentId: 'muiStack', nodes: ['icon2', 'line2'] },
    icon2: { componentId: 'icon', props: { iconId: 'clock' } },
    line2: text('Open mornings, [opening hours]'),
  })
}

describe('a page built in the layout language shows no gap (AGL-3660)', () => {
  it('names every gap as one violation that asks again', () => {
    const [violation] = aiLayoutGapViolations(page())
    expect(violation).toMatchObject({ rule: 14, code: AI_LAYOUT_GAP_CODE, nodeIds: ['ctaNote', 'line1', 'line2'] })
    expect(violation.message).toContain('[phone number], [street address], [opening hours]')
  })

  it('reads no icon drawing and no bracket-free page as a gap', () => {
    const nodes = page() as unknown as Record<string, Spec>
    for (const id of ['ctaNote', 'line1', 'line2']) delete nodes[id]
    expect(aiLayoutGapViolations(map(nodes))).toEqual([])
  })

  it('takes out the line, the rows it empties, and a section left with only its heading, with the link to it', () => {
    const { nodes, dropped } = aiLayoutWithoutGaps(page(), 'root')
    const kept = nodes as unknown as Record<string, Spec>
    // The CTA keeps its heading and form; only its small print goes.
    expect(kept['cta'].nodes).toEqual(['ctaHead', 'form'])
    // "Visit us" had nothing left but its heading, so it goes, and "Find us" with it.
    expect(kept['visit']).toBeUndefined()
    expect(kept['row1']).toBeUndefined()
    expect(kept['root'].nodes).toEqual(['hero', 'cta'])
    expect(kept['hero'].nodes).toEqual(['h1'])
    expect(aiLayoutGapViolations(nodes)).toEqual([])
    expect(dropped).toEqual([
      'Prefer to talk first? Reach us at [phone number] or visit our Contact page.',
      '[street address], Portland',
      'Open mornings, [opening hours]',
      'the section "Visit us", left with only its heading',
      '"Find us", a link to that section',
    ])
  })

  it('keeps a section that still says something, and never drops the first', () => {
    const nodes = page() as unknown as Record<string, Spec>
    nodes['visit'].nodes = ['visitHead', 'rows', 'lede']
    nodes['lede'] = text('Stop by for breakfast.')
    nodes['hero'].nodes = ['h1', 'heroGap']
    nodes['heroGap'] = text('Call [phone number]')
    const { nodes: out } = aiLayoutWithoutGaps(map(nodes), 'root')
    const kept = out as unknown as Record<string, Spec>
    expect(kept['visit'].nodes).toEqual(['visitHead', 'lede'])
    expect(kept['hero'].nodes).toEqual(['h1'])
  })
})
