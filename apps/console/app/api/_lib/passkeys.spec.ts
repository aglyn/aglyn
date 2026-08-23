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
 * The WebAuthn crypto layer is MOCKED throughout: these specs pin the
 * lifecycle around it — challenge single-use + expiry, uid binding, the
 * signCount clone check, and that a minted identity can only come from the
 * server-written credential index — not COSE signature math, which is
 * @simplewebauthn/server's job and test suite.
 */
const mockGenerateRegistrationOptions = jest.fn(async () => ({
  challenge: 'reg-challenge',
  rp: { id: 'aglyn.com', name: 'Aglyn' },
}))
const mockVerifyRegistrationResponse = jest.fn()
const mockGenerateAuthenticationOptions = jest.fn(async () => ({
  challenge: 'auth-challenge',
  rpId: 'aglyn.com',
}))
const mockVerifyAuthenticationResponse = jest.fn()
jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...args: unknown[]) =>
    mockGenerateRegistrationOptions(...(args as [])),
  verifyRegistrationResponse: (...args: unknown[]) =>
    mockVerifyRegistrationResponse(...(args as [])),
  generateAuthenticationOptions: (...args: unknown[]) =>
    mockGenerateAuthenticationOptions(...(args as [])),
  verifyAuthenticationResponse: (...args: unknown[]) =>
    mockVerifyAuthenticationResponse(...(args as [])),
}))

/**
 * The barrel, narrowed to the one export this module now uses (AGL-1902).
 *
 * `passkeys.ts` reaches `consumeOnce` through `@aglyn/tenant-data-admin`, and
 * importing that barrel here drags `next/cache` into this environment, where
 * it fails to load and takes the whole suite with it — a suite that fails to
 * LOAD reports nothing about the code it was written for.
 *
 * `requireActual` on the module itself, never a hand-written stand-in: single
 * use is the property under test, and a fake `consumeOnce` would assert it
 * into existence. The relative path is deliberate — a literal
 * `@aglyn/...` specifier inside a mock factory registers a DYNAMIC nx graph
 * edge and reddens `console:lint` across every static importer (AGL-949).
 */
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  consumeOnce: jest.requireActual(
    '../../../../../libs/tenant/data/admin/src/lib/server/consume-once',
  ).consumeOnce,
}))

import {
  CHALLENGE_TTL_MS,
  createAuthenticationOptions,
  createRegistrationOptions,
  deletePasskey,
  PasskeyError,
  resolveRpContext,
  verifyAndStoreRegistration,
  verifyAssertion,
} from './passkeys'

const NOW = Date.UTC(2026, 7, 8, 20, 0)

/**
 * In-memory Firestore: a flat map of slash-joined paths, with just the doc
 * get/set/delete, subcollection list and transaction surface the module
 * touches. Transactions run non-concurrently here, which is fine — the specs
 * assert the *observable* single-use property (a consumed challenge is gone),
 * not Firestore's isolation guarantees.
 */
function memoryFirestore(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(seed))
  const docRef = (path: string) => ({
    path,
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
      docs.set(path, opts?.merge ? { ...docs.get(path), ...data } : { ...data })
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  // Captures the data AT READ TIME, like a real Firestore snapshot — a
  // lazy closure here would read back `undefined` after the transaction's
  // own delete, which real snapshots never do.
  const snapshotOf = (path: string) => {
    const data = docs.get(path)
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    get: async () => {
      const entries = [...docs.entries()].filter(([key]) => {
        if (!key.startsWith(`${path}/`)) return false
        return !key.slice(path.length + 1).includes('/')
      })
      return {
        size: entries.length,
        docs: entries.map(([key, value]) => ({
          id: key.slice(path.length + 1),
          data: () => value,
        })),
      }
    },
  })
  const firestore = {
    collection: (name: string) => collectionRef(name),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (ref: { path: string }) => snapshotOf(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          docs.set(ref.path, { ...data })
        },
        delete: (ref: { path: string }) => {
          docs.delete(ref.path)
        },
      }
      return fn(tx)
    },
    _docs: docs,
  }
  return firestore as any
}

const ORIGIN = 'https://app.aglyn.com'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('resolveRpContext', () => {
  it('uses the registrable parent as RP ID for every aglyn.com origin', () => {
    // The AGL-627 constraint: one credential must serve apex, app., and
    // future {slug}. subdomains — so all of them resolve to rpID aglyn.com.
    for (const origin of [
      'https://aglyn.com',
      'https://app.aglyn.com',
      'https://some-workspace.aglyn.com',
    ]) {
      expect(resolveRpContext(origin)).toEqual({
        rpID: 'aglyn.com',
        origin,
      })
    }
  })

  it('carves out localhost for development only', () => {
    expect(resolveRpContext('http://localhost:4200')).toEqual({
      rpID: 'localhost',
      origin: 'http://localhost:4200',
    })
  })

  it('refuses foreign, insecure and absent origins', () => {
    expect(resolveRpContext('https://evil.example.com')).toBeNull()
    expect(resolveRpContext('http://app.aglyn.com')).toBeNull()
    expect(resolveRpContext('https://aglyn.com.evil.example')).toBeNull()
    expect(resolveRpContext(null)).toBeNull()
    expect(resolveRpContext('not a url')).toBeNull()
  })
})

describe('registration ceremony', () => {
  it('stores a uid-bound challenge with the options', async () => {
    const firestore = memoryFirestore()
    const { challengeId, options } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: 'a@b.co',
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    expect((options as { challenge: string }).challenge).toBe('reg-challenge')
    const stored = firestore._docs.get(`webauthnChallenges/${challengeId}`)
    expect(stored).toMatchObject({
      type: 'register',
      uid: 'user-1',
      challenge: 'reg-challenge',
    })
  })

  it('refuses a disallowed origin before touching anything', async () => {
    const firestore = memoryFirestore()
    await expect(
      createRegistrationOptions({
        firestore,
        uid: 'user-1',
        email: null,
        originHeader: 'https://evil.example.com',
      }),
    ).rejects.toThrow(new PasskeyError('bad-origin'))
    expect(firestore._docs.size).toBe(0)
  })

  it('verifies, stores the credential AND the reverse index atomically', async () => {
    mockVerifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 5,
          transports: ['internal'],
        },
      },
    })
    const firestore = memoryFirestore()
    const { challengeId } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: 'a@b.co',
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    const stored = await verifyAndStoreRegistration({
      firestore,
      uid: 'user-1',
      originHeader: ORIGIN,
      challengeId,
      response: { id: 'cred-1' } as never,
      label: '  My MacBook  ',
      nowMs: NOW,
    })
    expect(stored.label).toBe('My MacBook')
    expect(firestore._docs.get('users/user-1/passkeys/cred-1')).toMatchObject({
      credentialId: 'cred-1',
      signCount: 5,
      transports: ['internal'],
    })
    expect(firestore._docs.get('passkeyCredentialIndex/cred-1')).toMatchObject({
      uid: 'user-1',
    })
    // The challenge is consumed — gone, not just checked.
    expect(firestore._docs.has(`webauthnChallenges/${challengeId}`)).toBe(false)
  })

  it('a challenge is SINGLE-USE: the second verify with the same id fails', async () => {
    mockVerifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1]),
          counter: 0,
          transports: [],
        },
      },
    })
    const firestore = memoryFirestore()
    const { challengeId } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: null,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    const params = {
      firestore,
      uid: 'user-1',
      originHeader: ORIGIN,
      challengeId,
      response: { id: 'cred-1' } as never,
      nowMs: NOW,
    }
    await verifyAndStoreRegistration(params)
    await expect(verifyAndStoreRegistration(params)).rejects.toThrow(
      new PasskeyError('challenge-invalid'),
    )
  })

  it('an EXPIRED challenge is refused (and still consumed)', async () => {
    const firestore = memoryFirestore()
    const { challengeId } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: null,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    await expect(
      verifyAndStoreRegistration({
        firestore,
        uid: 'user-1',
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW + CHALLENGE_TTL_MS + 1,
      }),
    ).rejects.toThrow(new PasskeyError('challenge-invalid'))
    expect(firestore._docs.has(`webauthnChallenges/${challengeId}`)).toBe(false)
    expect(mockVerifyRegistrationResponse).not.toHaveBeenCalled()
  })

  it("another user's registration challenge does not verify for this uid", async () => {
    const firestore = memoryFirestore()
    const { challengeId } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: null,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    await expect(
      verifyAndStoreRegistration({
        firestore,
        uid: 'user-2',
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('challenge-invalid'))
  })

  it('a failed library verification stores nothing', async () => {
    mockVerifyRegistrationResponse.mockResolvedValue({ verified: false })
    const firestore = memoryFirestore()
    const { challengeId } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: null,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    await expect(
      verifyAndStoreRegistration({
        firestore,
        uid: 'user-1',
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('verification-failed'))
    expect(firestore._docs.has('users/user-1/passkeys/cred-1')).toBe(false)
    expect(firestore._docs.has('passkeyCredentialIndex/cred-1')).toBe(false)
  })

  it('a library throw (malformed attestation) maps to verification-failed', async () => {
    mockVerifyRegistrationResponse.mockRejectedValue(new Error('bad CBOR'))
    const firestore = memoryFirestore()
    const { challengeId } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: null,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    await expect(
      verifyAndStoreRegistration({
        firestore,
        uid: 'user-1',
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('verification-failed'))
  })

  it('an already-registered credential id is refused, not re-owned', async () => {
    mockVerifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1]),
          counter: 0,
          transports: [],
        },
      },
    })
    const firestore = memoryFirestore({
      'passkeyCredentialIndex/cred-1': { uid: 'someone-else' },
    })
    const { challengeId } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: null,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    await expect(
      verifyAndStoreRegistration({
        firestore,
        uid: 'user-1',
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('credential-exists'))
    expect(firestore._docs.get('passkeyCredentialIndex/cred-1')).toEqual({
      uid: 'someone-else',
    })
  })

  it('excludes existing credentials and enforces the per-user cap', async () => {
    const seed: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < 10; i += 1) {
      seed[`users/user-1/passkeys/cred-${i}`] = {
        credentialId: `cred-${i}`,
        transports: [],
      }
    }
    await expect(
      createRegistrationOptions({
        firestore: memoryFirestore(seed),
        uid: 'user-1',
        email: null,
        originHeader: ORIGIN,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('limit-reached'))
  })
})

describe('sign-in ceremony', () => {
  const seededCredential = {
    'users/user-1/passkeys/cred-1': {
      credentialId: 'cred-1',
      publicKey: Buffer.from([9, 9]).toString('base64url'),
      signCount: 10,
      transports: ['internal'],
      label: 'MacBook',
      createdAt: NOW - 1000,
      lastUsedAt: null,
    },
    'passkeyCredentialIndex/cred-1': { uid: 'user-1' },
  }

  async function seededChallenge(firestore: any) {
    const { challengeId } = await createAuthenticationOptions({
      firestore,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    return challengeId
  }

  it('resolves the uid from the server-written index and verifies', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 11 },
    })
    const firestore = memoryFirestore(seededCredential)
    const challengeId = await seededChallenge(firestore)
    const assertion = await verifyAssertion({
      firestore,
      originHeader: ORIGIN,
      challengeId,
      response: { id: 'cred-1' } as never,
      nowMs: NOW,
    })
    expect(assertion).toEqual({
      uid: 'user-1',
      credentialId: 'cred-1',
      label: 'MacBook',
    })
    // The stored public key — not anything client-sent — fed verification.
    expect(mockVerifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'auth-challenge',
        expectedOrigin: ORIGIN,
        expectedRPID: 'aglyn.com',
        credential: expect.objectContaining({ counter: 10 }),
      }),
    )
    // signCount advanced and lastUsedAt stamped.
    expect(firestore._docs.get('users/user-1/passkeys/cred-1')).toMatchObject({
      signCount: 11,
      lastUsedAt: NOW,
    })
  })

  it('an unknown credential id never reaches the crypto layer', async () => {
    const firestore = memoryFirestore()
    const challengeId = await seededChallenge(firestore)
    await expect(
      verifyAssertion({
        firestore,
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-unknown' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('credential-unknown'))
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled()
  })

  it('an index doc pointing at a missing credential doc is refused', async () => {
    // The index alone must never be enough to mint — the credential doc
    // (public key and all) is the authority.
    const firestore = memoryFirestore({
      'passkeyCredentialIndex/cred-1': { uid: 'user-1' },
    })
    const challengeId = await seededChallenge(firestore)
    await expect(
      verifyAssertion({
        firestore,
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('credential-unknown'))
  })

  it('a sign-in challenge is single-use across attempts', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 11 },
    })
    const firestore = memoryFirestore(seededCredential)
    const challengeId = await seededChallenge(firestore)
    const params = {
      firestore,
      originHeader: ORIGIN,
      challengeId,
      response: { id: 'cred-1' } as never,
      nowMs: NOW,
    }
    await verifyAssertion(params)
    await expect(verifyAssertion(params)).rejects.toThrow(
      new PasskeyError('challenge-invalid'),
    )
  })

  it('a registration challenge cannot be spent on sign-in', async () => {
    const firestore = memoryFirestore(seededCredential)
    const { challengeId } = await createRegistrationOptions({
      firestore,
      uid: 'user-1',
      email: null,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    await expect(
      verifyAssertion({
        firestore,
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('challenge-invalid'))
  })

  it('a bad signature refuses and leaves the credential untouched', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValue({ verified: false })
    const firestore = memoryFirestore(seededCredential)
    const challengeId = await seededChallenge(firestore)
    await expect(
      verifyAssertion({
        firestore,
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('verification-failed'))
    expect(firestore._docs.get('users/user-1/passkeys/cred-1')).toMatchObject({
      signCount: 10,
      lastUsedAt: null,
    })
  })

  it('a signCount REGRESSION is treated as cloning: refused and flagged', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 4 }, // stored is 10 — went backwards
    })
    const firestore = memoryFirestore(seededCredential)
    const challengeId = await seededChallenge(firestore)
    await expect(
      verifyAssertion({
        firestore,
        originHeader: ORIGIN,
        challengeId,
        response: { id: 'cred-1' } as never,
        nowMs: NOW,
      }),
    ).rejects.toThrow(new PasskeyError('credential-cloned'))
    expect(firestore._docs.get('users/user-1/passkeys/cred-1')).toMatchObject({
      suspectedCloneAt: NOW,
      signCount: 10,
    })
  })

  it('authenticators that never count (0 → 0) are accepted', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    })
    const firestore = memoryFirestore({
      ...seededCredential,
      'users/user-1/passkeys/cred-1': {
        ...seededCredential['users/user-1/passkeys/cred-1'],
        signCount: 0,
      },
    })
    const challengeId = await seededChallenge(firestore)
    const assertion = await verifyAssertion({
      firestore,
      originHeader: ORIGIN,
      challengeId,
      response: { id: 'cred-1' } as never,
      nowMs: NOW,
    })
    expect(assertion.uid).toBe('user-1')
  })
})

/**
 * The clone flag ENFORCES, and a passkey can be revoked (AGL-1881).
 *
 * ## What was wrong
 *
 * `suspectedCloneAt` was written on a signCount regression and read by
 * nothing. It was a note, not a control — while the management card rendered
 * the row as **"Blocked — possible credential copy"** and the sign-in error
 * told the user the passkey "was refused for security reasons".
 *
 * The counter check on its own does not survive the attack it is named
 * after. A cloned authenticator that increments normally is refused a few
 * times and then simply catches up past the stored count; one whose counter
 * is attacker-chosen is accepted on the first try and pushes the stored
 * count so far ahead that the LEGITIMATE device becomes the one that gets
 * flagged. One regression is the only signal there will ever be, so
 * discarding it after a single refusal discards the detection.
 *
 * ## Why the two land together
 *
 * A refusal that cannot be cleared is a worse product than one that never
 * claimed to block anything: before this, the credential store was
 * server-write-only with NO delete endpoint, so a flagged credential — or a
 * stolen laptop's — could not be taken off the account at all. Enforcement
 * and revocation are one change for that reason.
 */
describe('a flagged credential is REFUSED, not merely noted (AGL-1881)', () => {
  const flagged = {
    'users/user-1/passkeys/cred-1': {
      credentialId: 'cred-1',
      publicKey: Buffer.from([9, 9]).toString('base64url'),
      signCount: 10,
      transports: ['internal'],
      label: 'MacBook',
      createdAt: NOW - 1000,
      lastUsedAt: null,
      suspectedCloneAt: NOW - 500,
    },
    'passkeyCredentialIndex/cred-1': { uid: 'user-1' },
  }

  async function attempt(firestore: any) {
    const { challengeId } = await createAuthenticationOptions({
      firestore,
      originHeader: ORIGIN,
      nowMs: NOW,
    })
    return verifyAssertion({
      firestore,
      originHeader: ORIGIN,
      challengeId,
      response: { id: 'cred-1' } as never,
      nowMs: NOW,
    })
  }

  it('refuses a flagged credential whose counter has since caught up', async () => {
    // THE attack the old code lost to: the clone increments normally, so a
    // few refusals later its counter is past the stored one and every check
    // passes. `newCounter: 99` is what "caught up" looks like.
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 99 },
    })
    await expect(attempt(memoryFirestore(flagged))).rejects.toThrow(
      new PasskeyError('credential-cloned'),
    )
  })

  it('refuses BEFORE the signature check — the flag is not a tie-breaker', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 99 },
    })
    await expect(attempt(memoryFirestore(flagged))).rejects.toThrow(
      PasskeyError,
    )
    // A flagged credential must not reach the crypto layer at all: whoever
    // is presenting it, we have already decided we do not trust it.
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled()
  })

  it('does not touch the credential — the flag is not consumed by refusing', async () => {
    // If a refusal cleared the flag, the attacker's second attempt would be
    // treated as a fresh credential. It stays flagged until the OWNER
    // removes it.
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 99 },
    })
    const firestore = memoryFirestore(flagged)
    await expect(attempt(firestore)).rejects.toThrow(PasskeyError)
    expect(firestore._docs.get('users/user-1/passkeys/cred-1')).toMatchObject({
      suspectedCloneAt: NOW - 500,
      signCount: 10,
      lastUsedAt: null,
    })
  })

  it('leaves an UNFLAGGED credential working — the negative control', async () => {
    // Without this the enforcement could be "refuse everything" and every
    // assertion above would still pass.
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 11 },
    })
    const clean = {
      ...flagged,
      'users/user-1/passkeys/cred-1': {
        ...flagged['users/user-1/passkeys/cred-1'],
        suspectedCloneAt: undefined,
      },
    }
    delete (clean['users/user-1/passkeys/cred-1'] as any).suspectedCloneAt
    const assertion = await attempt(memoryFirestore(clean))
    expect(assertion.uid).toBe('user-1')
  })
})

describe('deletePasskey — the revocation path that did not exist (AGL-1881)', () => {
  const seeded = () => ({
    'users/user-1/passkeys/cred-1': {
      credentialId: 'cred-1',
      publicKey: Buffer.from([9, 9]).toString('base64url'),
      signCount: 10,
      transports: ['internal'],
      label: 'MacBook',
      createdAt: NOW - 1000,
      lastUsedAt: null,
    },
    'passkeyCredentialIndex/cred-1': { uid: 'user-1' },
    // A second user's credential, for the cross-account case.
    'users/user-2/passkeys/cred-2': { credentialId: 'cred-2', label: 'Theirs' },
    'passkeyCredentialIndex/cred-2': { uid: 'user-2' },
  })

  it('removes the credential AND its reverse index', async () => {
    // Both, or the id stays claimed: `verifyAndStoreRegistration` refuses a
    // credential id the index already holds, so a half-delete would stop the
    // owner re-registering the SAME authenticator — which is exactly what
    // someone does after a false-positive clone flag.
    const firestore = memoryFirestore(seeded())
    const result = await deletePasskey({
      firestore,
      uid: 'user-1',
      credentialId: 'cred-1',
    })
    expect(result).toEqual({ removed: true, label: 'MacBook' })
    expect(firestore._docs.has('users/user-1/passkeys/cred-1')).toBe(false)
    expect(firestore._docs.has('passkeyCredentialIndex/cred-1')).toBe(false)
  })

  it('refuses to touch ANOTHER account’s credential', async () => {
    // The whole security of this function. The credential document is
    // uid-pathed and so unreachable across accounts — but the INDEX is a
    // top-level collection keyed only by credential id, so without the
    // ownership check a signed-in user could delete a stranger's index row
    // and lock them out of a sign-in method.
    const firestore = memoryFirestore(seeded())
    await expect(
      deletePasskey({ firestore, uid: 'user-1', credentialId: 'cred-2' }),
    ).rejects.toThrow(new PasskeyError('credential-unknown'))
    expect(firestore._docs.has('passkeyCredentialIndex/cred-2')).toBe(true)
    expect(firestore._docs.has('users/user-2/passkeys/cred-2')).toBe(true)
  })

  it('leaves every OTHER credential of the same user alone', async () => {
    const firestore = memoryFirestore({
      ...seeded(),
      'users/user-1/passkeys/cred-3': { credentialId: 'cred-3', label: 'Yubi' },
      'passkeyCredentialIndex/cred-3': { uid: 'user-1' },
    })
    await deletePasskey({ firestore, uid: 'user-1', credentialId: 'cred-1' })
    expect(firestore._docs.has('users/user-1/passkeys/cred-3')).toBe(true)
    expect(firestore._docs.has('passkeyCredentialIndex/cred-3')).toBe(true)
  })

  it('is IDEMPOTENT — a second removal reports it, rather than failing', async () => {
    const firestore = memoryFirestore(seeded())
    await deletePasskey({ firestore, uid: 'user-1', credentialId: 'cred-1' })
    expect(
      await deletePasskey({
        firestore,
        uid: 'user-1',
        credentialId: 'cred-1',
      }),
    ).toEqual({ removed: false, label: null })
  })

  it('CLEARS a clone flag by removing the credential, so the user is not stuck', async () => {
    // The escape hatch that makes the refusal above acceptable: the owner
    // removes the flagged credential and registers the device again.
    const firestore = memoryFirestore({
      ...seeded(),
      'users/user-1/passkeys/cred-1': {
        credentialId: 'cred-1',
        label: 'MacBook',
        signCount: 10,
        suspectedCloneAt: NOW - 500,
      },
    })
    await deletePasskey({ firestore, uid: 'user-1', credentialId: 'cred-1' })
    // Nothing is left holding the id, so re-registration is not refused with
    // `credential-exists`.
    expect(firestore._docs.has('passkeyCredentialIndex/cred-1')).toBe(false)
  })

  it('refuses an empty credential id rather than sweeping', async () => {
    const firestore = memoryFirestore(seeded())
    await expect(
      deletePasskey({ firestore, uid: 'user-1', credentialId: '' }),
    ).rejects.toThrow(new PasskeyError('credential-unknown'))
    expect(firestore._docs.has('users/user-1/passkeys/cred-1')).toBe(true)
  })
})
