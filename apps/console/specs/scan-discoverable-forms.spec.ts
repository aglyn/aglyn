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
 * Finding the forms a site already has, and what history each may claim.
 *
 * The paths are the load-bearing part. A historical submission is matched on
 * the PAIR `(formName, path)`, so a form that claims the wrong paths claims
 * the wrong history — and the fan-out is not obvious: a form drawn once in a
 * shared layout renders on every screen using that layout, and one inside a
 * component definition renders wherever that component is placed.
 *
 * A scan that read only the node's own document would give a layout form NO
 * paths, which matches nothing. That is safe but wrong, and it is invisible:
 * the author adopts the form, runs the backfill, and is told its history
 * could not be matched.
 */

import {
  collidingClaims,
  legacyMatchFor,
  scanDiscoverableForms,
} from '../utils/server/scan-discoverable-forms'

const formNodes = (formName: string, extra: Record<string, any> = {}) => ({
  'form-1': {
    $id: 'form-1',
    componentId: 'form',
    props: { formName, ...extra },
    nodes: ['email'],
  },
  email: {
    $id: 'email',
    componentId: 'formField',
    props: { fieldName: 'email', fieldType: 'email' },
  },
})

const instanceNodes = (refId: string) => ({
  'inst-1': {
    $id: 'inst-1',
    componentId: 'reusableInstance',
    props: { refId },
  },
})

describe('a form on a screen claims that screen\'s path', () => {
  it('resolves the path from the routing map', () => {
    const found = scanDiscoverableForms(
      {
        screens: [
          { id: 'screen-1', displayName: 'Contact', nodes: formNodes('Contact') },
        ],
        layouts: [],
        components: [],
      },
      { 'screen-1': '/contact' },
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      sourceKind: 'screen',
      formName: 'Contact',
      paths: ['/contact'],
    })
    expect(found[0]?.fields.map((f) => f.fieldName)).toEqual(['email'])
  })

  it('claims NO path for an unrouted screen', () => {
    // A screen with no route serves no page, so the form on it rendered
    // nowhere and has no history. An empty string would be a path that every
    // pathless submission matched.
    const found = scanDiscoverableForms(
      {
        screens: [{ id: 'screen-1', nodes: formNodes('Contact') }],
        layouts: [],
        components: [],
      },
      {},
    )
    expect(found[0]?.paths).toEqual([])
  })

  it('skips a deleted screen', () => {
    const found = scanDiscoverableForms(
      {
        screens: [
          { id: 'screen-1', deletedAt: 'yes', nodes: formNodes('Contact') },
        ],
        layouts: [],
        components: [],
      },
      { 'screen-1': '/contact' },
    )
    expect(found).toEqual([])
  })
})

describe('a form drawn ONCE claims every page it renders on', () => {
  it('fans a layout form out to every screen using the layout', () => {
    // THE assertion the naive scan fails. One `Form` node, three live pages,
    // and its history is spread across all three.
    const found = scanDiscoverableForms(
      {
        screens: [
          { id: 's1', layoutId: 'layout-1', nodes: {} },
          { id: 's2', layoutId: 'layout-1', nodes: {} },
          { id: 's3', layoutId: 'other', nodes: {} },
        ],
        layouts: [{ id: 'layout-1', nodes: formNodes('Newsletter') }],
        components: [],
      },
      { s1: '/', s2: '/about', s3: '/pricing' },
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.paths).toEqual(['/', '/about'])
  })

  it('fans a component form out to every screen placing it', () => {
    const found = scanDiscoverableForms(
      {
        screens: [
          { id: 's1', nodes: instanceNodes('def-1') },
          { id: 's2', nodes: instanceNodes('def-1') },
          { id: 's3', nodes: {} },
        ],
        layouts: [],
        components: [{ id: 'def-1', nodes: formNodes('Contact') }],
      },
      { s1: '/contact', s2: '/support', s3: '/pricing' },
    )
    expect(found[0]?.paths).toEqual(['/contact', '/support'])
  })

  it('sorts and dedupes the paths', () => {
    // `legacyMatch.paths` is compared by membership, so ordering is only for
    // a stable document; duplicates would be a claim counted twice.
    const found = scanDiscoverableForms(
      {
        screens: [
          { id: 's1', layoutId: 'layout-1', nodes: {} },
          { id: 's2', layoutId: 'layout-1', nodes: {} },
        ],
        layouts: [{ id: 'layout-1', nodes: formNodes('Newsletter') }],
        components: [],
      },
      { s1: '/b', s2: '/b' },
    )
    expect(found[0]?.paths).toEqual(['/b'])
  })
})

describe('an already-adopted form is reported, not hidden', () => {
  it('carries its formId through', () => {
    // Dropping bound forms would render a site that had adopted everything as
    // a site with no forms.
    const found = scanDiscoverableForms(
      {
        screens: [
          { id: 's1', nodes: formNodes('Contact', { formId: 'form-abc' }) },
        ],
        layouts: [],
        components: [],
      },
      { s1: '/contact' },
    )
    expect(found[0]?.formId).toBe('form-abc')
  })
})

describe('what an adoption would claim', () => {
  it('is the caption and the paths, together', () => {
    const [form] = scanDiscoverableForms(
      {
        screens: [{ id: 's1', nodes: formNodes('Contact') }],
        layouts: [],
        components: [],
      },
      { s1: '/contact' },
    )
    expect(legacyMatchFor(form as any)).toEqual({
      formName: 'Contact',
      paths: ['/contact'],
    })
  })

  it('names a collision BEFORE the backfill silently refuses to split it', () => {
    // Two forms on one page sharing a caption make every historical
    // submission on that pair ambiguous, so the backfill stamps NONE of them.
    // That is the safe outcome and a silent one: the author would adopt both,
    // run the migration, and be told only that N rows did not match.
    const found = scanDiscoverableForms(
      {
        screens: [
          {
            id: 's1',
            nodes: {
              ...formNodes('Contact'),
              'form-2': {
                $id: 'form-2',
                componentId: 'form',
                props: { formName: 'Contact' },
              },
            },
          },
        ],
        layouts: [],
        components: [],
      },
      { s1: '/contact' },
    )
    expect(collidingClaims(found)).toEqual([
      { formName: 'Contact', path: '/contact', nodeIds: ['form-1', 'form-2'] },
    ])
  })

  it('reports no collision for two forms on DIFFERENT pages', () => {
    const found = scanDiscoverableForms(
      {
        screens: [
          { id: 's1', nodes: formNodes('Contact') },
          { id: 's2', nodes: formNodes('Contact') },
        ],
        layouts: [],
        components: [],
      },
      { s1: '/contact', s2: '/support' },
    )
    expect(collidingClaims(found)).toEqual([])
  })
})
