/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { firstVersionSeed, rootOnlyCanvas } from './first-version-seed'

describe('firstVersionSeed', () => {
  it('copies the component design, root and properties under its back-pointer', () => {
    const nodes = { _a: { $id: '_a', componentId: 'div', nodes: [] as string[] } }
    const props = [{ name: 'title', type: 'text' }]
    expect(firstVersionSeed('component', 'c1', 'h1', { nodes, rootId: '_a', props })).toEqual({
      componentId: 'c1',
      hostId: 'h1',
      displayName: 'Initial version',
      nodes,
      rootId: '_a',
      props,
    })
  })

  it('falls back to a root-only canvas for an absent or empty design, never {}', () => {
    expect(firstVersionSeed('component', 'c1', 'h1', { nodes: {} })?.['nodes']).toEqual(rootOnlyCanvas())
    expect(firstVersionSeed('layout', 'l1', 'h1', {})).toEqual({
      layoutId: 'l1',
      hostId: 'h1',
      displayName: 'Initial version',
      nodes: rootOnlyCanvas(),
    })
  })

  it('leaves out empty properties and refuses a kind with no versions', () => {
    expect(firstVersionSeed('component', 'c1', 'h1', { props: [] })).not.toHaveProperty('props')
    expect(firstVersionSeed('template', 't1', 'h1', {})).toBeNull()
  })
})
