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

import { findUserByUidAcrossPools } from './auth-pools'
import {
  readHeldSignUpWorkspaceName,
  settleHeldSignUpWorkspace,
} from './signup-held-workspace'

jest.mock('./auth-pools', () => ({ findUserByUidAcrossPools: jest.fn() }))
jest.mock('./firebase-admin', () => ({ __esModule: true, default: {} }))

const set = jest.fn(async () => undefined)
const firestoreHolding = (held: unknown) =>
  ({
    doc: () => ({ get: async () => ({ get: () => held }), set }),
  }) as unknown as FirebaseFirestore.Firestore

const fresh = {
  name: ' Specialty Alloys ',
  nameWasTyped: true,
  provider: 'password',
  createdAtMs: Date.now() - 60_000,
}
const holdsProviders = (...ids: string[]) =>
  (findUserByUidAcrossPools as jest.Mock).mockResolvedValue({
    record: { providerData: ids.map((providerId) => ({ providerId })) },
    tenantId: null,
  })

describe('AGL-4117 · reading a held sign-up name on the server', () => {
  beforeEach(() => holdsProviders('password'))

  it('returns a typed, fresh name the account can still honor', async () => {
    expect(
      await readHeldSignUpWorkspaceName('u', firestoreHolding(fresh)),
    ).toBe('Specialty Alloys')
  })

  it.each([
    ['nothing held', null],
    ['a derived name', { ...fresh, nameWasTyped: false }],
    ['an expired hold', { ...fresh, createdAtMs: 1 }],
    ['no provider', { ...fresh, provider: '' }],
  ])('returns null for %s', async (_label, held) => {
    expect(
      await readHeldSignUpWorkspaceName('u', firestoreHolding(held)),
    ).toBeNull()
  })

  it('refuses a hold written by a provider the account lost', async () => {
    holdsProviders('google.com')
    expect(
      await readHeldSignUpWorkspaceName('u', firestoreHolding(fresh)),
    ).toBeNull()
  })

  it('answers null instead of throwing when the read fails', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = {
      doc: () => ({
        get: async () => {
          throw new Error('offline')
        },
      }),
    } as unknown as FirebaseFirestore.Firestore
    expect(await readHeldSignUpWorkspaceName('u', broken)).toBeNull()
    error.mockRestore()
  })

  it('spends the hold the way the browser claim does', async () => {
    await settleHeldSignUpWorkspace('u', firestoreHolding(fresh))
    expect(set).toHaveBeenCalledWith(
      {
        pendingSignUpWorkspace: null,
        signUpWorkspaceClaimedAtMs: expect.any(Number),
      },
      { merge: true },
    )
  })
})
