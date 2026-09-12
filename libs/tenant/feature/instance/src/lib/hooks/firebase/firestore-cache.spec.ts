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
 * AGL-1456, the declaration half. `firestore-cache-provider.spec.tsx` proves
 * the provider reaches this helper and asserts `localCache.kind` against the
 * real SDK; this asserts the things `kind` cannot see.
 *
 * The garbage collector is one of them: `memoryLocalCache()` bakes it into a
 * closure, so the returned object is `{ kind: 'memory' }` either way and an
 * eager collector would be indistinguishable from the LRU one at the settings
 * surface — while costing a full working-set re-read on every intra-session
 * navigation. Asserted at the call, since it cannot be asserted at the value.
 *
 * The durable cache's size bound is another (AGL-2845), and so is which origin
 * class gets its multi-tab records pruned.
 */

import { type FirebaseApp } from 'firebase/app'
import {
  memoryLocalCache,
  memoryLruGarbageCollector,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

import { localCacheFor, pruneSharedClientStateFor } from './firestore-cache'
import { pruneBrowserSharedClientState } from './firestore-shared-client-state'

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  memoryLocalCache: jest.fn(() => ({ kind: 'memory' })),
  memoryLruGarbageCollector: jest.fn(() => ({ kind: 'memoryLru' })),
  persistentLocalCache: jest.fn(() => ({ kind: 'persistent' })),
  persistentMultipleTabManager: jest.fn(() => ({ kind: 'PERSISTENT_MULTIPLE_TAB' })),
}))

jest.mock('./firestore-shared-client-state', () => ({
  __esModule: true,
  pruneBrowserSharedClientState: jest.fn(async () => undefined),
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe('localCacheFor', () => {
  it('gives a durable origin the persistent multi-tab cache it has always had', () => {
    localCacheFor('durable')

    expect(persistentLocalCache).toHaveBeenCalledTimes(1)
    // The tab manager is the other thing `kind` cannot see, and dropping it
    // would multiply reads by the number of open console tabs.
    expect(persistentLocalCache).toHaveBeenCalledWith({
      tabManager: (persistentMultipleTabManager as jest.Mock).mock.results[0].value,
      // 40 MB is `LruParams.DEFAULT` in @firebase/firestore 4.17.1, the value an
      // unset `cacheSizeBytes` already resolved to. Written as a number, not
      // the constant, so the bound cannot drift — least of all to
      // `CACHE_SIZE_UNLIMITED` — without this line changing too.
      cacheSizeBytes: 40 * 1024 * 1024,
    })
    expect(memoryLocalCache).not.toHaveBeenCalled()
  })

  it('never builds a persistent cache for an ephemeral origin', () => {
    localCacheFor('ephemeral')

    expect(persistentLocalCache).not.toHaveBeenCalled()
    expect(persistentMultipleTabManager).not.toHaveBeenCalled()
    expect(memoryLocalCache).toHaveBeenCalledTimes(1)
  })

  it('gives the ephemeral memory cache the LRU collector, not the eager default', () => {
    localCacheFor('ephemeral')

    // Memory-only either way — so the security property is identical — but the
    // eager default drops every document the instant its listener unmounts,
    // which is the whole read-cost objection to this change.
    expect(memoryLruGarbageCollector).toHaveBeenCalledTimes(1)
    expect(memoryLocalCache).toHaveBeenCalledWith({
      garbageCollector: (memoryLruGarbageCollector as jest.Mock).mock.results[0].value,
    })
  })
})

describe('pruneSharedClientStateFor', () => {
  const app = { name: 'DEFAULT_AGLYN', options: { projectId: 'aglyn-main' } } as FirebaseApp

  it("prunes a durable origin's multi-tab records under its own app and project", async () => {
    await pruneSharedClientStateFor('durable', app)

    expect(pruneBrowserSharedClientState).toHaveBeenCalledTimes(1)
    expect(pruneBrowserSharedClientState).toHaveBeenCalledWith('DEFAULT_AGLYN', 'aglyn-main')
  })

  it('never looks on an ephemeral origin, whose memory cache writes none', async () => {
    await expect(pruneSharedClientStateFor('ephemeral', app)).resolves.toBeUndefined()

    expect(pruneBrowserSharedClientState).not.toHaveBeenCalled()
  })
})
