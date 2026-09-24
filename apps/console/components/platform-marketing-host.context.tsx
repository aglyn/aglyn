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
'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * The platform marketing site's host id, handed from a server layout to the
 * client page under it (AGL-3318).
 *
 * The deployment names that site in `PLATFORM_MARKETING_HOST_ID`, a server
 * setting read by `platformMarketingHostId()`. A `NEXT_PUBLIC_` copy would be
 * a second name for one fact, baked into the client bundle at build time, so
 * the server layout reads it per request and provides it here instead.
 *
 * `null` is an install that names no marketing site, and also any page with no
 * provider above it, so a consumer renders as it did before this existed.
 */
const PlatformMarketingHostContext = createContext<string | null>(null)
PlatformMarketingHostContext.displayName = 'PlatformMarketingHostContext'

export function PlatformMarketingHostProvider({
  hostId,
  children,
}: {
  hostId: string | null
  children?: ReactNode
}) {
  return (
    <PlatformMarketingHostContext.Provider value={hostId}>
      {children}
    </PlatformMarketingHostContext.Provider>
  )
}
PlatformMarketingHostProvider.displayName = 'PlatformMarketingHostProvider'

/** The platform marketing site's host id, or `null` when there is none. */
export function usePlatformMarketingHostId(): string | null {
  return useContext(PlatformMarketingHostContext)
}
