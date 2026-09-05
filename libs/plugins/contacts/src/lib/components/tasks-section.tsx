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
 * `/contacts/tasks` — what the team owes the people in the CRM (AGL-2595).
 *
 * `orgs/{orgId}/crmTasks`, read by assignee and due date. A task hangs off a
 * contact, a company or a deal, but it is listed HERE because "what is due
 * today" is a question about the team's day, not about any one record.
 */
export function ContactsTasksSection() {
  return (
    <CardDisplay header={'Tasks'} contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary">
        {'Calls, emails, meetings and to-dos will be listed here by due date, ' +
          'each linked to the contact, company or deal it is for.'}
      </Typography>
    </CardDisplay>
  )
}
ContactsTasksSection.displayName = 'ContactsTasksSection'

export default ContactsTasksSection
