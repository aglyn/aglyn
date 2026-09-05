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
 * `/crm/leads` — the people a site has met but not yet qualified (AGL-2595).
 *
 * A section of its own, the way Salesforce keeps Leads apart from Contacts:
 * a lead is a capture — a form, a booking — that somebody has still to work,
 * and it converts into a contact, a company and a deal when it is real.
 * Reads `hosts/{hostId}/leads`, which is host-scoped by path and needs no
 * `visibleTo` filter of its own.
 */
export function CrmLeadsSection() {
  return (
    <CardDisplay header={'Leads'} contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary">
        {'The people your site has captured but not yet qualified will be ' +
          'listed here, with a status, an owner and a way to convert them.'}
      </Typography>
    </CardDisplay>
  )
}
CrmLeadsSection.displayName = 'CrmLeadsSection'

export default CrmLeadsSection
