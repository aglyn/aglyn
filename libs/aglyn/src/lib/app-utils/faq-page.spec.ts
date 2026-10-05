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

import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import {
  FAQ_PAGE_MAX_QUESTIONS,
  isFaqSection,
  pageFaqPage,
} from './faq-page'

/** An authored tree, flattened below into the map the renderer walks. */
interface Tree {
  componentId: string
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
  children?: Tree[]
}

/**
 * The composed map for a tree: flat, children as id STRINGS under `nodes`,
 * rooted at `NODE_ROOT_ID`. Ids are assigned in document order so a test can
 * name a node by position when it needs to.
 */
const compose = (
  children: Tree[],
  rootId: string = NODE_ROOT_ID,
): Record<string, unknown> => {
  const nodes: Record<string, unknown> = {}
  let next = 0
  const place = (tree: Tree, parentId: string): string => {
    const id = `n${next++}`
    const { children: kids = [], ...rest } = tree
    nodes[id] = {
      $id: id,
      parentId,
      ...rest,
      nodes: kids.map((kid) => place(kid, id)),
    }
    return id
  }
  nodes[rootId] = {
    $id: rootId,
    componentId: 'div',
    nodes: children.map((child) => place(child, rootId)),
  }
  return nodes
}

const text = (children: string, variant = 'body1'): Tree => ({
  componentId: 'muiTypography',
  props: { variant, children },
})

const section = (ariaLabel: string | undefined, children: Tree[]): Tree => ({
  componentId: 'section',
  props: { element: 'section', ...(ariaLabel ? { ariaLabel } : {}) },
  children,
})

const container = (children: Tree[]): Tree => ({
  componentId: 'muiContainer',
  props: { maxWidth: 'lg' },
  children,
})

const stack = (children: Tree[]): Tree => ({
  componentId: 'muiStack',
  props: { spacing: 1 },
  children,
})

const grid = (children: Tree[]): Tree => ({
  componentId: 'muiGrid',
  props: { container: true, spacing: 3 },
  children,
})

/** The two-text item every pair shape is built from. */
const pair = (question: string, answer: string): Tree =>
  stack([text(question, 'h3'), text(answer)])

const accordion = (question: string, ...answers: string[]): Tree => ({
  componentId: 'muiAccordion',
  props: { disableGutters: true },
  children: [
    { componentId: 'muiAccordionSummary', props: { children: question } },
    {
      componentId: 'muiAccordionDetails',
      children: answers.map((answer) => text(answer)),
    },
  ],
})

const QA: Array<[string, string]> = [
  ['Do I need to know how to code?', 'No. Describe the site and edit the result.'],
  ['Can I use my own domain?', 'Yes, from the Starter plan up.'],
  ['Is there a free plan?', 'Yes. Publish one site at no charge.'],
]

/** The questions a block asks, in order, with their answers. */
const pairsOf = (block: Record<string, unknown> | null) =>
  ((block?.['mainEntity'] as Array<Record<string, any>>) ?? []).map(
    (question) => [question['name'], question['acceptedAnswer']['text']],
  )

describe('pageFaqPage reads the three live shapes', () => {
  it('reads the homepage grid: section > container > [heading, grid of two-text stacks]', () => {
    const nodes = compose([
      section('Frequently asked questions', [
        container([
          text('Frequently asked questions', 'h2'),
          grid(QA.map(([question, answer]) => pair(question, answer))),
        ]),
      ]),
    ])
    const block = pageFaqPage(nodes)
    expect(block).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
    })
    expect(pairsOf(block)).toEqual(QA)
    expect((block?.['mainEntity'] as unknown[])[0]).toEqual({
      '@type': 'Question',
      name: QA[0][0],
      acceptedAnswer: { '@type': 'Answer', text: QA[0][1] },
    })
  })

  it('reads the pricing sections: container > section > [h2, section of two-text sections]', () => {
    const nodes = compose([
      container([
        section('Pricing FAQ', [
          text('Pricing FAQ', 'h2'),
          section(undefined, [
            ...QA.map(([question, answer]) =>
              section(undefined, [text(question, 'h3'), text(answer)]),
            ),
          ]),
        ]),
      ]),
    ])
    expect(pairsOf(pageFaqPage(nodes))).toEqual(QA)
  })

  it('reads the alternatives accordions: summary asks, details answer', () => {
    const nodes = compose([
      section('FAQ', [
        container([
          text('Questions about switching', 'h2'),
          stack(QA.map(([question, answer]) => accordion(question, answer))),
        ]),
      ]),
    ])
    expect(pairsOf(pageFaqPage(nodes))).toEqual(QA)
  })

  it("publishes the first paragraph of an accordion's two-paragraph answer", () => {
    const nodes = compose([
      section('FAQ', [
        stack([
          accordion(QA[0][0], QA[0][1], 'A second paragraph, not the answer.'),
          accordion(QA[1][0], QA[1][1]),
        ]),
      ]),
    ])
    expect(pairsOf(pageFaqPage(nodes))).toEqual([QA[0], QA[1]])
  })
})

describe('pageFaqPage withholds what Google would report', () => {
  it('is null for the page with no FAQ section, which is most of them', () => {
    expect(pageFaqPage(null)).toBeNull()
    expect(pageFaqPage(undefined)).toBeNull()
    expect(pageFaqPage({})).toBeNull()
    // Two-line cards in a section that is not a FAQ are features, not
    // questions — the label is the only thing that names the block's purpose.
    const features = compose([
      section('Features', [
        grid(QA.map(([question, answer]) => pair(question, answer))),
      ]),
    ])
    expect(pageFaqPage(features)).toBeNull()
  })

  it('is null for a single pair, because FAQPage describes a list', () => {
    const nodes = compose([
      section('FAQ', [grid([pair(QA[0][0], QA[0][1])])]),
    ])
    expect(pageFaqPage(nodes)).toBeNull()
  })

  it('strips binding tokens nothing resolved, and drops a pair left empty', () => {
    const nodes = compose([
      section('FAQ', [
        grid([
          pair('Does {{var:aB3xK9m2Qw}} it work?', 'Yes, {{entry.title}} it does.'),
          pair('{{entry.question}}', 'An answer with no question left.'),
          pair(QA[1][0], QA[1][1]),
        ]),
      ]),
    ])
    expect(pairsOf(pageFaqPage(nodes))).toEqual([
      ['Does it work?', 'Yes, it does.'],
      QA[1],
    ])
  })

  it('is null when stripping the tokens leaves fewer than two pairs', () => {
    const nodes = compose([
      section('FAQ', [
        grid([pair('{{entry.question}}', '{{entry.answer}}'), pair(...QA[0])]),
      ]),
    ])
    expect(pageFaqPage(nodes)).toBeNull()
  })

  it(`keeps the author's first ${FAQ_PAGE_MAX_QUESTIONS} pairs of a longer list`, () => {
    const many = Array.from({ length: FAQ_PAGE_MAX_QUESTIONS + 10 }, (_, i) =>
      pair(`Question ${i + 1}?`, `Answer ${i + 1}.`),
    )
    const found = pairsOf(pageFaqPage(compose([section('FAQ', [grid(many)])])))
    expect(found).toHaveLength(FAQ_PAGE_MAX_QUESTIONS)
    expect(found[0]).toEqual(['Question 1?', 'Answer 1.'])
    expect(found[FAQ_PAGE_MAX_QUESTIONS - 1]).toEqual([
      `Question ${FAQ_PAGE_MAX_QUESTIONS}?`,
      `Answer ${FAQ_PAGE_MAX_QUESTIONS}.`,
    ])
  })

  it('skips a pair that is blank on either side', () => {
    const nodes = compose([
      section('FAQ', [
        grid([pair('   ', QA[0][1]), pair(...QA[1]), pair(...QA[2])]),
      ]),
    ])
    expect(pairsOf(pageFaqPage(nodes))).toEqual([QA[1], QA[2]])
  })
})

describe('pageFaqPage reads the page the way the renderer does', () => {
  it('merges several FAQ sections into one block, in page order', () => {
    // A crawler reads one FAQPage per page; two would read as a conflict.
    const nodes = compose([
      section('Pricing FAQ', [grid([pair(...QA[0]), pair(...QA[1])])]),
      text('Something between them'),
      section('Frequently asked questions', [
        stack([accordion(...QA[2]), accordion('Who is it for?', 'Everyone.')]),
      ]),
    ])
    expect(pairsOf(pageFaqPage(nodes))).toEqual([
      QA[0],
      QA[1],
      QA[2],
      ['Who is it for?', 'Everyone.'],
    ])
  })

  it('ignores a FAQ section no child list reaches from the root', () => {
    // The shape a collection expansion leaves: a template still in the map,
    // with its literal tokens, named by no list once its clones replace it.
    const nodes = compose([
      section('FAQ', [grid([pair(...QA[0]), pair(...QA[1])])]),
    ])
    const orphan = compose([
      section('FAQ', [grid([pair('Orphan one?', 'Yes.'), pair('Orphan two?', 'No.')])]),
    ], 'detached-root')
    delete orphan['detached-root']
    for (const [id, node] of Object.entries(orphan)) nodes[`t-${id}`] = { ...(node as object) }
    // The orphan's own ids were renamed, so its lists point nowhere — and the
    // root's list never named it. Only the drawn section publishes.
    expect(pairsOf(pageFaqPage(nodes))).toEqual([QA[0], QA[1]])
  })

  it('walks the whole map when it has no root to measure reach from', () => {
    const fragment = compose([
      section('FAQ', [grid([pair(...QA[0]), pair(...QA[1])])]),
    ], 'fragment-root')
    delete fragment['fragment-root']
    expect(pairsOf(pageFaqPage(fragment))).toEqual([QA[0], QA[1]])
  })

  it('reads the resolved props a repeated node carries', () => {
    // A node inside a collection binds its sentence into `resolvedProps`; the
    // raw `props` there still hold the token.
    const bound = (token: string, resolved: string): Tree => ({
      componentId: 'muiTypography',
      props: { children: token },
      resolvedProps: { children: resolved },
    })
    const nodes = compose([
      section('FAQ', [
        grid([
          stack([bound('{{item.q}}', QA[0][0]), bound('{{item.a}}', QA[0][1])]),
          stack([bound('{{item.q}}', QA[1][0]), bound('{{item.a}}', QA[1][1])]),
        ]),
      ]),
    ])
    expect(pairsOf(pageFaqPage(nodes))).toEqual([QA[0], QA[1]])
  })

  it('does not read a heading or lede beside the list as a pair', () => {
    // The section holds a two-text heading block AND the grid, so the section
    // itself is not a container of pairs; only the grid is.
    const nodes = compose([
      section('FAQ', [
        container([
          stack([text('FAQ', 'overline'), text('Frequently asked questions', 'h2')]),
          grid([pair(...QA[0]), pair(...QA[1])]),
        ]),
      ]),
    ])
    expect(pairsOf(pageFaqPage(nodes))).toEqual([QA[0], QA[1]])
  })
})

describe('isFaqSection', () => {
  const labelled = (ariaLabel: unknown, componentId = 'section') => ({
    componentId,
    props: { ariaLabel },
  })

  it('matches the labels authors give a FAQ block', () => {
    for (const label of [
      'FAQ',
      'FAQs',
      'Pricing FAQ',
      'faq — switching',
      'Frequently asked questions',
      'Frequently Asked Questions about pricing',
    ]) {
      expect(isFaqSection(labelled(label))).toBe(true)
    }
  })

  it('declines every other label, and every other element', () => {
    for (const label of ['Features', 'Questions', 'Pricing', '', undefined]) {
      expect(isFaqSection(labelled(label))).toBe(false)
    }
    expect(isFaqSection(labelled('FAQ', 'muiBox'))).toBe(false)
    expect(isFaqSection(null)).toBe(false)
    expect(isFaqSection(undefined)).toBe(false)
  })
})
