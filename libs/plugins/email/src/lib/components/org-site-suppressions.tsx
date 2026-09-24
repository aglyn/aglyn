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

import { PageHeaderRecord } from '@aglyn/aglyn'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useRouter } from 'next/navigation'
import { OrgSiteSelect, orgSiteName, useEmailOrgMount } from './email-org-mount'
import SuppressionsCard from './suppressions-card'

/**
 * ONE SITE'S SUPPRESSION LIST, opened from the organization's summary —
 * `/[orgSlug]/emails/suppressions/{hostId}`.
 *
 * The same card a site's own Emails page draws, with a picker to move to
 * another site's list and the way back to the summary. The site is named by
 * its document id rather than its subdomain because the id is what the list
 * is stored under and what does not change when the site is renamed.
 *
 * Only a site the mount lists is opened. The rules would refuse any other
 * site's list anyway; saying so here is what stops a stale link rendering an
 * empty list that reads as "nobody is suppressed".
 */
export function OrgSiteSuppressions(props: { hostId: string }) {
  const { hostId } = props
  const mount = useEmailOrgMount()
  const router = useRouter()
  if (!mount) return null

  const summaryHref = `${mount.basePath}/suppressions`
  const known = mount.hosts.some((site) => site.id === hostId)
  const back = (
    <Button
      component={AppLink as any}
      {...({ componentVariant: 'naked', nativeButton: false } as any)}
      href={summaryHref}
      size="small"
      color="primary"
    >
      {'All sites'}
    </Button>
  )

  if (!known) {
    return mount.hostsReady ? (
      <Alert severity="warning" action={back}>
        {'That site is not one of this organization’s, or it has been ' +
          'removed. Choose a site from the list of every site’s suppressions.'}
      </Alert>
    ) : (
      <Typography variant="body2" color="text.secondary">
        {'Loading…'}
      </Typography>
    )
  }

  return (
    <Stack spacing={2}>
      {/* The heading and the trail name the site whose list this is. */}
      <PageHeaderRecord title={orgSiteName(mount, hostId)} />
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <OrgSiteSelect
          mount={mount}
          label="Site"
          value={hostId}
          onChange={(next) =>
            router.push(`${summaryHref}/${encodeURIComponent(next)}`)
          }
        />
        {back}
      </Stack>
      {/* Keyed, so moving to another site starts its list from the top. */}
      <SuppressionsCard key={hostId} hostId={hostId} />
    </Stack>
  )
}
OrgSiteSuppressions.displayName = 'OrgSiteSuppressions'

export default OrgSiteSuppressions
