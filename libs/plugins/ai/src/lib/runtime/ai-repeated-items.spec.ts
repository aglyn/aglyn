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

import { AI_TYPED_LIST_MIN_ITEMS } from './ai-doctrine-validators'
import { AI_REPEAT_KEY, AI_REPEAT_MAX_COPIES, expandAiRepeatedItems } from './ai-repeated-items'

/**
 * A repeated item written once (AGL-3053): how the copies are drawn, and every
 * way an item written once is refused, each naming the nodes the model wrote.
 */

type Node = { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[]; parentId?: string; repeat?: unknown }

const INLINE = { inline: true, noun: 'section' }

/** A section whose grid holds one card, written once, with the given copies. */
function section(repeat: unknown, over: Record<string, Node> = {}): { rootId: string; nodes: Record<string, Node> } {
  return {
    rootId: 'root',
    nodes: {
      root: { componentId: 'div', nodes: ['s'] },
      s: { componentId: 'section', props: { element: 'section' }, nodes: ['h', 'grid'] },
      h: { componentId: 'muiTypography', props: { variant: 'h2', component: 'h2', children: 'Practice areas' } },
      grid: { componentId: 'muiGrid', props: { direction: 'row' }, sx: { gap: 3 }, nodes: ['intro', 'card', 'outro'] },
      intro: { componentId: 'muiTypography', props: { variant: 'body1', children: 'Before the cards.' } },
      card: { componentId: 'muiCard', props: { variant: 'outlined' }, nodes: ['body'], [AI_REPEAT_KEY]: repeat },
      body: { componentId: 'muiCardContent', parentId: 'card', nodes: ['title', 'text'] },
      title: { componentId: 'muiTypography', parentId: 'body', props: { variant: 'h3', component: 'h3', children: '{{1}}' } },
      text: { componentId: 'muiTypography', parentId: 'body', props: { variant: 'body2', children: 'Covers {{2}}.' } },
      outro: { componentId: 'muiTypography', props: { variant: 'body1', children: 'After the cards.' } },
      ...over,
    },
  }
}

const drawn = (input: unknown) => {
  const result = expandAiRepeatedItems(input, INLINE)
  if (result.ok === false) throw new Error(JSON.stringify(result.violations))
  return result as Extract<typeof result, { ok: true }> & { tree: { rootId: string; nodes: Record<string, Node> } }
}

const refused = (input: unknown, options = INLINE) => {
  const result = expandAiRepeatedItems(input, options)
  if (result.ok === true) throw new Error('drawn, and expected to be refused')
  return result.violations.map(({ rule, code, detail, nodeIds }) => ({ rule, code, detail, nodeIds }))
}

describe('drawing a repeated item written once', () => {
  it('hands back an answer that is not a node map, or that writes nothing once, as it came', () => {
    for (const input of [null, 'text', { tree: 'x' }, { rootId: 'root' }]) {
      expect(expandAiRepeatedItems(input, INLINE)).toEqual({ ok: true, tree: input, sourceIds: {}, items: 0 })
    }
    const plain = section(undefined)
    delete plain.nodes['card'].repeat
    plain.nodes['title'].props = { variant: 'h3', children: 'Estate planning' }
    plain.nodes['text'].props = { variant: 'body2', children: 'Wills.' }
    const result = expandAiRepeatedItems(plain, INLINE)
    expect(result).toEqual({ ok: true, tree: plain, sourceIds: {}, items: 0 })
    expect(result.ok === true && result.tree).toBe(plain)
  })

  it('draws the copies in the item’s place and order, the first under the ids the model wrote and each other under <id>~<n>', () => {
    const { tree, sourceIds, items } = drawn(section([['Estate planning', 'wills'], ['Real estate', 'closings'], ['Probate', 'estates']]))
    expect(items).toBe(1)
    expect(tree.nodes['grid'].nodes).toEqual(['intro', 'card', 'card~2', 'card~3', 'outro'])
    expect(tree.nodes['card~2']).toEqual({ componentId: 'muiCard', props: { variant: 'outlined' }, nodes: ['body~2'] })
    expect(tree.nodes['body~3']).toEqual({ componentId: 'muiCardContent', parentId: 'card~3', nodes: ['title~3', 'text~3'] })
    const copy = (suffix: string) => [tree.nodes[`title${suffix}`].props?.['children'], tree.nodes[`text${suffix}`].props?.['children']]
    expect([copy(''), copy('~2'), copy('~3')]).toEqual([
      ['Estate planning', 'Covers wills.'],
      ['Real estate', 'Covers closings.'],
      ['Probate', 'Covers estates.'],
    ])
    expect(tree.nodes['card']).not.toHaveProperty(AI_REPEAT_KEY)
    expect(sourceIds).toEqual({
      'card~2': 'card',
      'body~2': 'body',
      'title~2': 'title',
      'text~2': 'text',
      'card~3': 'card',
      'body~3': 'body',
      'title~3': 'title',
      'text~3': 'text',
    })
    // Nothing the item does not hold is touched.
    expect([tree.nodes['h'], tree.nodes['intro'], tree.nodes['outro']]).toEqual([
      section([]).nodes['h'],
      section([]).nodes['intro'],
      section([]).nodes['outro'],
    ])
    expect(JSON.stringify(tree)).not.toMatch(/\{\{\d|"repeat"/)
  })

  it('draws the same tree from the same answer, and leaves the answer as it was', () => {
    const answer = section([['A', 'a'], ['B', 'b']])
    const before = structuredClone(answer)
    expect(drawn(answer)).toEqual(drawn(answer))
    expect(answer).toEqual(before)
  })

  it('fills a placeholder anywhere in props or styles, keeps a whole one’s type, and takes a lone value for a list of one', () => {
    const answer = section(['Estate planning', 'Real estate'], {
      title: { componentId: 'muiTypography', props: { variant: 'h3', children: ' {{1}} ' }, sx: { color: 'primary.main' } },
      text: { componentId: 'muiTypography', props: { variant: 'body2', children: 'See {{ 1 }} and {{1}}.' } },
    })
    const { tree } = drawn(answer)
    expect([tree.nodes['title'].props?.['children'], tree.nodes['text~2'].props?.['children']]).toEqual([
      'Estate planning',
      'See Real estate and Real estate.',
    ])
    const typed = drawn(
      section([[3, true], [4, false]], {
        title: { componentId: 'muiTypography', props: { variant: 'h3', children: 'Step {{1}}' }, sx: { mt: '{{1}}' } },
        text: { componentId: 'muiTypography', props: { variant: 'body2', children: 'Due', gutterBottom: '{{2}}' } },
      }),
    ).tree
    expect([typed.nodes['title'].sx, typed.nodes['title~2'].props, typed.nodes['text~2'].props]).toEqual([
      { mt: 3 },
      { variant: 'h3', children: 'Step 4' },
      { variant: 'body2', children: 'Due', gutterBottom: false },
    ])
  })

  it('leaves every binding token the platform reads as it was written: a variable, a property, a record field, a function', () => {
    const tokens = 'Call {{phone}} about {{prop.title}}, {{entry.name}} or {{fn:today()}}.'
    const { tree } = drawn(section([['A', 'a'], ['B', 'b']], { intro: { componentId: 'muiTypography', props: { variant: 'body1', children: tokens } } }))
    expect(tree.nodes['intro'].props?.['children']).toBe(tokens)
  })

  it('draws two items beside each other under one parent, each in its own place', () => {
    const answer = section([['A', 'a'], ['B', 'b']], {
      grid: { componentId: 'muiGrid', nodes: ['card', 'step'] },
      step: { componentId: 'muiTypography', props: { variant: 'body1', children: 'Step {{1}}' }, repeat: [['one'], ['two'], ['three']] },
    })
    const { tree, items } = drawn(answer)
    expect(items).toBe(2)
    expect(tree.nodes['grid'].nodes).toEqual(['card', 'card~2', 'step', 'step~2', 'step~3'])
  })
})

describe('refusing a repeated item written once', () => {
  it('refuses one where the workspace keeps reusable components: place its component as instances (rule 1)', () => {
    expect(refused(section([['A', 'a'], ['B', 'b']]), { inline: false, noun: 'section' })).toEqual([
      {
        rule: 1,
        code: 'repeat-not-inline',
        detail: 'Remove "repeat", and place each copy as an instance of a component the site has (componentId "reusableInstance").',
        nodeIds: ['card'],
      },
    ])
    // A placeholder such a workspace was never told of is its copy, as it always was.
    const stray = section(undefined)
    delete stray.nodes['card'].repeat
    expect(expandAiRepeatedItems(stray, { inline: false, noun: 'section' })).toEqual({ ok: true, tree: stray, sourceIds: {}, items: 0 })
  })

  it('refuses it on the document wrapper, on the section, and inside another item', () => {
    const onSection = section(undefined, { s: { ...section([]).nodes['s'], repeat: [['A'], ['B']] } })
    delete onSection.nodes['card'].repeat
    onSection.nodes['title'].props = { children: '{{1}}' }
    onSection.nodes['text'].props = { children: 'Plain.' }
    expect(refused(onSection).map(({ code, nodeIds }) => [code, nodeIds])).toEqual([['repeat-on-section', ['s']]])

    const nested = section([['A', 'a'], ['B', 'b']], {
      body: { componentId: 'muiCardContent', nodes: ['title', 'text'], repeat: [['x'], ['y']] },
    })
    expect(refused(nested)).toEqual([
      {
        rule: null,
        code: 'repeat-nested',
        detail: '"body" has "repeat" inside "card", which repeats already: keep "repeat" on "card" alone, and write what repeats inside it out in full.',
        nodeIds: ['body', 'card'],
      },
    ])
  })

  it('refuses a list that is not one list of values a copy, and a count below two or past the most', () => {
    expect(refused(section('Estate planning'))[0]).toMatchObject({ code: 'repeat-shape', nodeIds: ['card'] })
    expect(refused(section([['A', 'a'], { title: 'B', text: 'b' }]))[0]).toMatchObject({
      code: 'repeat-shape',
      detail: 'The second copy of "card" is not a list of text values: give each copy one list, such as [["Title 1", "Text 1"], ["Title 2", "Text 2"]].',
    })
    expect(refused(section([['A', ['a']], ['B', 'b']]))[0]).toMatchObject({ code: 'repeat-shape' })
    expect(AI_REPEAT_MAX_COPIES).toBe(AI_TYPED_LIST_MIN_ITEMS - 1)
    expect(refused(section([['A', 'a']]))[0]).toMatchObject({
      code: 'repeat-count',
      detail: '"repeat" on "card" lists 1 copy: list from 2 to 7, and write an item that appears once without "repeat".',
    })
    const many = Array.from({ length: AI_REPEAT_MAX_COPIES + 1 }, (_, index) => [`T${index}`, `t${index}`])
    expect(refused(section(many))[0]).toMatchObject({ code: 'repeat-count' })
    expect(drawn(section(many.slice(0, AI_REPEAT_MAX_COPIES))).items).toBe(1)
  })

  it('refuses a placeholder some copy gives no value for, naming the item and the node that uses it', () => {
    expect(refused(section([['A', 'a'], ['B']]))).toEqual([
      {
        rule: null,
        code: 'repeat-placeholder-without-value',
        detail: 'The second copy of "card" gives 1 value, and the item uses {{1}} and {{2}}: give every copy one value for each placeholder, in order.',
        nodeIds: ['card', 'text'],
      },
    ])
    const zero = section([['A'], ['B']], { title: { componentId: 'muiTypography', props: { children: '{{0}}' } } })
    zero.nodes['text'].props = { children: 'Plain.' }
    expect(refused(zero)[0]).toMatchObject({ code: 'repeat-placeholder-without-value', nodeIds: ['card', 'title'] })
  })

  it('refuses a value no placeholder uses: one too many, a gap in the numbering, and values with no placeholder at all', () => {
    expect(refused(section([['A', 'a', 'extra'], ['B', 'b', 'extra']]))[0]).toEqual({
      rule: null,
      code: 'repeat-value-without-placeholder',
      detail: 'The first copy of "card" gives 3 values, and the item uses only {{1}} and {{2}}: give every copy one value for each placeholder, in order.',
      nodeIds: ['card'],
    })
    const gap = section([['A', 'a', 'x'], ['B', 'b', 'y']])
    gap.nodes['text'].props = { children: '{{3}}' }
    expect(refused(gap)[0]).toMatchObject({
      code: 'repeat-value-without-placeholder',
      detail: '"card" uses {{1}} and {{3}} and no {{2}}, so each copy\'s second value fills nothing: number the placeholders from {{1}} with no gap.',
    })
    // Named placeholders are a site variable's tokens, not a copy's values.
    const named = section([['A', 'a'], ['B', 'b']])
    named.nodes['title'].props = { children: '{{title}}' }
    named.nodes['text'].props = { children: '{{summary}}' }
    expect(refused(named)[0]).toMatchObject({
      code: 'repeat-value-without-placeholder',
      detail: '"card" lists values and uses no placeholder for them: write {{1}}, {{2}} and on where its copies differ, each copy\'s values in that order.',
    })
    // Copies that differ in nothing are copies all the same.
    const alike = section([[], []])
    alike.nodes['title'].props = { children: 'Same' }
    alike.nodes['text'].props = { children: 'Same' }
    expect(drawn(alike).tree.nodes['grid'].nodes).toEqual(['intro', 'card', 'card~2', 'outro'])
  })

  it('refuses a placeholder in no repeated item', () => {
    const answer = section([['A', 'a'], ['B', 'b']], { outro: { componentId: 'muiTypography', props: { children: 'And {{3}} more.' } } })
    expect(refused(answer)).toEqual([
      {
        rule: null,
        code: 'repeat-placeholder-without-value',
        detail: '"outro" uses {{3}} and sits in no item with "repeat": write its text out, or put "repeat" on the item it repeats in.',
        nodeIds: ['outro'],
      },
    ])
  })

  it('refuses a copy whose id the answer already gives another node', () => {
    const answer = section([['A', 'a'], ['B', 'b']], { 'text~2': { componentId: 'muiTypography', props: { children: 'Taken.' } } })
    answer.nodes['grid'].nodes = ['intro', 'card', 'outro', 'text~2']
    expect(refused(answer)).toEqual([
      {
        rule: null,
        code: 'repeat-id-collision',
        detail: 'The second copy of "text" takes the id "text~2", which the answer already gives another node: rename "text~2".',
        nodeIds: ['card', 'text~2'],
      },
    ])
  })

  it('says what cannot be used by the noun a person reads', () => {
    const result = expandAiRepeatedItems(section([['A', 'a'], ['B']]), { inline: true, noun: 'page' })
    expect(result.ok === false && result.violations[0].message).toBe('The answer could not be used as a page.')
  })
})
