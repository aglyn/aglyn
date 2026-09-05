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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Typography } from '@mui/material'
import { type CrmDetailPageProps, crmRoutes } from '../model/crm-routes'

/**
 * `/contacts/people/{contactId}` — one person (AGL-2595).
 *
 * A ROUTE rather than the v1 drawer, because a person is the thing every
 * other CRM record points at: a deal, a task and an activity all name a
 * contact, and a link that opens a drawer on top of a list is not a link
 * anybody can paste. The drawer stays on the list for the quick edit; this
 * page is the record.
 */
export function ContactDetailPage(props: CrmDetailPageProps) {
  const { id, basePath } = props
  const routes = crmRoutes(basePath)
  return (
    <CardDisplay
      header={'Contact'}
      subheader={`Contact ${id}`}
      actions={
        <Button
          component={AppLink as any}
          {...({ componentVariant: 'naked', nativeButton: false } as any)}
          href={routes.section('contacts')}
          size="small"
          color="primary"
        >
          {'Back to contacts'}
        </Button>
      }
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary">
        {"This contact's page is not built yet."}
      </Typography>
    </CardDisplay>
  )
}
ContactDetailPage.displayName = 'ContactDetailPage'

export default ContactDetailPage
