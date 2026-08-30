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

import { Stack } from '@mui/material'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import SiteBackupCard from '../../../../../../../../components/site-backup-card.component'
import SiteTemplateCard from '../../../../../../../../components/site-template-card.component'
import { useHostId } from '../../../../../../../../components/host-id-provider'

/**
 * Moving the whole site somewhere else, or bringing it back.
 *
 * Neither of these is a setting a visitor experiences. A restore writes
 * documents into the host behind a confirmation — that is the site's
 * existence, not its behaviour — and publishing a template distributes the
 * site as an object: every published screen plus the theme.
 *
 * NOT the Danger zone, deliberately. Restore overwrites, but exporting a
 * backup and publishing a template do not, and a heading that calls all three
 * destructive teaches an owner to fear two actions that are safe.
 */
const HostAdminBackup: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  return (
    <Stack spacing={2}>
      <SiteBackupCard hostId={hostId} />
      <SiteTemplateCard hostId={hostId} />
    </Stack>
  )
}
HostAdminBackup.displayName = 'Page:HostAdminBackup'

export default HostAdminBackup
