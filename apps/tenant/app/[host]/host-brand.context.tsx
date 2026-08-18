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

import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * The site's own mark, readable by anything under `[host]/layout` (AGL-2074).
 *
 * The layout already resolves the host's logo and display name to brand the
 * navigation loader; this publishes the same two values so the error
 * boundaries can wear them too. It exists because of a constraint of the App
 * Router rather than a design preference: **`not-found.tsx` and `error.tsx`
 * receive no `params`**, so neither can resolve the tenant host itself and
 * neither can call `getHostCached`. The layout is the last place in the tree
 * that knows which site this is, so what the boundaries need has to travel
 * down from there.
 *
 * Doing it as context rather than a server fetch inside the boundary is also
 * what keeps the 404 path free: the catch-all page is ISR (`revalidate = 60`)
 * and reading request state in a boundary rendered in the same pass would
 * force it dynamic, trading a cached 404 for a Firestore round trip on every
 * missing URL — which is exactly the traffic shape you least want to pay for.
 *
 * Both fields are optional on purpose. A host that set no logo, a lookup that
 * failed, or the root-level boundaries that render outside this provider all
 * land on the same answer — render the site's NAME, or nothing — instead of
 * substituting a platform mark. See `site-status-screen.component.tsx` for
 * why substituting one would be a white-label defect.
 */
export interface HostBrand {
  /** The site's display name, e.g. "Northwind Coffee". */
  brandName?: string
  /** Resolved, site-relative logo URL; absent when the host set none. */
  brandLogoUrl?: string
}

const HostBrandContext = createContext<HostBrand>({})

export function HostBrandProvider({
  brandName,
  brandLogoUrl,
  children,
}: HostBrand & { children: ReactNode }) {
  const value = useMemo(
    () => ({ brandName, brandLogoUrl }),
    [brandName, brandLogoUrl],
  )
  return (
    <HostBrandContext.Provider value={value}>
      {children}
    </HostBrandContext.Provider>
  )
}
HostBrandProvider.displayName = 'HostBrandProvider'

/**
 * The current site's brand. Returns an EMPTY object outside the provider
 * rather than throwing — the root-level boundaries in `app/` render above
 * `[host]/layout` by definition, and a boundary that throws while reporting
 * an error is the one failure mode none of this may have.
 */
export function useHostBrand(): HostBrand {
  return useContext(HostBrandContext)
}
