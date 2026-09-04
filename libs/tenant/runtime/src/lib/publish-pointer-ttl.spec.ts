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
 * THE POINTER IS THE ONE READ A PUBLISH CHANGES IN PLACE (AGL-2573).
 *
 * `get-screen-version` argues that a publish "lands under a new cache key on
 * its own" because it points at a new version — and that is true of the
 * version BODY, which is keyed by `versionId`. It is not true of the screen
 * document that names which version is live: a publish rewrites that field
 * under an unchanged key, so when the announce to the tenant does not arrive,
 * this single small document is the entire reason a published page keeps
 * serving the old one for the rest of the window.
 *
 * These hold that asymmetry down from both sides. The expensive read keeps the
 * hour the cost review bought; the pointer does not, and the two must not
 * quietly be collapsed back onto one constant.
 */

const screenDoc: { fields: Record<string, unknown> | null } = { fields: null }
const versionDoc: { fields: Record<string, unknown> | null } = { fields: null }

/**
 * Firestore double covering both reads under test. `withConverter` appears at
 * a different depth for the two — the screen doc converts before `.doc()`, the
 * version doc after the `versions` collection — so both shapes are served.
 */
const firestore = {
  collection: () => ({
    doc: () => ({
      collection: () => ({
        withConverter: () => ({
          doc: () => ({
            get: async () => ({
              exists: screenDoc.fields !== null,
              data: () => ({ ...screenDoc.fields }),
            }),
          }),
        }),
        doc: () => ({
          collection: () => ({
            withConverter: () => ({
              doc: () => ({
                get: async () => ({
                  exists: versionDoc.fields !== null,
                  data: () => ({ ...versionDoc.fields }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  screenConverter: {},
  screenVersionConverter: {},
}))

interface CapturedRead {
  key: Array<unknown>
  revalidate: number
  tags: Array<unknown>
}

const captured: CapturedRead[] = []

/**
 * The real TTL constants, with only `withRenderCache` itself replaced. The
 * whole assertion is about which number each read asks for, so mocking the
 * numbers would make every case pass against itself.
 */
jest.mock('@aglyn/tenant-data-admin/render-cache', () => {
  const actual = jest.requireActual('@aglyn/tenant-data-admin/render-cache')
  return {
    __esModule: true,
    ...actual,
    withRenderCache: async (options: CapturedRead & { read: () => unknown }) => {
      captured.push({
        key: options.key,
        revalidate: options.revalidate,
        tags: options.tags,
      })
      return options.read()
    },
  }
})

import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  PUBLISH_POINTER_TTL_SECONDS,
} from '@aglyn/tenant-data-admin/render-cache'
import getScreen from './get-screen'
import getScreenVersion from './get-screen-version'

beforeEach(() => {
  captured.length = 0
  screenDoc.fields = { displayName: 'Home', versionId: 'v2', slug: '/' }
  versionDoc.fields = { displayName: 'Home', nodes: [] }
})

describe('the version pointer is not held for an hour (AGL-2573)', () => {
  it('reads the screen document under the pointer TTL, not the site-data one', async () => {
    await getScreen({ screenId: 'screen-1' as never, hostId: 'host-1' as never })

    expect(captured).toHaveLength(1)
    expect(captured[0].revalidate).toBe(PUBLISH_POINTER_TTL_SECONDS)
    // Named explicitly so collapsing this back onto the shared hour is a
    // failing test rather than a one-word edit nobody reviews.
    expect(captured[0].revalidate).not.toBe(PUBLISHED_SITE_DATA_TTL_SECONDS)
  })

  it('keeps the pointer keyed by screen, which is why its TTL has to be short', async () => {
    await getScreen({ screenId: 'screen-1' as never, hostId: 'host-1' as never })

    // No version id in the key: publishing rewrites the value this key
    // addresses, so nothing about a new version makes this entry miss.
    expect(captured[0].key).toEqual([
      'tenant-screen-doc',
      'host-1',
      'screen-1',
    ])
    expect(captured[0].key).not.toContain('v2')
  })

  it('leaves the expensive version body at the full hour', async () => {
    // The body is the largest read of a render. It is version-keyed, so it
    // misses on its own and gains nothing from a shorter window — shortening
    // it would be paying the cost review's bill back for no propagation.
    await getScreenVersion({
      hostId: 'host-1' as never,
      screenId: 'screen-1' as never,
      versionId: 'v2' as never,
    })

    expect(captured).toHaveLength(1)
    expect(captured[0].revalidate).toBe(PUBLISHED_SITE_DATA_TTL_SECONDS)
    expect(captured[0].key).toContain('v2')
  })

  it('holds the pointer for less time than the data it points at', async () => {
    // The invariant behind both numbers: a stale pointer serves the wrong
    // version entirely, while stale version data is only stale within the
    // version somebody chose.
    expect(PUBLISH_POINTER_TTL_SECONDS).toBeLessThan(
      PUBLISHED_SITE_DATA_TTL_SECONDS,
    )
  })

  it('still busts on the host tag, because the announce is the real mechanism', async () => {
    // The shorter TTL bounds a LOST announce; it does not replace one. If the
    // tag ever stopped being attached here, publishes would silently degrade
    // to waiting out the window and these numbers would be all that is left.
    await getScreen({ screenId: 'screen-1' as never, hostId: 'host-1' as never })

    expect(captured[0].tags).toContain('tenant-data:host-1')
  })
})
