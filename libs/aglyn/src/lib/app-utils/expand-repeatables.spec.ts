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
  expandRepeatables,
  hasRepeatableNodes,
  REPEAT_CONNECTION_PROP,
  repeatKey,
  repeatKeys,
  withoutRepeatDirective,
} from './expand-repeatables'

const baseNodes = () =>
  ({
    root: { $id: 'root', componentId: 'div', nodes: ['list'] },
    list: {
      $id: 'list',
      componentId: 'muiStack',
      props: { repeatDataset: 'Team' },
      nodes: ['row'],
    },
    row: {
      $id: 'row',
      componentId: 'muiStack',
      parentId: 'list',
      props: { direction: 'row' },
      nodes: ['label'],
    },
    label: {
      $id: 'label',
      componentId: 'muiTypography',
      parentId: 'row',
      props: { children: '{{item.name}} — {{item.role}}' },
    },
  }) as any

const team = {
  records: [
    { name: 'Ada', role: 'Engineer' },
    { name: 'Grace', role: 'Admiral' },
  ],
}

describe('expandRepeatables reference hops (AGL-180)', () => {
  it('resolves {{item.ref.field}} through the target dataset', () => {
    const nodes = baseNodes()
    nodes['label'].props.children = '{{item.name}} by {{item.author.name}}'
    const posts = {
      records: [{ $id: 'p1', name: 'Hello', author: 'a1' }],
      // The rows' references, as the plugin keeping them states them: the
      // `author` field points into the rows answered under `authors`.
      model: { references: { author: 'authors' } },
    } as any
    const authors = {
      records: [{ $id: 'a1', name: 'Ada' }],
    } as any
    const result = expandRepeatables(nodes, { Team: posts, authors })
    const list = result['list'] as any
    const label = (result[(result[list.nodes[0]] as any).$id] as any).nodes[0]
    expect((result[label] as any).props.children).toBe('Hello by Ada')
  })

  it('resolves multi-reference arrays and prints nothing for an unknown hop', () => {
    const nodes = baseNodes()
    nodes['label'].props.children = '{{item.tags.name}} / {{item.ghost.name}}'
    const posts = {
      records: [{ $id: 'p1', tags: ['t1', 't2'] }],
      model: { references: { tags: 'tags' } },
    } as any
    const tags = {
      records: [
        { $id: 't1', name: 'red' },
        { $id: 't2', name: 'blue' },
      ],
    } as any
    const result = expandRepeatables(nodes, { Team: posts, tags })
    const list = result['list'] as any
    const label = (result[list.nodes[0]] as any).nodes[0]
    expect((result[label] as any).props.children).toBe(
      'red, blue / ',
    )
  })
})

describe('expandRepeatables', () => {
  it('clones the template per record with item tokens substituted', () => {
    const result = expandRepeatables(baseNodes(), { Team: team })
    const list = result['list'] as any
    expect(list.nodes).toHaveLength(2)
    const [first, second] = list.nodes
    expect((result[first] as any).parentId).toBe('list')
    const firstLabel = (result[first] as any).nodes[0]
    expect((result[firstLabel] as any).props.children).toBe('Ada — Engineer')
    const secondLabel = (result[second] as any).nodes[0]
    expect((result[secondLabel] as any).props.children).toBe(
      'Grace — Admiral',
    )
    // Non-repeated props survive the clone.
    expect((result[first] as any).props.direction).toBe('row')
  })

  it('honors repeatLimit and prints nothing for a field the record lacks (AGL-3616)', () => {
    const nodes = baseNodes()
    nodes.list.props.repeatLimit = 1
    nodes.label.props.children = '{{item.name}} ({{item.missing}})'
    const result = expandRepeatables(nodes, { Team: team })
    const list = result['list'] as any
    expect(list.nodes).toHaveLength(1)
    const label = (result[(result[list.nodes[0]] as any).nodes[0]] as any)
    expect(label.props.children).toBe('Ada ()')
  })

  /**
   * AGL-3616: low-tide-hollow.aglyn.app's tour dates drew `{{ITEM.VENUE}}`
   * as each card's eyebrow — its records name no venue yet. An element that
   * is only a binding its record leaves empty is left out of that copy; a
   * record that fills the field still draws it.
   */
  it('leaves out an element whose whole text is a binding the record leaves empty', () => {
    const nodes = baseNodes()
    nodes.row.nodes = ['kicker', 'label']
    nodes.kicker = {
      $id: 'kicker',
      componentId: 'muiTypography',
      parentId: 'row',
      props: { children: ' {{item.venue}} ', variant: 'overline' },
    }
    nodes.label.props.children = '{{item.name}}'
    const shows = {
      records: [
        { name: 'Asheville show', venue: '' },
        { name: 'Durham show' },
        { name: 'Boone show', venue: 'The Hollow' },
      ],
    }
    const result = expandRepeatables(nodes, { Team: shows }) as any
    const rows = result.list.nodes.map((id: string) => result[id])
    const texts = rows.map((row: any) =>
      row.nodes.map((id: string) => result[id].props.children),
    )
    expect(texts).toEqual([
      // An empty string is a value the record holds: printed as nothing, and
      // the element left out all the same.
      ['Asheville show'],
      ['Durham show'],
      [' The Hollow ', 'Boone show'],
    ])
    expect(JSON.stringify(rows.map((row: any) => row.nodes.map((id: string) => result[id])))).not.toContain('{{')
    expect(result['rep__list__0__kicker']).toBeUndefined()
    expect(result['rep__list__2__kicker'].parentId).toBe('rep__list__2__row')
  })

  /**
   * AGL-3912: ironwood-barbell-gym's coaches' photos were in the library of
   * a site since deleted. The data plugin leaves such a photo out of its
   * record, and the card leaves out the picture rather than draw an empty
   * frame where it was.
   */
  it('leaves out an image whose whole src is a binding the record leaves empty', () => {
    const nodes = baseNodes()
    nodes.row.nodes = ['photo', 'label']
    nodes.photo = {
      $id: 'photo',
      componentId: 'image',
      parentId: 'row',
      props: { src: '{{item.image}}', alt: '{{item.name}}' },
    }
    nodes.label.props.children = '{{item.name}}'
    const coaches = {
      records: [
        { name: 'Head coach' },
        { name: 'Barbell coach', image: '/api/media/cdn/site-1/m-1' },
      ],
    }
    const result = expandRepeatables(nodes, { Team: coaches }) as any
    expect(result['rep__list__0__photo']).toBeUndefined()
    expect(result['rep__list__0__row'].nodes).toEqual(['rep__list__0__label'])
    expect(result['rep__list__1__photo'].props.src).toBe('/api/media/cdn/site-1/m-1')
  })

  it('leaves out a self-scoped copy whose whole text is an empty binding', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['tag'] },
      tag: {
        $id: 'tag',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { repeatDataset: 'Team', children: '{{item.role}}' },
      },
    } as any
    const result = expandRepeatables(nodes, {
      Team: { records: [{ name: 'Ada' }, { name: 'Grace', role: 'Admiral' }] },
    }) as any
    expect(result.root.nodes).toEqual(['rep__tag__1__tag'])
    expect(result['rep__tag__1__tag'].props.children).toBe('Admiral')
  })

  /**
   * AGL-3496: a repeat with nothing to render publishes NOTHING. Drawn as
   * written, its template is `{{item.name}} — {{item.role}}` on a customer's
   * live page — the broken card a client's services page showed.
   */
  it('renders zero copies for an unknown dataset, no records, or no rows map', () => {
    for (const rows of [{ Other: team }, { Team: { records: [] } }, {}, undefined]) {
      const result = expandRepeatables(baseNodes(), rows)
      const list = result['list'] as any
      expect(list.nodes).toEqual([])
      // The element stays — the frame the author placed — minus its directive.
      expect(list.props).toEqual({})
      expect(result['root']).toEqual(baseNodes()['root'])
    }
  })

  it('renders zero copies when the filter matches nothing', () => {
    const nodes = baseNodes()
    nodes.list.props.repeatFilter = 'role == Pilot'
    const result = expandRepeatables(nodes, { Team: team })
    expect((result['list'] as any).nodes).toEqual([])
    const printed = JSON.stringify(
      (result['list'] as any).nodes.map((id: string) => result[id]),
    )
    expect(printed).not.toContain('{{item.')
  })
})

/**
 * AGL-1440: the predicate that decides whether the datasets read is worth
 * paying for.
 *
 * The tenant compose pipeline fetched every dataset and up to 100 records EACH
 * on every render of every path — up to 5,050 reads — and then handed them to
 * `expandRepeatables`, which returns its input untouched when no node carries
 * `repeatDataset`. So the gate has to be the SAME question `expandRepeatables`
 * asks, or the saving is bought with a page that silently loses its rows.
 *
 * It is exported and used by `expandRepeatables` itself for exactly that
 * reason: two copies of "is this node a repeatable" is how a `.trim()` on one
 * side and not the other becomes an empty list on a customer's page.
 */
describe('hasRepeatableNodes (AGL-1440)', () => {
  it('is true for the tree expandRepeatables would expand', () => {
    expect(hasRepeatableNodes(baseNodes())).toBe(true)
  })

  it('is false for a tree with no repeatDataset anywhere', () => {
    const nodes = baseNodes()
    delete nodes.list.props.repeatDataset
    expect(hasRepeatableNodes(nodes)).toBe(false)
  })

  it('agrees with expandRepeatables on every shape it refuses', () => {
    // The property that makes the gate safe: whenever the predicate says no,
    // expanding with the full dataset map is a no-op. A `repeatDataset` that is
    // blank, whitespace, or not a string is one of those shapes — and each is a
    // way for the two sides to drift apart.
    for (const repeatDataset of ['', '   ', 42, null, undefined, {}]) {
      const nodes = baseNodes()
      nodes.list.props.repeatDataset = repeatDataset
      expect(hasRepeatableNodes(nodes)).toBe(false)
      expect(expandRepeatables(nodes, { Team: team })).toEqual(nodes)
    }
  })

  it('says yes to every repeat the expansion would EMPTY, too (AGL-3496)', () => {
    // A padded key with no rows behind it: the gate must still send it to the
    // expansion, which renders it zero times. Refused here, it would be
    // published as its template, `{{item.*}}` tokens and all.
    const nodes = baseNodes()
    nodes.list.props.repeatDataset = '  Team  '
    expect(hasRepeatableNodes(nodes)).toBe(true)
    expect(repeatKeys(nodes)).toEqual(['Team'])
    expect((expandRepeatables(nodes, {})['list'] as any).nodes).toEqual([])
  })

  it('finds a repeatable grafted in from a reusable component or layout', () => {
    // The gate runs over the COMPOSED tree, not the screen document, because a
    // repeatable can arrive from a layout or a reusable component. A predicate
    // that only looked at the screen would drop those pages' rows.
    const grafted = {
      root: { $id: 'root', componentId: 'div', nodes: ['graft'] },
      graft: {
        $id: 'graft',
        componentId: 'muiStack',
        props: { repeatDataset: 'Team' },
        nodes: [],
      },
    } as any
    expect(hasRepeatableNodes(grafted)).toBe(true)
  })

  it('tolerates an empty or malformed node map', () => {
    expect(hasRepeatableNodes({})).toBe(false)
    expect(hasRepeatableNodes({ a: null } as any)).toBe(false)
    expect(hasRepeatableNodes(undefined as any)).toBe(false)
  })
})

/**
 * The keys the tenant compose reads (AGL-2773): a page loads the datasets it
 * repeats over, by the key each repeat names, so this must return exactly the
 * keys `expandRepeatables` will look up — no more, which costs a read, and no
 * fewer, which renders a template row where the author put a list.
 */
describe('repeatKeys', () => {
  it('names each repeated dataset once, trimmed and sorted', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['a', 'b', 'c'] },
      a: { $id: 'a', componentId: 'muiStack', props: { repeatDataset: 'Team' } },
      b: { $id: 'b', componentId: 'muiStack', props: { repeatDataset: ' Menu ' } },
      c: { $id: 'c', componentId: 'muiStack', props: { repeatDataset: 'Team' } },
    } as any
    expect(repeatKeys(nodes)).toEqual(['Menu', 'Team'])
  })

  it('names nothing for every shape expandRepeatables refuses', () => {
    for (const repeatDataset of ['', '   ', 42, null, undefined, {}]) {
      const nodes = baseNodes()
      nodes.list.props.repeatDataset = repeatDataset
      expect(repeatKeys(nodes)).toEqual([])
    }
  })

  it('agrees with hasRepeatableNodes on the tree it is given', () => {
    expect(repeatKeys(baseNodes()).length > 0).toBe(
      hasRepeatableNodes(baseNodes()),
    )
  })

  it('tolerates an empty or malformed node map', () => {
    expect(repeatKeys({})).toEqual([])
    expect(repeatKeys({ a: null } as any)).toEqual([])
    expect(repeatKeys(undefined)).toEqual([])
  })
})

/**
 * A plugin connection's record is the second thing an element repeats over
 * (AGL-4212): `repeatConnection` names it, and every repeat question keeps
 * going through `repeatKey`, which prefixes it so it never names a dataset's
 * rows.
 */
describe('repeatKey over a plugin connection (AGL-4212)', () => {
  it('reads repeatConnection, prefixed, when no dataset is named', () => {
    expect(
      repeatKey({ props: { repeatConnection: ' aglyn.google-reviews/google ' } }),
    ).toBe('connection:aglyn.google-reviews/google')
    expect(
      repeatKey({ props: { repeatConnection: 'aglyn.google-reviews/google/fields' } }),
    ).toBe('connection:aglyn.google-reviews/google/fields')
  })

  it('keeps the dataset when a node names both', () => {
    expect(
      repeatKey({
        props: { repeatDataset: 'Team', repeatConnection: 'aglyn.google-reviews/google' },
      }),
    ).toBe('Team')
  })

  it('names nothing for an empty or non-text value', () => {
    for (const repeatConnection of ['', '  ', 7, null, {}]) {
      expect(repeatKey({ props: { repeatConnection } })).toBe('')
    }
  })

  it('is a directive the expansion consumes, and repeatKeys lists it', () => {
    const nodes = baseNodes()
    delete nodes.list.props.repeatDataset
    nodes.list.props[REPEAT_CONNECTION_PROP] = 'aglyn.google-reviews/google'
    expect(repeatKeys(nodes)).toEqual(['connection:aglyn.google-reviews/google'])
    expect(hasRepeatableNodes(nodes)).toBe(true)
    expect(withoutRepeatDirective(nodes.list).props).toEqual({})
    const result = expandRepeatables(nodes, {
      'connection:aglyn.google-reviews/google': team,
    })
    const list = result['list'] as any
    expect(list.props[REPEAT_CONNECTION_PROP]).toBeUndefined()
    expect(list.nodes).toHaveLength(2)
    expect((result[(result[list.nodes[1]] as any).nodes[0]] as any).props.children).toBe(
      'Grace — Admiral',
    )
  })

  it('renders no copies when the rows answer nothing under the key', () => {
    const nodes = baseNodes()
    delete nodes.list.props.repeatDataset
    nodes.list.props[REPEAT_CONNECTION_PROP] = 'aglyn.google-reviews/google'
    expect((expandRepeatables(nodes, { Team: team })['list'] as any).nodes).toEqual([])
  })
})

/**
 * `hideUnless` / `hideIf` bound to an `{{item.*}}` token are read per copy
 * (AGL-4212): a review's "owner reply" block (a caption and the reply) is
 * drawn on the reviews that have a reply and left out of the rest.
 */
describe('visibility bound to a record (AGL-4212)', () => {
  const reviewNodes = () =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['list'] },
      list: {
        $id: 'list',
        componentId: 'muiStack',
        props: { repeatConnection: 'aglyn.google-reviews/google' },
        nodes: ['card'],
      },
      card: {
        $id: 'card',
        componentId: 'muiCard',
        parentId: 'list',
        nodes: ['text', 'reply'],
      },
      text: {
        $id: 'text',
        componentId: 'muiTypography',
        parentId: 'card',
        props: { children: '{{item.text}}' },
      },
      reply: {
        $id: 'reply',
        componentId: 'muiBox',
        parentId: 'card',
        props: { hideUnless: '{{item.reply}}' },
        nodes: ['caption', 'replyText'],
      },
      caption: {
        $id: 'caption',
        componentId: 'muiTypography',
        parentId: 'reply',
        props: { children: 'Response from the owner' },
      },
      replyText: {
        $id: 'replyText',
        componentId: 'muiTypography',
        parentId: 'reply',
        props: { children: '{{item.reply}}' },
      },
    }) as any
  const rows = {
    'connection:aglyn.google-reviews/google': {
      records: [
        { $id: '0', text: 'Great service', reply: 'Thank you!' },
        { $id: '1', text: 'Fine' },
        { $id: '2', text: 'Okay', reply: '' },
      ],
    },
  }
  const cardsOf = (result: Record<string, any>) =>
    (result['list'].nodes as string[]).map((id) => result[id])

  it('drops the block and its subtree from a copy whose record leaves it empty', () => {
    const result = expandRepeatables(reviewNodes(), rows) as Record<string, any>
    const [first, second, third] = cardsOf(result)
    expect(first.nodes).toEqual(['rep__list__0__text', 'rep__list__0__reply'])
    expect(second.nodes).toEqual(['rep__list__1__text'])
    expect(third.nodes).toEqual(['rep__list__2__text'])
    expect(result['rep__list__1__caption']).toBeUndefined()
    expect(result['rep__list__1__replyText']).toBeUndefined()
    // Read, so not carried onto the copy that stayed.
    expect(result['rep__list__0__reply'].props.hideUnless).toBeUndefined()
    expect(result['rep__list__0__replyText'].props.children).toBe('Thank you!')
  })

  it('reads hideIf the other way round', () => {
    const nodes = reviewNodes()
    nodes.reply.props = { hideIf: '{{item.reply}}' }
    const [first, second] = cardsOf(expandRepeatables(nodes, rows) as Record<string, any>)
    expect(first.nodes).toEqual(['rep__list__0__text'])
    expect(second.nodes).toEqual(['rep__list__1__text', 'rep__list__1__reply'])
  })

  it('reads a self-scoped copy, and a boolean or number field, the same way', () => {
    const nodes = reviewNodes()
    nodes.list.props = {}
    nodes.card.props = {
      repeatConnection: 'aglyn.google-reviews/google',
      repeatSelf: true,
      hideIf: '{{item.hidden}}',
    }
    const result = expandRepeatables(nodes, {
      'connection:aglyn.google-reviews/google': {
        records: [
          { $id: '0', text: 'Shown', hidden: false },
          { $id: '1', text: 'Hidden', hidden: true },
          { $id: '2', text: 'Zero', hidden: 0 },
        ],
      },
    }) as Record<string, any>
    expect(result['list'].nodes).toEqual(['rep__card__0__card', 'rep__card__2__card'])
  })

  it('leaves a directive bound to anything else alone', () => {
    const nodes = reviewNodes()
    nodes.reply.props = { hideUnless: '{{prop.showReply}}' }
    const [, second] = cardsOf(expandRepeatables(nodes, rows) as Record<string, any>)
    expect(second.nodes).toEqual(['rep__list__1__text', 'rep__list__1__reply'])
  })
})
