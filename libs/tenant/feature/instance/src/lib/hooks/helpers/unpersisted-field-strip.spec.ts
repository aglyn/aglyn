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
 * The unpersisted-field strip at the write boundary (AGL-1429).
 *
 * `useModifyDocCallback` routes a write WITHOUT `merge` / `mergeFields` /
 * `shouldSet` to `updateDoc`, and `updateDoc` never applies the ref's
 * converter. Verified in the SDK rather than assumed — in
 * `@firebase/firestore/dist/index.node.cjs.js`, `setDoc` calls
 * `applyFirestoreDataConverter` and `updateDoc` does not — which is why the
 * mocks below model exactly that asymmetry: the fake `setDoc` runs
 * `ref.converter.toFirestore`, the fake `updateDoc` does not.
 *
 * The consequence `503f197ca` did not survive: the `$id` strip that hook
 * added to `useHostRef`'s `toFirestore` is the ONLY thing standing between a
 * listener-injected `$id` and storage, and it lives somewhere half the
 * writes never reach. `hosts/-MtN17_cpfPPLwWjE6z4` (AGL-1423) is what that
 * looks like once it has happened.
 *
 * So the guarantee cannot live in the converter. These specs pin it at the
 * boundary instead: whichever SDK call the branch picks, a declared
 * unpersisted key does not reach storage.
 */

import { HOST_UNPERSISTED_FIELDS, ORG_UNPERSISTED_FIELDS } from '@aglyn/aglyn'
import { renderHook } from '@testing-library/react'
import { useModifyDocCallback } from './use-modify-doc-callback'

const mockSetDoc = jest.fn()
const mockUpdateDoc = jest.fn()

jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  /**
   * Models `applyFirestoreDataConverter` at index.node.cjs.js:2456 — the
   * converter runs, so the ref's `toFirestore` strip applies.
   */
  setDoc: (ref: FakeRef, data: Record<string, unknown>, options: unknown) =>
    mockSetDoc(ref.converter.toFirestore(data), options),
  /** Models :2462 — no converter call, the payload goes out verbatim. */
  updateDoc: (ref: FakeRef, data: unknown) => mockUpdateDoc(data),
}))

type FakeRef = {
  converter: { toFirestore: (data: Record<string, unknown>) => unknown }
}

/**
 * `useHostRef`'s converter, reproduced. The point of the spec is that this
 * strip is not what protects the document, so it has to be present and
 * correct for the failure to be attributable to the branch rather than to a
 * converter that never stripped in the first place.
 */
const hostRef = {
  converter: {
    toFirestore: (data: Record<string, unknown>) => {
      const { $id, ...rest } = data
      return rest
    },
  },
} as never

/** The payload that actually reached storage, by whichever call. */
function writtenPayload(): Record<string, unknown> {
  const calls = [...mockUpdateDoc.mock.calls, ...mockSetDoc.mock.calls]
  expect(calls).toHaveLength(1)
  return calls[0][0]
}

function modify() {
  return renderHook(() => useModifyDocCallback(hostRef)).result.current
}

describe('unpersisted fields at the write boundary (AGL-1429)', () => {
  beforeEach(() => {
    mockSetDoc.mockClear()
    mockUpdateDoc.mockClear()
  })

  it('a no-merge write does not persist `$id`', async () => {
    // The future call site the issue is about: no options at all, so the
    // branch picks `updateDoc` and the converter never runs.
    await modify()({ $id: 'host-1', displayName: 'Renamed' })

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
    expect(writtenPayload()).not.toHaveProperty('$id')
    // The write itself must still happen — a strip that drops the payload is
    // not a fix.
    expect(writtenPayload()).toMatchObject({ displayName: 'Renamed' })
  })

  it('an explicit `shouldSet` write does not persist `$id` either', async () => {
    await modify()({ $id: 'host-1', displayName: 'Renamed' }, { shouldSet: true })

    expect(writtenPayload()).not.toHaveProperty('$id')
  })

  it('positive control: the nine live call sites already merge, and are clean', async () => {
    // Every current `useHost` consumer passes merge/mergeFields, which is why
    // AGL-1429 is latent. This assertion passes before the fix as well as
    // after — it exists so a red run above cannot be a broken harness.
    await modify()({ $id: 'host-1', logoUrl: '' }, { merge: true })

    expect(mockSetDoc).toHaveBeenCalledTimes(1)
    expect(writtenPayload()).not.toHaveProperty('$id')
  })

  it('negative control: a node map keeps its own `$id` keys', async () => {
    // Besigner nodes really do store `$id`, and AGL-1423's scan drowned in
    // thousands of them. Only the TOP-LEVEL key is a listener artifact.
    await modify()({ $id: 'v1', nodes: { a: { $id: 'a' } } })

    expect(writtenPayload()).not.toHaveProperty('$id')
    expect(writtenPayload().nodes).toEqual({ a: { $id: 'a' } })
  })

  it('negative control: a dotted field path into a map is left alone', async () => {
    await modify()({ 'business.$id': 'keep-me', 'seo.favicon': '' })

    expect(writtenPayload()).toMatchObject({ 'business.$id': 'keep-me' })
  })

  it('the strip is derived from the written-down declarations', async () => {
    // `HOST_UNPERSISTED_FIELDS` / `ORG_UNPERSISTED_FIELDS` are where the
    // invariant is stated, and the boundary strips their INTERSECTION. Add a
    // key to one map alone and the generic hook conservatively keeps writing
    // it; this assertion is what makes that a decision rather than a silence.
    expect(Object.keys(HOST_UNPERSISTED_FIELDS)).toEqual(['$id'])
    expect(Object.keys(ORG_UNPERSISTED_FIELDS)).toEqual(['$id'])
  })
})
