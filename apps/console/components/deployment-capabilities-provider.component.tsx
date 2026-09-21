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

import {
  DeploymentCapabilitiesContext,
  type DeploymentCapabilities,
} from '@aglyn/aglyn'
import { useMemo, type ReactNode } from 'react'

/**
 * Hands every surface under the organization what THIS DEPLOYMENT can do
 * (AGL-3080) — see {@link DeploymentCapabilities} for what that means and
 * why it is not an entitlement.
 *
 * The client half of a fact only the server knows. `STRIPE_SECRET_KEY`
 * carries no `NEXT_PUBLIC_` prefix, so it is read in the org's SERVER layout
 * and arrives here as a prop; a client component reading `process.env` for
 * it would conclude "not configured" on every deployment, ours included.
 *
 * Memoized on the values rather than on the object, because the server layout
 * builds a fresh one on every render and an unmemoized context value
 * re-renders every consumer under the whole organization area.
 */
export default function DeploymentCapabilitiesProvider({
  payments,
  children,
}: DeploymentCapabilities & { children: ReactNode }) {
  const value = useMemo<DeploymentCapabilities>(() => ({ payments }), [payments])
  return (
    <DeploymentCapabilitiesContext.Provider value={value}>
      {children}
    </DeploymentCapabilitiesContext.Provider>
  )
}
