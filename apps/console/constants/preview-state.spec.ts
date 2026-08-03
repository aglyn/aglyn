/**
 * @jest-environment jsdom
 */
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
  type PreviewStateIds,
  previewStateKey,
  previewWindowName,
  readPreviewState,
  writePreviewState,
} from './preview-state'

const nodes = { _root_: { $id: '_root_' } } as any

describe('preview-state (AGL-1203)', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips a snapshot with its theme', () => {
    const ids: PreviewStateIds = {
      hostId: 'h1',
      kind: 'component',
      docId: 'c1',
      versionId: 'v1',
    }
    writePreviewState(ids, nodes, { fonts: {} } as any)

    const state = readPreviewState(ids)
    expect(state?.nodes).toEqual(nodes)
    expect(state?.theme).toEqual({ fonts: {} })
    expect(typeof state?.updatedAt).toBe('number')
  })

  it('keeps kinds apart when ids collide', () => {
    // Screens, components, layouts and templates are minted from the same id
    // generator into sibling collections, so a shared id is legitimate.
    // Without the kind in the key, previewing one would read the other's draft.
    const shared = { hostId: 'h1', docId: 'same-id', versionId: 'v1' }
    const asComponent = { ...shared, kind: 'component' } as PreviewStateIds
    const asLayout = { ...shared, kind: 'layout' } as PreviewStateIds

    writePreviewState(asComponent, nodes)

    expect(previewStateKey(asComponent)).not.toBe(previewStateKey(asLayout))
    expect(readPreviewState(asComponent)).not.toBeNull()
    expect(readPreviewState(asLayout)).toBeNull()
  })

  it('keys a versionless template without colliding with a versioned doc', () => {
    const template: PreviewStateIds = {
      hostId: 'h1',
      kind: 'template',
      docId: 't1',
    }
    expect(previewStateKey(template)).toBe('aglyn:preview:template:h1:t1:current')
    expect(previewWindowName(template)).toBe('aglyn-preview-template-h1-t1-current')
  })

  it('gives each document its own preview window name', () => {
    const a = previewWindowName({ hostId: 'h', kind: 'screen', docId: 's1', versionId: 'v' })
    const b = previewWindowName({ hostId: 'h', kind: 'screen', docId: 's2', versionId: 'v' })
    expect(a).not.toBe(b)
  })

  it('returns null for junk rather than throwing', () => {
    const ids: PreviewStateIds = { hostId: 'h', kind: 'screen', docId: 's', versionId: 'v' }
    window.localStorage.setItem(previewStateKey(ids), 'not json')
    expect(readPreviewState(ids)).toBeNull()
  })

  it('returns null for a snapshot with no nodes', () => {
    const ids: PreviewStateIds = { hostId: 'h', kind: 'screen', docId: 's', versionId: 'v' }
    window.localStorage.setItem(previewStateKey(ids), JSON.stringify({ updatedAt: 1 }))
    expect(readPreviewState(ids)).toBeNull()
  })
})
