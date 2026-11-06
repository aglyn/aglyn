/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
 *
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
 * A PLATFORM STOP REACHES EVERY SITE THROUGH ONE TAG (AGL-1152, AGL-4121).
 *
 * This used to walk the `installs` collection group and fan out to each host
 * it found, capped at 200 and only as good as the walk — an org-tier pin it
 * misread was a site left running the bundle that was just killed. Every
 * plugin read now carries the platform-wide plugin tag, so the stop asks the
 * app for ONE `plugins: 'everywhere'` drop, with nothing to walk.
 *
 * And it must not be lost: when the app reports the drop neither landed nor
 * was queued for a retry, the staff action fails loudly instead of answering
 * success over cached pages that still load the stopped bundle.
 */

import { dropCachesForListing, PluginCacheDropLostError } from './revoke-cache-drop'
import {
  registerPluginSiteCache,
  type PluginSiteCacheRequest,
  type PluginSiteCacheResult,
} from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

const asked: PluginSiteCacheRequest[] = []
let answer: PluginSiteCacheResult = { dropped: 1, skipped: 0, complete: true }

/** A Firestore that fails the spec if the stop reaches for it at all. */
const untouchable = new Proxy(
  {},
  {
    get: (_target, key) => {
      throw new Error(`the stop read firestore.${String(key)}; it walks nothing now`)
    },
  },
) as never

beforeEach(() => {
  resetPluginServicesForTests()
  asked.length = 0
  answer = { dropped: 1, skipped: 0, complete: true }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  registerPluginSiteCache(
    {
      drop: async (request) => {
        asked.push(request)
        return answer
      },
    },
    { pluginId: 'console' },
  )
})

afterEach(() => jest.restoreAllMocks())

describe('a takedown, a revoked version or withdrawn trust', () => {
  it('asks for one platform-wide plugin drop, walking no installs', async () => {
    await expect(dropCachesForListing(untouchable, 'listing-1')).resolves.toEqual(
      answer,
    )
    expect(asked).toEqual([
      {
        hostIds: [],
        plugins: 'everywhere',
        reason: 'marketplace listing listing-1 stopped',
      },
    ])
  })

  it('fails loudly when the drop neither landed nor was queued', async () => {
    answer = { dropped: 0, skipped: 0, complete: false }
    await expect(dropCachesForListing(untouchable, 'listing-1')).rejects.toBeInstanceOf(
      PluginCacheDropLostError,
    )
  })

  it('fails loudly when no app cache is installed at all', async () => {
    resetPluginServicesForTests()
    await expect(dropCachesForListing(untouchable, 'listing-1')).rejects.toBeInstanceOf(
      PluginCacheDropLostError,
    )
  })

  it('asks for nothing without a listing', async () => {
    await expect(dropCachesForListing(untouchable, '')).resolves.toEqual({
      dropped: 0,
      skipped: 0,
      complete: true,
    })
    expect(asked).toEqual([])
  })
})
