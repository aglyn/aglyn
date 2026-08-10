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
 * The serve half of AGL-1383.
 *
 * `countBillableScreens` subtracts soft-deleted and `kind: 'email'` screens
 * from `screensPerHost`, and both are ordinary client-writable fields on the
 * screen's own document. Nothing on the serve path used to read either, so one
 * `updateDoc` took a page off a Free plan's five and left it live — the host's
 * routing map still pointed at it, this function still returned it, and the
 * page still rendered. An exclusion is only sound if an excluded screen
 * genuinely is not a page; these hold that agreement down from the serve side.
 */

const screenDoc: { fields: Record<string, unknown> | null } = { fields: null }

const docGet = jest.fn(async () => ({
  exists: screenDoc.fields !== null,
  data: () => ({ ...screenDoc.fields }),
}))

/** Path recorder, so a passing assertion also proves we read the right doc. */
const readPath: Array<string> = []
const firestore = {
  collection: (name: string) => {
    readPath.push(name)
    return {
      doc: (id: string) => {
        readPath.push(id)
        return {
          collection: (sub: string) => {
            readPath.push(sub)
            return {
              withConverter: () => ({
                doc: (screenId: string) => {
                  readPath.push(screenId)
                  return { get: docGet }
                },
              }),
            }
          },
        }
      },
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  screenConverter: {},
}))

// The render cache is not what is under test: run the read straight through so
// a stored value can never make an assertion pass by accident. `store` is
// captured, because "an excluded screen is never cached" is part of the fix —
// it is what makes clearing the field bring the page back on the next request
// instead of in 60 seconds.
const storeCalls: Array<unknown> = []
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: {
    read: () => Promise<unknown>
    store?: (value: unknown) => boolean
  }) => {
    const value = await options.read()
    storeCalls.push(options.store ? options.store(value) : true)
    return value
  },
}))

import getScreen from './get-screen'

const read = (fields: Record<string, unknown> | null) => {
  screenDoc.fields = fields
  readPath.length = 0
  storeCalls.length = 0
  return getScreen({ screenId: 'screen-1' as never, hostId: 'host-1' as never })
}

describe('getScreen refuses what the quota does not charge for (AGL-1383)', () => {
  it('serves an ordinary screen', async () => {
    const result = await read({ displayName: 'Home', versionId: 'v1' })

    expect(result.screen).toEqual(
      expect.objectContaining({ displayName: 'Home' }),
    )
    expect(result.error).toBeNull()
    // The read is host-scoped and hits the screen the caller named.
    expect(readPath).toEqual(['hosts', 'host-1', 'screens', 'screen-1'])
  })

  it('refuses a screen that calls itself an email', async () => {
    const result = await read({ displayName: 'Welcome', kind: 'email' })

    expect(result.screen).toBeUndefined()
  })

  it('refuses a soft-deleted screen', async () => {
    const result = await read({ displayName: 'Gone', deletedAt: { _seconds: 1 } })

    expect(result.screen).toBeUndefined()
  })

  // Indistinguishable from a screen that was never there: every caller treats
  // a missing screen as a 404, so a refusal cannot be probed for.
  it('refuses identically to a missing document', async () => {
    const missing = await read(null)
    const excluded = await read({ kind: 'email' })

    expect(excluded).toEqual(missing)
  })

  it('never caches a refusal', async () => {
    await read({ kind: 'email' })
    expect(storeCalls).toEqual([false])

    // …while an ordinary screen still caches, or AGL-1302's backstop TTL and
    // the whole ISR story would be undone by this change.
    await read({ displayName: 'Home' })
    expect(storeCalls).toEqual([true])
  })

  // Positive controls for the two fields NEXT to the excluded ones — an
  // over-broad refusal would silently 404 real pages.
  it('serves screens whose neighbouring fields are set', async () => {
    const kindless = await read({ displayName: 'Home', kind: undefined })
    expect(kindless.screen).toBeDefined()

    const otherKind = await read({ displayName: 'Home', kind: 'page' })
    expect(otherKind.screen).toBeDefined()

    const published = await read({ displayName: 'Home', publishedAt: { _seconds: 2 } })
    expect(published.screen).toBeDefined()

    // An explicit null `deletedAt` is what a restore would leave behind, and
    // is how several importers write "not deleted".
    const notDeleted = await read({ displayName: 'Home', deletedAt: null })
    expect(notDeleted.screen).toBeDefined()
  })
})
