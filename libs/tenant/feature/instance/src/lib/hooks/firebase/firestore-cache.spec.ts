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
 * real SDK; this asserts the two things `kind` cannot see.
 *
 * The garbage collector is one of them: `memoryLocalCache()` bakes it into a
 * closure, so the returned object is `{ kind: 'memory' }` either way and an
 * eager collector would be indistinguishable from the LRU one at the settings
 * surface — while costing a full working-set re-read on every intra-session
 * navigation. Asserted at the call, since it cannot be asserted at the value.
 */

import {
  memoryLocalCache,
  memoryLruGarbageCollector,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

import { localCacheFor } from './firestore-cache'

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  memoryLocalCache: jest.fn(() => ({ kind: 'memory' })),
  memoryLruGarbageCollector: jest.fn(() => ({ kind: 'memoryLru' })),
  persistentLocalCache: jest.fn(() => ({ kind: 'persistent' })),
  persistentMultipleTabManager: jest.fn(() => ({ kind: 'PERSISTENT_MULTIPLE_TAB' })),
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
