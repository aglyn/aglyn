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
 * `/contacts/fields` — the custom fields a holder keeps on a person
 * (AGL-2595).
 *
 * Definitions live in `orgs/{orgId}/contactFields`; the values live under
 * each contact facet's `custom`, keyed by the definition's `key`. A key is
 * immutable once written under, which is why this section retires a field
 * rather than deleting it.
 */
export function ContactsFieldsSection() {
  return (
    <CardDisplay header={'Fields'} contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary">
        {'The custom fields on a contact — text, number, date, choice, ' +
          'checkbox or link — will be defined and ordered here.'}
      </Typography>
    </CardDisplay>
  )
}
ContactsFieldsSection.displayName = 'ContactsFieldsSection'

export default ContactsFieldsSection
