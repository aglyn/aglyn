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

import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { useIsStaff } from '../hooks/use-is-staff'

/**
 * Renders its children only for a staff-claim holder (AGL-760).
 *
 * The whole `(app)/admin` group is already gated by `StaffGuard` in its layout
 * (AGL-847); this remains as page-level defense-in-depth for any staff-only
 * fragment mounted elsewhere. A non-staff viewer gets the ordinary 404 rather
 * than an alert that names the internal grant script.
 *
 * Renders nothing while the claim is still resolving, so a staff member
 * never sees the refusal flash before their own page.
 */
export function StaffOnly({ children }: { children?: ReactNode }) {
  const isStaff = useIsStaff()
  if (isStaff === null) return null
  if (!isStaff) notFound()
  return <>{children}</>
}
StaffOnly.displayName = 'StaffOnly'

export default StaffOnly
