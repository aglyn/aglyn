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
 * The mobile data cache (AGL-3620): React Query, persisted to AsyncStorage
 * so the last screen of data is there offline and on a cold start.
 *
 * The persisted cache is per person: it is keyed by uid and dropped on sign
 * out, so one account's orders never paint under another's. Online state
 * comes from NetInfo, so queries pause offline and refetch on reconnect
 * instead of failing into error screens.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { onlineManager, QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { useEffect, useMemo, type ReactNode } from 'react'
import { ConsoleApiError } from './api-client'

/** How long a persisted answer may be shown before it is dropped unseen. */
export const OFFLINE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  // A refusal will refuse again; only a fault or a flaky network is worth it.
  if (error instanceof ConsoleApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 2
}

export function createMobileQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: OFFLINE_CACHE_MAX_AGE_MS,
        retry: shouldRetryQuery,
        networkMode: 'offlineFirst',
      },
      mutations: { retry: false, networkMode: 'online' },
    },
  })
}

let wiredOnline = false
function wireOnlineManager() {
  if (wiredOnline) return
  wiredOnline = true
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  )
}

export function MobileQueryProvider({
  uid,
  buster,
  children,
}: {
  /** The signed-in person; null renders an unpersisted client. */
  uid: string | null
  /** The app version: a new build never reads an old build's cache shapes. */
  buster: string
  children: ReactNode
}) {
  useEffect(wireOnlineManager, [])
  // A new client per person, so nothing in memory crosses a sign-out either.
  const client = useMemo(() => createMobileQueryClient(), [uid])
  const persister = useMemo(
    () =>
      createAsyncStoragePersister({
        storage: AsyncStorage,
        key: `aglyn.query-cache.${uid ?? 'anonymous'}`,
        throttleTime: 1000,
      }),
    [uid],
  )
  useEffect(() => () => client.clear(), [client])
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{ persister, maxAge: OFFLINE_CACHE_MAX_AGE_MS, buster }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}

/** Drops a person's persisted cache; called on sign out. */
export async function clearPersistedQueryCache(uid: string): Promise<void> {
  await AsyncStorage.removeItem(`aglyn.query-cache.${uid}`)
}
