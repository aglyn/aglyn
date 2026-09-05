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
 * `/crm/leads/{leadId}` — one lead (AGL-2595).
 *
 * The record behind a row of the Leads section: what the person did on the
 * site, who is working them, and the conversion that turns them into a
 * contact, a company and a deal.
 */
export function LeadDetailPage(props: CrmDetailPageProps) {
  const { id, basePath } = props
  const routes = crmRoutes(basePath)
  return (
    <CardDisplay
      header={'Lead'}
      subheader={`Lead ${id}`}
      actions={
        <Button
          component={AppLink as any}
          {...({ componentVariant: 'naked', nativeButton: false } as any)}
          href={routes.section('leads')}
          size="small"
          color="primary"
        >
          {'Back to leads'}
        </Button>
      }
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary">
        {"This lead's page is not built yet."}
      </Typography>
    </CardDisplay>
  )
}
LeadDetailPage.displayName = 'LeadDetailPage'

export default LeadDetailPage
