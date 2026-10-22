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

import { useUser } from '@aglyn/tenant-feature-instance'
import { Stack } from '@mui/material'
import CloseAccountCard from '../close-account-card.component'
import DataExportCard from '../data-export-card.component'
import useAccountSignInMethods from '../../hooks/use-account-sign-in-methods'

/**
 * Take your data with you, then close the account (AGL-1140, AGL-1974).
 *
 * The Close account section of Manage Account, its own component since the
 * sections became routes (AGL-2501).
 *
 * The export sits directly ABOVE the irreversible control. The Close account
 * card has always told people to export first and there was nothing to export
 * with; putting the answer in the same place as the instruction is the
 * difference between an instruction and an errand.
 *
 * The section is separate from Security for the reason it was a separate tab:
 * an irreversible control should not sit one mis-click below a password field
 * somebody is already typing in.
 */
export function CloseAccountSection() {
  const { data: user } = useUser()
  const { hasPassword } = useAccountSignInMethods()
  return (
    <Stack spacing={3}>
      <DataExportCard user={user} />
      <CloseAccountCard user={user} hasPassword={hasPassword} />
    </Stack>
  )
}
CloseAccountSection.displayName = 'CloseAccountSection'

export default CloseAccountSection
