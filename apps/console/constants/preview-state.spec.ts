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
  PREVIEW_STATE_MAX_AGE_MS,
  PREVIEW_STATE_MAX_CHARS,
  previewWindowName,
  prunePreviewStates,
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

describe('prunePreviewStates (AGL-4204)', () => {
  const NOW = 1_800_000_000_000
  const put = (key: string, updatedAt: number, pad = 0) =>
    window.localStorage.setItem(
      key,
      JSON.stringify({ nodes: { x: 'y'.repeat(pad) }, updatedAt }),
    )

  beforeEach(() => window.localStorage.clear())

  it('drops snapshots older than a day and keeps fresh ones', () => {
    put('aglyn:preview:screen:h:old:v', NOW - PREVIEW_STATE_MAX_AGE_MS - 1)
    put('aglyn:preview:screen:h:new:v', NOW - 60_000)
    expect(prunePreviewStates({ now: NOW })).toEqual([
      'aglyn:preview:screen:h:old:v',
    ])
    expect(window.localStorage.getItem('aglyn:preview:screen:h:new:v')).not.toBeNull()
  })

  it('keeps the newest snapshots within the character cap', () => {
    const third = Math.floor(PREVIEW_STATE_MAX_CHARS / 3) - 200
    put('aglyn:preview:screen:h:a:v', NOW - 3_000, third)
    put('aglyn:preview:screen:h:b:v', NOW - 2_000, third)
    put('aglyn:preview:screen:h:c:v', NOW - 1_000, third)
    put('aglyn:preview:screen:h:d:v', NOW, third)
    expect(prunePreviewStates({ now: NOW })).toEqual([
      'aglyn:preview:screen:h:a:v',
    ])
  })

  it('never drops the snapshot being written, and never touches other keys', () => {
    put('aglyn:preview:screen:h:keep:v', NOW - PREVIEW_STATE_MAX_AGE_MS - 1)
    window.localStorage.setItem('aglyn:besigner-draft:x', '{"updatedAt":1}')
    window.localStorage.setItem('firestore_clients_x', '{}')
    expect(
      prunePreviewStates({ now: NOW, keep: 'aglyn:preview:screen:h:keep:v' }),
    ).toEqual([])
    expect(window.localStorage.length).toBe(3)
  })

  it('treats an undated snapshot as oldest', () => {
    window.localStorage.setItem('aglyn:preview:screen:h:bad:v', 'not json')
    expect(prunePreviewStates({ now: NOW })).toEqual([
      'aglyn:preview:screen:h:bad:v',
    ])
  })

  it('reads the date writePreviewState writes, and prunes on every write', () => {
    put('aglyn:preview:screen:h:old:v', Date.now() - PREVIEW_STATE_MAX_AGE_MS - 1)
    const ids: PreviewStateIds = { hostId: 'h', kind: 'screen', docId: 's', versionId: 'v' }
    expect(writePreviewState(ids, nodes)).toBe(true)
    expect(window.localStorage.getItem('aglyn:preview:screen:h:old:v')).toBeNull()
    expect(prunePreviewStates()).toEqual([])
    expect(readPreviewState(ids)?.nodes).toEqual(nodes)
  })

  it('never throws when storage is blocked', () => {
    const storage = {
      get length(): number {
        throw new Error('SecurityError')
      },
      key: () => null,
      getItem: () => null,
      removeItem: () => undefined,
    }
    expect(prunePreviewStates({ storage })).toEqual([])
  })
})
