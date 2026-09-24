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
 * `loaded` answers for the member and org asked about NOW (AGL-3320).
 *
 * A caller whose org id resolves after its first render — the CRM resolves
 * it from a site through the host index — used to read the no-org pass's
 * answer, org-wide and loaded, while the member document it needed was still
 * in flight. A scoped collaborator then sent the one unfiltered query the
 * rules refuse whole. The member read is doubled with a promise this file
 * resolves by hand, so the in-flight window is a state the assertions can
 * stand in.
 */

import { act, renderHook } from '@testing-library/react'
import { useScopeTokens } from './use-scope-tokens'

// Stable across renders, as the real services are: the hook re-reads when
// the user or the database changes, and a double that minted a new one on
// every render would be a loop of its own making.
const mockUser = { data: { uid: 'u-1' } }
const mockDb = {}
jest.mock('./firebase/firebase-services', () => ({
  useUser: () => mockUser,
  useFirestore: () => mockDb,
}))

/** The member document each read will answer, once released. */
let pending: Array<(value: unknown) => void> = []
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: () => new Promise((resolve) => pending.push(resolve)),
}))

const member = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data ?? undefined,
})

beforeEach(() => {
  pending = []
})

const release = async (data: Record<string, unknown> | null) => {
  await act(async () => {
    for (const resolve of pending.splice(0)) resolve(member(data))
  })
}

describe('useScopeTokens', () => {
  it('is not loaded until the member document for the org answers', async () => {
    const { result } = renderHook(() => useScopeTokens('org-1'))
    expect(result.current.loaded).toBe(false)
    await release({ role: 'editor', allHosts: false, hostAccess: { 'site-a': true } })
    expect(result.current).toMatchObject({ loaded: true, orgWide: false })
    expect(result.current.tokens).toEqual(expect.arrayContaining(['org', 'host:site-a']))
  })

  it('is NOT loaded while an org id that arrived late is still being read', async () => {
    const { result, rerender } = renderHook(
      ({ orgId }: { orgId?: string }) => useScopeTokens(orgId),
      { initialProps: {} as { orgId?: string } },
    )
    // No org yet: org-wide by default, and settled — nothing to read.
    expect(result.current).toMatchObject({ loaded: true, orgWide: true })

    rerender({ orgId: 'org-1' })
    // The bite: the answer above was for no org, not for this one.
    expect(result.current.loaded).toBe(false)

    await release({ role: 'editor', allHosts: false, hostAccess: { 'site-a': true } })
    expect(result.current).toMatchObject({ loaded: true, orgWide: false })
  })

  it('reads an org-wide member as org-wide', async () => {
    const { result } = renderHook(() => useScopeTokens('org-1'))
    await release({ role: 'owner', allHosts: true })
    expect(result.current).toMatchObject({ loaded: true, orgWide: true })
  })
})
