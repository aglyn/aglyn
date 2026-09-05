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
 * `/contacts/deals` — the pipeline (AGL-2595).
 *
 * Deals move through the stages of `orgs/{orgId}/pipelines` and are stored
 * in `orgs/{orgId}/deals`, each pointing at the contact and company it is
 * with. The section is a board or a list over the same rows; a single deal
 * is its own route beneath it, `deals/{dealId}`.
 */
export function ContactsDealsSection() {
  return (
    <CardDisplay header={'Deals'} contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary">
        {'Your pipeline will live here: every open deal by stage, with its ' +
          'amount, owner and expected close, and the won and lost history behind it.'}
      </Typography>
    </CardDisplay>
  )
}
ContactsDealsSection.displayName = 'ContactsDealsSection'

export default ContactsDealsSection
