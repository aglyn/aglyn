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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Stack } from '@mui/material'
import { useState } from 'react'
import OrgDataTransferCard from '../../../../../../components/settings/org-data-transfer-card.component'
import OrgTransferHistoryCard from '../../../../../../components/settings/org-transfer-history-card.component'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

/**
 * Import & export (AGL-3535): everything the workspace can move in and out,
 * and every import it ran, with its results and undo. Open to whoever may
 * export something (AGL-3554); the history of imports is for those who
 * may import — the jobs route asks `data.manage`.
 */
const SettingsData: NextPageWithLayout<Record<string, never>> = () => {
  const [imported, setImported] = useState(0)
  const permissions = useOrgPermissions()
  return (
    <Stack spacing={2}>
      <OrgDataTransferCard onImported={() => setImported((count) => count + 1)} />
      {permissions.loaded && permissions.can('data.manage') ? <OrgTransferHistoryCard refreshKey={imported} /> : null}
    </Stack>
  )
}
SettingsData.displayName = 'Page:SettingsData'

export default SettingsData
