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

/**
 * Rule 14 on a page of its owner's own words whose lines a model reworded
 * (AGL-4152, `AiDoctrineTreeContext.rewritten`): the filler, placeholder and
 * judgment-word checks `ownWords` sets aside run again over the reworded
 * lines, and never over a line the owner wrote that the rewrite left alone.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { detectRewrittenCopy, validateAiDoctrineTree, type AiDoctrineTree, type AiDoctrineTreeContext } from './ai-doctrine-validators'

type Nested = { componentId: string; props?: Record<string, unknown>; children?: Nested[] }

/** A flat map from a nested literal, ids n1, n2, … in document order. */
function tree(root: Nested): AiDoctrineTree {
  const nodes: Record<string, { $id: string; parentId: string | null; componentId: string; nodes: string[]; props?: Record<string, unknown> }> = {}
  let counter = 0
  const visit = (nested: Nested, parentId: string | null): string => {
    const id = parentId === null ? CANVAS_ROOT_ELEMENT_ID : `n${++counter}`
    const { children = [], ...rest } = nested
    nodes[id] = { ...rest, $id: id, parentId, nodes: [] }
    for (const child of children) nodes[id].nodes.push(visit(child, id))
    return id
  }
  visit(root, null)
  return { rootId: CANVAS_ROOT_ELEMENT_ID, nodes } as unknown as AiDoctrineTree
}

const text = (variant: string, copy: string, component?: string): Nested => ({ componentId: 'muiTypography', props: { variant, children: copy, ...(component ? { component } : {}) } })
const pageOf = (...lines: string[]): AiDoctrineTree =>
  tree({ componentId: 'div', children: [{ componentId: 'section', props: { element: 'section' }, children: [text('h1', 'Our studio', 'h1'), ...lines.map((line) => text('body1', line))] }] })

const OWNER = 'Lorem ipsum dolor sit amet, as the template left it.'
const REWORDED = 'Classes run every week, Lorem ipsum dolor sit amet.'
const TOKEN = 'Book with {{name}} today.'
const JUDGED = 'Booking a class is simply one click away.'

/** The rule-14 copy codes a page's check names. */
const copyCodes = (nodes: AiDoctrineTree, context: AiDoctrineTreeContext) =>
  validateAiDoctrineTree(nodes, 'page', context)
    .violations.map((violation) => violation.code)
    .filter((code) => code === 'filler-copy' || code === 'placeholder-token' || code === 'judgment-words')

describe('rule 14 on reworded lines (AGL-4152)', () => {
  it.each([
    ['a page of a generator’s own words', pageOf(OWNER), {}, ['filler-copy']],
    ['the owner’s own words, nothing reworded', pageOf(OWNER), { ownWords: true }, []],
    ['the owner’s own words, all judged', pageOf(OWNER), { ownWords: true, rewritten: true }, ['filler-copy']],
    ['the owner’s filler left as written beside a clean rewrite', pageOf(OWNER, 'Classes run every week.'), { ownWords: true, rewritten: ['Classes run every week.'] }, []],
    ['filler a rewrite wrote', pageOf(OWNER, REWORDED), { ownWords: true, rewritten: [REWORDED] }, ['filler-copy']],
    ['a placeholder a rewrite wrote', pageOf(TOKEN), { ownWords: true, rewritten: [TOKEN] }, ['placeholder-token']],
    ['a judgment word, for an agency’s copy', pageOf(JUDGED), { ownWords: true, rewritten: [JUDGED], framing: 'agency' }, ['judgment-words']],
    ['a judgment word, for anyone else’s', pageOf(JUDGED), { ownWords: true, rewritten: [JUDGED] }, []],
    ['an empty list of reworded lines', pageOf(OWNER), { ownWords: true, rewritten: [] }, []],
  ] as Array<[string, AiDoctrineTree, AiDoctrineTreeContext, string[]]>)('%s', (_name, nodes, context, codes) => {
    expect(copyCodes(nodes, context)).toEqual(codes)
  })

  it('judges a part of a reworded line, and copy that holds one whole', () => {
    const line = 'Every class has eight seats or fewer, Lorem ipsum dolor.'
    expect(detectRewrittenCopy(pageOf('Lorem ipsum dolor.'), 'page', {}, [line]).map((violation) => violation.code)).toEqual(['filler-copy'])
    expect(detectRewrittenCopy(pageOf(`${line} And more.`), 'page', {}, [line]).map((violation) => violation.code)).toEqual(['filler-copy'])
    expect(detectRewrittenCopy(pageOf(OWNER), 'page', {}, ['Every class has eight seats or fewer.'])).toEqual([])
  })
})
