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
  providerGrantRevokerFor,
  registerProviderGrantRevoker,
  revokeProviderGrants,
  unregisterProviderGrantRevoker,
  type ProviderGrantRevocation,
} from './provider-grant-revokers'

/**
 * The provider grant revokers an org erasure runs (AGL-2978): best-effort by
 * contract, so the tally is the whole interface — every credential counted
 * exactly once, a revoker that throws counted as failed rather than stopping
 * the run, and a process with no revoker counting every grant as unrevoked
 * rather than as nothing.
 */

const COLLECTION = 'exampleGrants'
const credential = (id: string) => ({ id, data: { orgId: 'org-1' } })

afterEach(() => unregisterProviderGrantRevoker(COLLECTION))

describe('provider grant revokers (AGL-2978)', () => {
  it('counts every credential unrevoked when this process registered no revoker', async () => {
    expect(providerGrantRevokerFor(COLLECTION)).toBeUndefined()
    await expect(
      revokeProviderGrants(COLLECTION, [credential('a'), credential('b')], { erasingOrgId: 'org-1' }),
    ).resolves.toEqual({ revoked: 0, alreadyInvalid: 0, kept: 0, failed: 0, unrevoked: 2 })
  })

  it('tallies each outcome, and keeps going past a revoker that throws', async () => {
    const outcomes: Record<string, ProviderGrantRevocation | 'throw'> = {
      a: 'revoked',
      b: 'already-invalid',
      c: 'kept',
      d: 'failed',
      e: 'throw',
      f: 'revoked',
    }
    const seen: Array<[string, string]> = []
    registerProviderGrantRevoker(COLLECTION, async (entry, context) => {
      seen.push([entry.id, context.erasingOrgId])
      const outcome = outcomes[entry.id]
      if (outcome === 'throw') throw new Error('provider exploded')
      return outcome
    })
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      revokeProviderGrants(COLLECTION, Object.keys(outcomes).map(credential), { erasingOrgId: 'org-1' }),
    ).resolves.toEqual({ revoked: 2, alreadyInvalid: 1, kept: 1, failed: 2, unrevoked: 0 })
    expect(seen.map(([id]) => id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(seen.every(([, orgId]) => orgId === 'org-1')).toBe(true)
    error.mockRestore()
  })

  it('lets a later registration for the same collection replace the earlier one', async () => {
    registerProviderGrantRevoker(COLLECTION, async () => 'failed')
    registerProviderGrantRevoker(COLLECTION, async () => 'revoked')
    await expect(
      revokeProviderGrants(COLLECTION, [credential('a')], { erasingOrgId: 'org-1' }),
    ).resolves.toMatchObject({ revoked: 1, failed: 0 })
  })
})
