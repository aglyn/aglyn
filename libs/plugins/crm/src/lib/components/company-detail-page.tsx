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

import {
  CRM_COLLECTIONS,
  type CrmCompany,
  PageHeaderRecord,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { Button, Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useOrgMemberOptions } from '../hooks/use-org-member-options'
import { type CrmDetailPageProps, crmRoutes } from '../model/crm-routes'
import CompanyContactsCard from './company-contacts-card'
import CompanyDealsCard from './company-deals-card'
import { RecordActivityCard } from './record-activity-card'
import { RecordTasksCard } from './record-tasks-card'
import CompanyPropertiesCard from './company-properties-card'

/**
 * `/crm/companies/{companyId}` — one organization (AGL-2597).
 *
 * The record behind a row of the Companies section: its properties, its
 * people, and — as the rest of the CRM lands — its deals, its open tasks
 * and the activity logged against it. Each of those is a card in a file of
 * its own, so the agent shipping deals replaces one file and touches nothing
 * here; this page reads the ONE document every card is about and hands it
 * down.
 *
 * A route rather than a drawer because a company is what a deal, a task and
 * a contact all point at, and a link that opens a drawer on top of a list is
 * not a link anybody can paste.
 */
export function CompanyDetailPage(props: CrmDetailPageProps) {
  const { id, basePath, hostId, org } = props
  const routes = crmRoutes(basePath)
  const router = useRouter()
  const firestore = useFirestore()
  const crmScope = useCrmScope({ hostId, org })
  const { scope, orgId } = crmScope
  const members = useOrgMemberOptions(orgId)

  const {
    data: company,
    status,
    fromCache,
  } = useFirestoreDoc<CrmCompany>(
    () =>
      scope
        ? doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies, id)
        : null,
    [firestore, scope, id],
  )

  const onDeleted = useCallback(
    () => router.push(routes.section('companies')),
    [router, routes],
  )

  const backButton = (
    <Button
      component={AppLink as any}
      {...({ componentVariant: 'naked', nativeButton: false } as any)}
      href={routes.section('companies')}
      size="small"
      color="primary"
    >
      {'All companies'}
    </Button>
  )

  if (!company) {
    /*
     * Loading and MISSING are different answers. A company that cannot be
     * read is a different situation from an empty one, and reading `status`
     * rather than the absence of data is what stops the refusal being
     * flashed on every arrival, before the org scope has resolved.
     */
    const settled = Boolean(scope) && status !== 'loading'
    return (
      <CardDisplay
        header={'Company'}
        help={pluginDocsHelp('companies', { anchor: '#a-companys-page' })}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: backButton }}
      >
        <Typography variant="body2" color="text.secondary">
          {settled
            ? 'This company could not be loaded. It may have been deleted.'
            : 'Loading this company…'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <>
      {/* The page heading and the trail name the company; the cards are then
          free to say what they hold rather than repeating the title. */}
      <PageHeaderRecord title={String(company.name || id)} />
      <Stack spacing={2}>
        <CompanyPropertiesCard
          company={{ ...company, $id: id }}
          seed={{ fromCache, unreadable: status === 'error' }}
          hostId={hostId}
          org={org}
          crmScope={crmScope}
          members={members}
          routes={routes}
          onDeleted={onDeleted}
        />
        <CompanyContactsCard
          companyId={id}
          companyName={String(company.name ?? '')}
          crmScope={crmScope}
          routes={routes}
        />
        <CompanyDealsCard
          hostId={hostId}
          org={org}
          basePath={basePath}
          companyId={id}
          companyName={String(company.name ?? '')}
        />
        <RecordTasksCard hostId={hostId} org={org} basePath={basePath} companyId={id} />
        <RecordActivityCard hostId={hostId} org={org} companyId={id} />
      </Stack>
    </>
  )
}
CompanyDetailPage.displayName = 'CompanyDetailPage'

export default CompanyDetailPage
