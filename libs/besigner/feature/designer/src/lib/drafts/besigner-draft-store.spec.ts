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
  type BesignerDraftIds,
  besignerDraftKey,
  clearBesignerDraft,
  DRAFT_MAX_AGE_MS,
  pruneBesignerDrafts,
  readBesignerDraft,
  writeBesignerDraft,
} from './besigner-draft-store'

const NODES = { root: { $id: 'root', componentId: 'div' } } as never

const screen: BesignerDraftIds = {
  scope: 'host-1',
  kind: 'screen',
  docId: 'screen-1',
  versionId: 'v1',
}

describe('besignerDraftKey', () => {
  // The key is the whole isolation story, so each field gets its own case:
  // a collision here is content from one document appearing in another.
  it('separates versions of the same document', () => {
    expect(besignerDraftKey(screen)).not.toBe(
      besignerDraftKey({ ...screen, versionId: 'v2' }),
    )
  })

  it('separates kinds that share an id generator', () => {
    expect(besignerDraftKey(screen)).not.toBe(
      besignerDraftKey({ ...screen, kind: 'layout' }),
    )
  })

  it('separates hosts', () => {
    expect(besignerDraftKey(screen)).not.toBe(
      besignerDraftKey({ ...screen, scope: 'host-2' }),
    )
  })

  /**
   * The specific trap that ruled out keying on `useBesignerDocument`'s
   * `documentKey`: both email editors build it as
   * `${templateKey}:${versionId}`, so the platform's `order-confirmation`
   * and every host's override of it are the same string.
   */
  it('separates a platform email from a host override of the same key', () => {
    const ids = {
      kind: 'email',
      docId: 'order-confirmation',
      versionId: 'v1',
    } as const
    expect(besignerDraftKey({ ...ids, scope: 'platform' })).not.toBe(
      besignerDraftKey({ ...ids, scope: 'host-1' }),
    )
  })

  it('keys a version-less document distinctly from one called "current"', () => {
    expect(besignerDraftKey({ ...screen, versionId: undefined })).toBe(
      besignerDraftKey({ ...screen, versionId: 'current' }),
    )
  })
})

describe('the draft store', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips nodes and the base stamp', () => {
    writeBesignerDraft(screen, { nodes: NODES, baseStamp: 'ms:10' }, 1_000)
    expect(readBesignerDraft(screen, 1_000)).toEqual({
      nodes: NODES,
      baseStamp: 'ms:10',
      updatedAt: 1_000,
    })
  })

  it('reads nothing for a different version of the same document', () => {
    writeBesignerDraft(screen, { nodes: NODES, baseStamp: null }, 1_000)
    expect(
      readBesignerDraft({ ...screen, versionId: 'v2' }, 1_000),
    ).toBeNull()
  })

  /**
   * One slot per document, latest wins — no list, no history, nothing to
   * choose between. This is the shape that keeps a crash net from being a
   * free imitation of the paid `versioning` feature.
   */
  it('keeps exactly one draft per document', () => {
    writeBesignerDraft(screen, { nodes: NODES, baseStamp: 'ms:1' }, 1_000)
    const second = { root: { $id: 'root', componentId: 'span' } } as never
    writeBesignerDraft(screen, { nodes: second, baseStamp: 'ms:2' }, 2_000)

    const keys = Object.keys(window.localStorage).filter((key) =>
      key.startsWith('aglyn:draft:'),
    )
    expect(keys).toHaveLength(1)
    expect(readBesignerDraft(screen, 2_000)?.nodes).toEqual(second)
  })

  it('drops a draft past its expiry rather than offering it', () => {
    writeBesignerDraft(screen, { nodes: NODES, baseStamp: null }, 0)
    expect(readBesignerDraft(screen, DRAFT_MAX_AGE_MS - 1)).not.toBeNull()
    expect(readBesignerDraft(screen, DRAFT_MAX_AGE_MS + 1)).toBeNull()
    // …and takes it off disk on the way past.
    expect(
      window.localStorage.getItem(besignerDraftKey(screen)),
    ).toBeNull()
  })

  it('discards an unreadable draft instead of throwing', () => {
    window.localStorage.setItem(besignerDraftKey(screen), '{oops')
    expect(readBesignerDraft(screen)).toBeNull()
  })

  it('clears on request', () => {
    writeBesignerDraft(screen, { nodes: NODES, baseStamp: null })
    clearBesignerDraft(screen)
    expect(readBesignerDraft(screen)).toBeNull()
  })

  it('prunes expired drafts across documents', () => {
    writeBesignerDraft(screen, { nodes: NODES, baseStamp: null }, 0)
    writeBesignerDraft(
      { ...screen, docId: 'screen-2' },
      { nodes: NODES, baseStamp: null },
      DRAFT_MAX_AGE_MS,
    )
    const pruned = pruneBesignerDrafts(DRAFT_MAX_AGE_MS + 10)
    expect(pruned).toEqual([besignerDraftKey(screen)])
    expect(
      readBesignerDraft({ ...screen, docId: 'screen-2' }, DRAFT_MAX_AGE_MS),
    ).not.toBeNull()
  })

  it('leaves keys it does not own alone', () => {
    window.localStorage.setItem('aglyn:preview:screen:h:d:v', '{}')
    writeBesignerDraft(screen, { nodes: NODES, baseStamp: null })
    pruneBesignerDrafts(DRAFT_MAX_AGE_MS * 10)
    expect(window.localStorage.getItem('aglyn:preview:screen:h:d:v')).toBe('{}')
  })
})
