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

const mockGetDoc = jest.fn()
const mockDoc = jest.fn((_db: unknown, ...path: string[]) => path.join('/'))

jest.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => (mockDoc as any)(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}))

import { probePublicRead } from './probe-public-read'

const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
  code: 'permission-denied',
})

describe('probePublicRead', () => {
  beforeEach(() => {
    mockGetDoc.mockReset()
    mockDoc.mockClear()
  })

  it('reads the one unconditionally public collection', async () => {
    // `orgSlugs` is `allow read: if true`. Pointing this at anything else
    // would make a denial ambiguous again, which is the whole thing it
    // exists to resolve.
    mockGetDoc.mockResolvedValue({ exists: () => false })
    await probePublicRead({} as never)
    expect(mockDoc.mock.calls[0][1]).toBe('orgSlugs')
  })

  it('reads a document that does not exist, so it needs no fixture', async () => {
    // A missing document is a SUCCESSFUL read at the rules layer, so the
    // probe cannot be broken by someone renaming or deleting a workspace.
    mockGetDoc.mockResolvedValue({ exists: () => false })
    const result = await probePublicRead({} as never)
    expect(result.outcome).toBe('ok')
    expect(String(mockDoc.mock.calls[0][2])).toContain('probe')
  })

  it('reports OK when the public read succeeds — the session is the problem', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false })
    const result = await probePublicRead({} as never)
    expect(result.outcome).toBe('ok')
    expect(result.hint).toContain('ID token')
  })

  it('reports DENIED when even the public read is refused', async () => {
    // The finding this was built for: the rules allow this unconditionally,
    // so a denial means the request never reached them.
    mockGetDoc.mockRejectedValue(denied)
    const result = await probePublicRead({} as never)
    expect(result.outcome).toBe('denied')
    expect(result.code).toBe('permission-denied')
    expect(result.hint).toContain('App Check')
    // The actionable part: it must say the obvious remedy is the wrong one.
    expect(result.hint).toContain('NOT help')
  })

  it('distinguishes offline from denied', async () => {
    // `unavailable` is a network problem, not a verdict. Calling it App
    // Check would send someone to check enforcement over a dropped wifi.
    mockGetDoc.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'unavailable' }),
    )
    const result = await probePublicRead({} as never)
    expect(result.outcome).toBe('error')
    expect(result.hint).toContain('offline')
  })

  it('never throws, whatever comes back', async () => {
    // It runs inside the banner's diagnostic effect, where an unhandled
    // rejection would take out the only thing telling the user anything.
    mockGetDoc.mockRejectedValue('a bare string')
    await expect(probePublicRead({} as never)).resolves.toMatchObject({
      outcome: 'error',
    })
  })

  it('does not retry — the caller has already waited through five', async () => {
    mockGetDoc.mockRejectedValue(denied)
    await probePublicRead({} as never)
    expect(mockGetDoc).toHaveBeenCalledTimes(1)
  })
})
