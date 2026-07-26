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

import { Box, CircularProgress } from '@mui/material'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { useIsStaff } from '../hooks/use-is-staff'

/**
 * Route-group gate for the whole staff console (AGL-847). Mounted by the
 * `(app)/admin` layout so a non-staff visitor gets the ordinary 404 for the
 * entire area — they should not learn it exists, and should never see the old
 * "grant access with <script>" alert that named the internal grant script.
 *
 * Holds a spinner while the claim is still resolving (`null`, distinct from
 * `false`) so a real staff member never flashes the 404 on the way in.
 *
 * This is an enumeration/UX gate, not the security boundary: every
 * `/api/admin/*` handler independently verifies `decoded['staff']`, and
 * Firestore rules gate the underlying data. Hiding the surface just stops a
 * non-staff user from stumbling onto it.
 */
export function StaffGuard({ children }: { children?: ReactNode }) {
  const isStaff = useIsStaff()
  if (isStaff === null) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (!isStaff) notFound()
  return <>{children}</>
}
StaffGuard.displayName = 'StaffGuard'

export default StaffGuard
