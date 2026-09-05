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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Typography } from '@mui/material'

/**
 * `/contacts/reports` — the CRM in aggregate (AGL-2595).
 *
 * Contacts by lifecycle stage and source, the pipeline by stage and its
 * weighted forecast, won and lost over time. Read from the same scoped
 * collections the other sections list, so a report can never count a record
 * its reader could not open.
 */
export function ContactsReportsSection() {
  return (
    <CardDisplay header={'Reports'} contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary">
        {'Contacts by stage and source, the pipeline by stage with its ' +
          'weighted forecast, and won and lost over time will be charted here.'}
      </Typography>
    </CardDisplay>
  )
}
ContactsReportsSection.displayName = 'ContactsReportsSection'

export default ContactsReportsSection
