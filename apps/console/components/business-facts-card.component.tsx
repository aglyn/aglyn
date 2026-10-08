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

import { aiAddonName, buildRoute, Route } from '@aglyn/aglyn'
import {
  resolveBusinessProfile,
  type BusinessProfileHost,
} from '@aglyn/aglyn/app-utils/business-profile'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Box, Divider, Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { Fragment, useMemo } from 'react'
import { docsHelp } from '../constants/docs-links'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface BusinessFactsCardProps {
  hostId: string
  orgSlug: string
  /** The site's subdomain, which the Setup links name it by. */
  host: string | null
}

interface FactRow {
  label: string
  value: string | null
  /** The Setup section the fact is edited in. */
  section: 'details' | 'seo'
}

/**
 * The facts Aglyn AI reads from the site's own settings (AGL-3661): the
 * name, the business type and every way to reach the business. Read-only
 * here, each with a link to the card that edits it, because those settings
 * already have a home and a second copy would drift.
 *
 * It is also the promise made visible: a contact detail that is not entered
 * reads "Not entered", and the AI writes around it rather than inventing one.
 */
export function BusinessFactsCard(props: BusinessFactsCardProps) {
  const { hostId, orgSlug, host } = props
  const firestore = useFirestore()
  const { data: site, status } = useFirestoreDoc<BusinessProfileHost>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
  )
  const profile = useMemo(() => resolveBusinessProfile({ host: site ?? null }), [site])
  const rows: FactRow[] = [
    { label: 'Business name', value: profile.name?.value ?? null, section: 'seo' },
    { label: 'Business type', value: profile.businessType, section: 'seo' },
    { label: 'Email', value: profile.contact.email, section: 'details' },
    { label: 'Phone', value: profile.contact.phone, section: 'seo' },
    { label: 'Address', value: profile.contact.address, section: 'details' },
    { label: 'Opening hours', value: profile.contact.hours, section: 'seo' },
    {
      label: 'Social profiles',
      value: profile.profiles.length ? profile.profiles.join('\n') : null,
      section: 'details',
    },
  ]
  const link = (section: FactRow['section']) =>
    orgSlug && host
      ? buildRoute(section === 'seo' ? Route.HOST_SETUP_SEO : Route.HOST_SETUP_DETAILS, { orgSlug, host })
      : null

  return (
    <CardDisplay
      header="From your site settings"
      subheader={`${aiAddonName()} uses these exactly as entered. It never makes up a name, an email, a phone number, an address or opening hours.`}
      help={docsHelp('businessProfile', {
        anchor: '#contact-details-are-never-invented',
        excerpt: 'Contact details come only from Setup → Basic details and SEO. A detail that is not entered is left out.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack divider={<Divider flexItem />} data-testid="business-facts">
        {rows.map((row) => {
          const href = link(row.section)
          return (
            <Box
              key={row.label}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr auto', sm: '180px 1fr auto' },
                alignItems: 'center',
                columnGap: 2,
                rowGap: 0.5,
                py: 1.25,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {row.label}
              </Typography>
              <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, gridRow: { xs: 2, sm: 'auto' }, minWidth: 0 }}>
                {row.value ? (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                    {row.value.split('\n').map((part, index) => (
                      <Fragment key={index}>
                        {index ? '\n' : null}
                        {part}
                      </Fragment>
                    ))}
                  </Typography>
                ) : (
                  <StatusChip
                    label={status === 'loading' ? 'Loading…' : 'Not entered'}
                    tone="neutral"
                    variant="outlined"
                  />
                )}
              </Box>
              {href ? (
                <AppLink componentVariant="button" size="small" href={href} sx={{ justifySelf: 'end' }}>
                  {row.value ? 'Edit' : 'Add'}
                </AppLink>
              ) : (
                <span />
              )}
            </Box>
          )
        })}
      </Stack>
    </CardDisplay>
  )
}
BusinessFactsCard.displayName = 'BusinessFactsCard'

export default BusinessFactsCard
