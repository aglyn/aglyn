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
 * THE WARNING BEFORE AN UPDATE EATS A CUSTOMIZATION (AGL-2339).
 *
 * All seven install/update routes return `baseStored`, and `provenance.ts`
 * says what a false one means: *"a snapshot that cannot be written leaves
 * `baseStored: false` and an artifact that reports itself as not
 * [mergeable]"*. It reported it to nobody — zero `.tsx` readers.
 *
 * The consequence is silent. `hasDivergedFromBase` needs the base snapshot to
 * tell the publisher's change from the user's; with no base an update can only
 * overwrite. So a user who customizes a large artifact LOSES those changes on
 * the next update, with no prior warning. The update dialog does explain
 * itself when the moment arrives (`preview.mergeable` renders
 * `preview.reason`) — but by then the choice is take-it-or-stay-behind, not
 * "keep a copy first".
 *
 * WHAT THIS FILE HAS TO CATCH, and why it is one file rather than two:
 *
 * The whole chain lives in this lib, so it can be driven end to end. Each test
 * calls the REAL `recordInstallProvenance` to produce `baseStored`, puts that
 * value on the install response, and drives the REAL hook. A writer that
 * returned a constant — in either direction — flips exactly one of the two
 * cases below and dies.
 *
 * A test that asserted `recordInstallProvenance(...).baseStored === false` for
 * oversized content would prove the flag is computed, which was never in
 * doubt: it was computed, serialized, returned over the wire, and dropped.
 */

const enqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
  },
}))

import { act, renderHook } from '@testing-library/react'
import { ARTIFACT_BASE_MAX_BYTES } from '@aglyn/aglyn/app-utils/marketplace-provenance'
import { recordInstallProvenance } from '../server/provenance'
import { useMarketplaceActions } from './use-marketplace-actions'

const LISTING = {
  $id: 'listing-1',
  displayName: 'Fancy Widget',
  type: 'plugin',
}

/**
 * A base-snapshot store.
 *
 * `create` REJECTS on a document that already exists, which is what the real
 * SDK does and what the writer's re-install path depends on — a double that
 * resolved would make every second install report `baseStored: true` without
 * the confirming read ever being exercised.
 */
const bases: Record<string, unknown> = {}
const firestore: any = {
  collection: () => ({
    doc: (id: string) => ({
      create: async (data: unknown) => {
        if (bases[id] !== undefined) throw new Error('ALREADY_EXISTS')
        bases[id] = data
      },
      get: async () => ({ exists: bases[id] !== undefined }),
    }),
  }),
}

/** Content small enough to snapshot, and content that is not. */
const SMALL = { blocks: ['a'.repeat(64)] }
const HUGE = { blocks: ['x'.repeat(ARTIFACT_BASE_MAX_BYTES + 1024)] }

/** Run the REAL provenance writer and hand back what it decided. */
async function baseStoredFor(content: unknown): Promise<boolean> {
  const result = await recordInstallProvenance({
    firestore,
    listingId: 'listing-1',
    listing: { profileId: 'org-1', latestVersion: '2.0.0' },
    version: '2.0.0',
    artifactType: 'component',
    content,
  })
  return result.baseStored
}

function respond(payload: unknown) {
  ;(global as { fetch?: unknown }).fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => payload })
}

const messages = () => enqueueSnackbar.mock.calls.map((call) => String(call[0]))
const said = (needle: string) =>
  messages().some((message) => message.includes(needle))

beforeEach(() => {
  enqueueSnackbar.mockClear()
  for (const key of Object.keys(bases)) delete bases[key]
})

describe('THE CHAIN: what the writer measured is what the user is told', () => {
  it('WARNS when the real writer could not store a base', async () => {
    const baseStored = await baseStoredFor(HUGE)
    // Stated, so a reader can see which branch this test is on without
    // reconstructing `ARTIFACT_BASE_MAX_BYTES` arithmetic in their head.
    expect(baseStored).toBe(false)

    respond({ installed: true, version: '2.0.0', baseStored })
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.install(LISTING)
    })

    expect(said('a future update will REPLACE it')).toBe(true)
    // Named, so the user knows WHICH of several installs this is about.
    expect(said('Fancy Widget')).toBe(true)
    // Advice to act on before editing — it must not vanish unread.
    const warning = enqueueSnackbar.mock.calls.find((call) =>
      String(call[0]).includes('REPLACE'),
    )
    expect(warning?.[1]).toMatchObject({ variant: 'warning', persist: true })
    // …and the install still succeeded. This is a caveat, not a failure.
    expect(said('Installed "Fancy Widget"')).toBe(true)
  })

  it('stays QUIET when the real writer stored one', async () => {
    // The half that makes a constant-returning writer detectable. Without it,
    // `baseStored: false` hardcoded anywhere in the chain passes the test
    // above and puts a frightening, untrue warning on every single install.
    const baseStored = await baseStoredFor(SMALL)
    expect(baseStored).toBe(true)

    respond({ installed: true, version: '2.0.0', baseStored })
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.install(LISTING)
    })

    expect(said('REPLACE')).toBe(false)
    expect(said('Installed "Fancy Widget"')).toBe(true)
  })

  it('still stores a base on RE-INSTALL, and still says nothing', async () => {
    // The content-addressed collection means the second install's `create`
    // rejects with ALREADY_EXISTS and the writer confirms with a read. A
    // writer that treated that rejection as "no base" would warn on every
    // re-install of a perfectly mergeable artifact.
    await baseStoredFor(SMALL)
    const baseStored = await baseStoredFor(SMALL)
    expect(baseStored).toBe(true)

    respond({ installed: true, version: '2.0.0', baseStored })
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.install(LISTING)
    })
    expect(said('REPLACE')).toBe(false)
  })
})

describe('a route that says nothing is not a route that said no', () => {
  it('does not warn when the response omits baseStored entirely', async () => {
    // Silence is not `false`. Warning on a missing field would put the
    // message on every install from any endpoint not yet returning it —
    // unactionable, and it would train people to ignore the one that matters.
    respond({ installed: true, version: '2.0.0' })
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.install(LISTING)
    })
    expect(said('REPLACE')).toBe(false)
  })
})

describe('the fan-out warns ONCE, not once per site', () => {
  it('says it a single time across a multi-site plan', async () => {
    const baseStored = await baseStoredFor(HUGE)
    respond({ installed: true, version: '2.0.0', baseStored })
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.installPlan(LISTING, [
        { scope: 'host', hostId: 'host-1' },
        { scope: 'host', hostId: 'host-2' },
        { scope: 'host', hostId: 'host-3' },
      ] as any)
    })
    // The same artifact everywhere, so the answer is the same on every site;
    // three identical warnings would read as three different problems.
    expect(messages().filter((message) => message.includes('REPLACE'))).toHaveLength(1)
  })
})
