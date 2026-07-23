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

import { Alert } from '@mui/material'
import type { ReactNode } from 'react'
import { useIsStaff } from '../hooks/use-is-staff'

/**
 * Renders its children only for a staff-claim holder (AGL-760).
 *
 * Every `/admin/*` page needs the same three states — reading the claim,
 * refusing, allowing — and had been writing its own copy of all three. The
 * refusal wording says how to get the claim rather than only that you lack
 * it, because the reader is almost always an operator who needs the script
 * name.
 *
 * Renders nothing while the claim is still resolving, so a staff member
 * never sees the refusal flash before their own page.
 */
export function StaffOnly({ children }: { children?: ReactNode }) {
  const isStaff = useIsStaff()
  if (isStaff === null) return null
  if (!isStaff) {
    return (
      <Alert severity="warning">
        {'Staff only. Grant access with tools/scripts/set-staff-claim.mjs, ' +
          'then sign out and back in to refresh the claim.'}
      </Alert>
    )
  }
  return <>{children}</>
}
StaffOnly.displayName = 'StaffOnly'

export default StaffOnly
