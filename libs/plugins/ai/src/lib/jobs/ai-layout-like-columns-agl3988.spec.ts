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

import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import { aiLayoutPageCheck, aiLayoutRepeatsSaidInTheLanguage } from './ai-job-page-language'

/*
 * The beta.270 Sugar Hollow Photography Galleries page (AGL-3988, job
 * DQ9pZupq6M) was refused for rule 1: "The same Grid block appears 4 times.
 * Make it one reusable component with props for what changes, and place it 4
 * times." Its draft was deleted with the site, so its shape is rebuilt here
 * from the plan's sections and the one shape the compiler draws as four like
 * Grid cells: a row of four columns, each holding the same blocks, which the
 * like-columns fold read only where each held a heading and no button.
 */

const block = (kind: string, text: string, col = -1, extra: Record<string, unknown> = {}) => ({
  kind,
  col,
  text,
  to: '',
  icon: '',
  style: 'none',
  items: [],
  ...extra,
})

/** The Galleries page's planned sections, as job DQ9pZupq6M's plan names them. */
const SECTIONS = [
  { name: 'Galleries intro', uses: [], items: 0 },
  { name: 'Weddings and elopements gallery', uses: [], items: 4 },
  { name: 'Family portraits gallery', uses: [], items: 0 },
  { name: 'Film or digital note', uses: [], items: 0 },
  { name: 'Call to action', uses: [], items: 0 },
]
const IDS = SECTIONS.map((_section, index) => `sec-${index}`)
const PAGES = [
  { id: 'p-home', label: 'Home', slug: '/' },
  { id: 'p-sessions', label: 'Sessions', slug: 'sessions' },
  { id: 'p-contact', label: 'Contact', slug: 'contact' },
  { id: 'p-about', label: 'About', slug: 'about' },
  { id: 'p-how', label: 'How It Works', slug: 'how-it-works' },
]

/** The check a page is held to on a workspace that keeps reusable components, as the page step builds it. */
const check = () =>
  aiLayoutPageCheck({
    screen: { title: 'Galleries', slug: '/galleries', template: null, sections: SECTIONS } as never,
    sectionIds: IDS,
    targets: { pageId: 'p-galleries', pages: PAGES, homeIds: ['p-home'], forms: [], formPageId: null, components: [], facts: 'A wedding and family photographer.' } as never,
    context: { screenIds: PAGES.map((page) => page.id), formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: IDS, repeatsCompiled: true, reusableComponents: true } as never,
    reusableComponents: true,
  })

const COLLECTIONS = ['Mountain elopements', 'Wedding days', 'Ceremony moments', 'Couple portraits']

/** The page, its gallery band's four columns as given. */
const page = (column: (name: string, index: number) => ReturnType<typeof block>[]) => ({
  sections: [
    { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Galleries'), block('lede', 'Weddings, elopements and families in the Blue Ridge.')] },
    {
      band: 'plain',
      align: 'start',
      cols: [3, 3, 3, 3],
      blocks: [block('heading', 'Weddings and elopements'), ...COLLECTIONS.flatMap(column)],
    },
    { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'Family portraits'), block('text', 'Relaxed outdoor sessions for families of every size.')] },
    { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Film or digital'), block('text', 'Every session is photographed on both.')] },
    { band: 'brand', align: 'center', cols: [], blocks: [block('heading', 'Ready to plan yours?'), block('button', 'Get in touch', -1, { to: 'page:p-contact' })] },
  ],
})

const ruleOne = (violations: readonly AiDoctrineViolation[]) => violations.filter((violation) => violation.rule === 1)

type Node = { componentId?: string; props?: Record<string, unknown> }
const nodesOf = (value: unknown) => Object.values((value as { nodes: Record<string, Node> }).nodes)

describe('like columns are folded into one group, never refused for rule 1 (AGL-3988)', () => {
  it('folds four columns of a title, words and a button to the same page into cards and one button', () => {
    const result = check()(page((name, index) => [
      block('heading', name, index),
      block('text', `${name}, photographed in the Blue Ridge.`, index),
      block('button', 'View gallery', index, { to: 'page:p-sessions' }),
    ]) as never)
    expect(ruleOne(result.violations)).toEqual([])
    expect(result.violations).toEqual([])
    const nodes = nodesOf(result.value)
    // One button where four said the same thing.
    expect(nodes.filter((node) => node.props?.['children'] === 'View gallery')).toHaveLength(1)
    for (const name of COLLECTIONS) expect(nodes.some((node) => node.props?.['primary'] === name || node.props?.['children'] === name)).toBe(true)
  })

  it('folds four columns whose buttons go to different pages into cards and a list of links named by their cards', () => {
    const to = ['page:p-about', 'page:p-sessions', 'page:p-how', 'page:p-about']
    const result = check()(page((name, index) => [
      block('heading', name, index),
      block('text', `${name}, photographed in the Blue Ridge.`, index),
      block('button', 'View', index, { to: to[index] }),
    ]) as never)
    expect(ruleOne(result.violations)).toEqual([])
    const links = nodesOf(result.value).filter((node) => node.componentId === 'muiScreenLink' && COLLECTIONS.includes(String(node.props?.['children'])))
    expect(links.map((node) => node.props?.['children'])).toEqual(COLLECTIONS)
  })

  it('folds four columns with no heading', () => {
    const result = check()(page((name, index) => [block('text', `${name}.`, index), block('note', 'Film and digital.', index)]) as never)
    expect(ruleOne(result.violations)).toEqual([])
  })

  it('folds four columns of a picture and its words', () => {
    const result = check()(page((name, index) => [block('image', `${name} in the mountains`, index), block('text', name, index)]) as never)
    expect(ruleOne(result.violations)).toEqual([])
  })
})

describe('a repeat rule 1 still finds is said as the layout language fixes it (AGL-3988)', () => {
  it('names the section it sits in and the group that says it once, never a component the answer cannot make', () => {
    const nodes = {
      root: { nodes: ['sec-0', 'sec-1'] },
      'sec-0': { nodes: [] },
      'sec-1': { nodes: ['row'] },
      row: { nodes: ['c1', 'c2', 'c3', 'c4'] },
    }
    const [said] = aiLayoutRepeatsSaidInTheLanguage(
      [{ rule: 1, code: 'repeated-subtree', message: 'The same Grid block appears 4 times. Make it one reusable component with props for what changes, and place it 4 times.', nodeIds: ['c1', 'c2', 'c3', 'c4'] }],
      nodes,
      ['sec-0', 'sec-1'],
      [{ name: 'Galleries intro' }, { name: 'Weddings and elopements gallery' }],
    )
    expect(said?.message).toContain('The same Grid block appears 4 times')
    expect(said?.detail).toBe(
      'In section 2 ("Weddings and elopements gallery"): write like blocks once, as one cards, steps or list block with an item for each (its title, its words and where it goes), never the same blocks repeated in several columns or groups.',
    )
  })

  it('leaves every other finding as it is', () => {
    const other: AiDoctrineViolation = { rule: 9, code: 'missing-alt', message: 'An image has no alt text.' }
    expect(aiLayoutRepeatsSaidInTheLanguage([other], {}, [], [])).toEqual([other])
  })
})
