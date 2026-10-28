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
 * AGL-2590 — the typed workspace name survives the verification wait, and is
 * refused when the account it was written on has changed hands.
 *
 * The sign-up form asks for an organization name because the name becomes a
 * workspace. Moving the workspace creation to the first verified session means
 * the name has to wait too, and dropping it would silently rename every new
 * workspace to whatever the server derives — a worse regression than the one
 * being fixed. So it is held on `users/{uid}`, which is the only surface that
 * survives a verification click in a different browser.
 *
 * ## The binding these cases exist for
 *
 * `oauth-over-unverified-password.emulator.spec.ts` measures what Identity
 * Platform does when a verified Google sign-in lands on an address an
 * UNVERIFIED password account holds: it takes the account over on the same
 * uid, destroys the password credential and drops the password provider. That
 * is the right answer for the credential — but Firestore is untouched, so a
 * record written by the attacker sits there under the victim's account. Held
 * names are therefore honoured only while the account still holds the provider
 * that wrote them.
 */

const mockRunTransaction = jest.fn()
const mockSetDoc = jest.fn(async () => undefined)
const mockAuthorizedFetch = jest.fn()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  setDoc: (...args: unknown[]) => (mockSetDoc as any)(...args),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))

import {
  claimPendingSignUpWorkspace,
  claimSignUpWorkspace,
  createSignUpWorkspace,
  needsBackstopWorkspace,
  personalWorkspaceName,
  rememberPendingSignUpWorkspace,
  SIGN_UP_WORKSPACE_BACKSTOP_MS,
  SIGN_UP_WORKSPACE_CLAIM_MS,
} from '../utils/signup-workspace'

/** The account document, as the transaction would find it. */
let stored: Record<string, unknown> | null = null

/**
 * A transaction over one in-memory document.
 *
 * Real enough for what is being asserted: the read sees whatever is stored,
 * the write replaces it, and the two happen inside one callback — so a second
 * caller running after the first genuinely finds nothing, which is the whole
 * claim-once property.
 */
const runRealTransaction = async (_firestore: unknown, callback: any) =>
  callback({
    get: async () => ({ data: () => stored ?? undefined }),
    set: (_reference: unknown, value: Record<string, unknown>) => {
      stored = { ...(stored ?? {}), ...value }
    },
  })

const passwordAccount = {
  uid: 'u-1',
  providerData: [{ providerId: 'password' }],
}
const googleAccount = {
  uid: 'u-1',
  providerData: [{ providerId: 'google.com' }],
}

/** The `pendingSignUpWorkspace` values written to `users/{uid}`, in order. */
const holdWrites = () =>
  mockSetDoc.mock.calls
    .filter((call: any) => call[0]?.path === 'users/u-1')
    .map((call: any) => call[1].pendingSignUpWorkspace)

beforeEach(() => {
  jest.clearAllMocks()
  stored = null
  mockRunTransaction.mockImplementation(runRealTransaction)
})

describe('AGL-2590 · holding the name the sign-up form collected', () => {
  it('records the name, whether it was typed, and the provider that wrote it', async () => {
    await rememberPendingSignUpWorkspace({} as any, 'u-1', {
      name: '  Acme Inc  ',
      nameWasTyped: true,
    })
    expect(holdWrites()).toHaveLength(1)
    expect(holdWrites()[0]).toMatchObject({
      name: 'Acme Inc',
      nameWasTyped: true,
      provider: 'password',
    })
    expect(typeof holdWrites()[0].createdAtMs).toBe('number')
  })

  it('writes nothing for an empty name', async () => {
    await rememberPendingSignUpWorkspace({} as any, 'u-1', {
      name: '   ',
      nameWasTyped: true,
    })
    expect(holdWrites()).toHaveLength(0)
  })

  it('never fails the sign-up when the write is refused', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('permission-denied'))
    await expect(
      rememberPendingSignUpWorkspace({} as any, 'u-1', {
        name: 'Acme Inc',
        nameWasTyped: true,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('AGL-2590 · claiming the held name', () => {
  const hold = (over: Record<string, unknown> = {}) => {
    stored = {
      pendingSignUpWorkspace: {
        name: 'Acme Inc',
        nameWasTyped: true,
        provider: 'password',
        createdAtMs: Date.now(),
        ...over,
      },
    }
  }

  it('returns the typed name — someone who typed "Acme Inc" gets Acme Inc', async () => {
    hold()
    expect(
      await claimPendingSignUpWorkspace({} as any, passwordAccount),
    ).toEqual({
      name: 'Acme Inc',
      nameWasTyped: true,
    })
  })

  it('claims ONCE — a second reader finds nothing', async () => {
    hold()
    expect(
      await claimPendingSignUpWorkspace({} as any, passwordAccount),
    ).not.toBeNull()
    // The tab that signed up polls for verification while the tab that clicked
    // the link lands; without this both would create the same workspace.
    expect(
      await claimPendingSignUpWorkspace({} as any, passwordAccount),
    ).toBeNull()
  })

  it('clears with an explicit null, never undefined', async () => {
    // Firestore rejects `undefined`, and a clear that threw would put the same
    // held name in front of every later sign-in.
    hold()
    await claimPendingSignUpWorkspace({} as any, passwordAccount)
    expect(stored?.['pendingSignUpWorkspace']).toBeNull()
  })

  it('⚠️ REFUSES a name whose provider the account no longer holds', async () => {
    // The pre-hijacking case. An attacker signed up as the victim with a
    // password, never verified, and typed a workspace name. Google then took
    // the account over — same uid, password credential destroyed, password
    // provider gone — and this record is all that survived. Honouring it would
    // put the attacker's name on the victim's workspace address.
    hold()
    expect(
      await claimPendingSignUpWorkspace({} as any, googleAccount),
    ).toBeNull()
    // Consumed all the same: a record that has been judged must not be judged
    // again on every future sign-in.
    expect(stored?.['pendingSignUpWorkspace']).toBeNull()
  })

  it('refuses a record that names no provider at all', async () => {
    hold({ provider: undefined })
    expect(
      await claimPendingSignUpWorkspace({} as any, passwordAccount),
    ).toBeNull()
  })

  it('refuses a record older than the verification window', async () => {
    hold({ createdAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000 })
    expect(
      await claimPendingSignUpWorkspace({} as any, passwordAccount),
    ).toBeNull()
  })

  it('answers null when there is nothing held', async () => {
    stored = {}
    expect(
      await claimPendingSignUpWorkspace({} as any, passwordAccount),
    ).toBeNull()
  })

  it('answers null rather than throwing when the read is refused', async () => {
    // A denied or offline read lands the person on the workspace chooser,
    // which is where sign-up landed everyone before AGL-1115 and still offers
    // workspace creation.
    mockRunTransaction.mockRejectedValueOnce(new Error('unavailable'))
    expect(
      await claimPendingSignUpWorkspace({} as any, passwordAccount),
    ).toBeNull()
  })
})

describe('AGL-4079 · one provisioning reader per account', () => {
  it('the reader that takes the held name stands every other reader down, backstop included', async () => {
    stored = {
      pendingSignUpWorkspace: {
        name: 'Acme Inc',
        nameWasTyped: true,
        provider: 'password',
        createdAtMs: Date.now(),
      },
    }
    expect(
      await claimSignUpWorkspace({} as any, passwordAccount, {
        backstop: true,
      }),
    ).toEqual({
      pending: { name: 'Acme Inc', nameWasTyped: true },
      claimedElsewhere: false,
    })
    // The second tab used to fall into the backstop and create a derived second workspace.
    expect(
      await claimSignUpWorkspace({} as any, passwordAccount, {
        backstop: true,
      }),
    ).toEqual({ pending: null, claimedElsewhere: true })
  })

  it('two backstop-only readers make one workspace, not two', async () => {
    stored = {}
    expect(
      await claimSignUpWorkspace({} as any, googleAccount, { backstop: true }),
    ).toEqual({ pending: null, claimedElsewhere: false })
    expect(
      await claimSignUpWorkspace({} as any, googleAccount, { backstop: true }),
    ).toEqual({ pending: null, claimedElsewhere: true })
  })

  it('a reader with nothing to provision writes nothing', async () => {
    stored = {}
    await claimSignUpWorkspace({} as any, googleAccount)
    expect(stored).toEqual({})
  })

  it('a claim older than the window no longer stands anyone down', async () => {
    stored = {
      signUpWorkspaceClaimedAtMs: Date.now() - SIGN_UP_WORKSPACE_CLAIM_MS - 1,
    }
    expect(
      await claimSignUpWorkspace({} as any, googleAccount, { backstop: true }),
    ).toEqual({ pending: null, claimedElsewhere: false })
  })
})

describe('AGL-2590 · creating the workspace', () => {
  it('returns the slug the route granted', async () => {
    mockAuthorizedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ orgId: 'o-1', slug: 'acme-inc' }),
    })
    expect(await createSignUpWorkspace({} as any, 'Acme Inc')).toEqual({
      slug: 'acme-inc',
      error: null,
    })
    expect(mockAuthorizedFetch).toHaveBeenCalledWith(
      {},
      '/api/orgs/create',
      expect.objectContaining({ body: JSON.stringify({ name: 'Acme Inc' }) }),
    )
  })

  it('forwards the refusal copy — it is what a person reads', async () => {
    // The AGL-1523 notice quotes this back on the chooser. A 409 means the
    // address was taken and NOTHING was created, so inventing a suffix here
    // would hand somebody a workspace URL they never chose.
    mockAuthorizedFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'That workspace URL is taken' }),
    })
    expect(await createSignUpWorkspace({} as any, 'Acme Inc')).toEqual({
      slug: null,
      error: 'That workspace URL is taken',
    })
  })

  it('tries a TYPED name once: a taken address is offered back, not suffixed', async () => {
    mockAuthorizedFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'That workspace URL is taken' }),
    })
    await createSignUpWorkspace({} as any, 'Acme Inc')
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
  })

  it('AGL-4024 · retries a DERIVED name once under a suffixed address', async () => {
    // Two people with the same Google display name: the second one's derived
    // address is taken, and nobody chose it, so a suffix costs nobody anything.
    mockAuthorizedFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'That workspace URL is taken' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ orgId: 'o-2', slug: 'acme-inc-x1y2' }),
      })
    expect(
      await createSignUpWorkspace({} as any, 'Acme Inc', { derived: true }),
    ).toEqual({ slug: 'acme-inc-x1y2', error: null })
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(2)
    const retry = JSON.parse(mockAuthorizedFetch.mock.calls[1][2].body)
    expect(retry.name).toBe('Acme Inc')
    expect(retry.slug).toMatch(/^acme-inc-[0-9a-z]{4}$/)
  })

  it('does not retry a derived name for any refusal other than a taken address', async () => {
    mockAuthorizedFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many workspaces' }),
    })
    await createSignUpWorkspace({} as any, 'Acme Inc', { derived: true })
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
  })

  it('reports a thrown request as a failure, not an exception', async () => {
    mockAuthorizedFetch.mockRejectedValue(new Error('offline'))
    expect(await createSignUpWorkspace({} as any, 'Acme Inc')).toEqual({
      slug: null,
      error: null,
    })
  })
})

describe('the zero-workspace backstop (AGL-4021)', () => {
  const now = Date.parse('2026-10-21T22:00:00Z')
  const account = (createdMsAgo: number, emailVerified = true) => ({
    emailVerified,
    metadata: { creationTime: new Date(now - createdMsAgo).toUTCString() },
  })

  it('provisions for a young verified account whose sign-up door died', () => {
    expect(needsBackstopWorkspace(account(60 * 60 * 1000), now)).toBe(true)
  })

  it('never provisions for an unverified account, which waits for verification', () => {
    expect(needsBackstopWorkspace(account(60_000, false), now)).toBe(false)
  })

  it('leaves an older account with no workspaces alone: it left them', () => {
    expect(
      needsBackstopWorkspace(
        account(SIGN_UP_WORKSPACE_BACKSTOP_MS + 60_000),
        now,
      ),
    ).toBe(false)
  })

  it('refuses an account whose creation time cannot be read', () => {
    expect(
      needsBackstopWorkspace({ emailVerified: true, metadata: {} }, now),
    ).toBe(false)
  })

  it('names the workspace as the sign-up door would have', () => {
    expect(
      personalWorkspaceName({ displayName: ' Ashik Ali ', email: 'a@x.io' }),
    ).toBe('Ashik Ali')
    expect(
      personalWorkspaceName({
        displayName: null,
        email: 'sanduc396@gmail.com',
      }),
    ).toBe('sanduc396')
  })
})
