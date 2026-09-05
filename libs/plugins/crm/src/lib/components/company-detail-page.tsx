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
 * `/contacts/companies/{companyId}` — one organization (AGL-2595).
 *
 * The record behind a row of the Companies section: its people, its deals,
 * its open tasks and the activity logged against it, each of which points at
 * this id and none of which the list row can carry.
 */
export function CompanyDetailPage(props: CrmDetailPageProps) {
  const { id, basePath } = props
  const routes = crmRoutes(basePath)
  return (
    <CardDisplay
      header={'Company'}
      subheader={`Company ${id}`}
      actions={
        <Button
          component={AppLink as any}
          {...({ componentVariant: 'naked', nativeButton: false } as any)}
          href={routes.section('companies')}
          size="small"
          color="primary"
        >
          {'Back to companies'}
        </Button>
      }
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary">
        {"This company's page is not built yet."}
      </Typography>
    </CardDisplay>
  )
}
CompanyDetailPage.displayName = 'CompanyDetailPage'

export default CompanyDetailPage
