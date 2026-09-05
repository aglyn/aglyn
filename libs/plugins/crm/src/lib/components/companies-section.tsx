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
 * `/contacts/companies` — the organizations behind the people (AGL-2595).
 *
 * A section of its own rather than a column on the contact list, because a
 * company is known by several contacts and carries records of its own: a
 * domain the auto-association keys on, an address, an owner, and the deals
 * and tasks filed against it. Reads `orgs/{orgId}/companies` on the same
 * `visibleTo` predicate the contact list uses.
 */
export function ContactsCompaniesSection() {
  return (
    <CardDisplay header={'Companies'} contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary">
        {'The organizations your contacts belong to will be listed here, ' +
          'each with its people, deals and open tasks.'}
      </Typography>
    </CardDisplay>
  )
}
ContactsCompaniesSection.displayName = 'ContactsCompaniesSection'

export default ContactsCompaniesSection
