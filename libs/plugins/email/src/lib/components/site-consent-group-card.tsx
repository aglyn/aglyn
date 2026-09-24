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

import { pluginDocsHelp, type ConsentGroup } from '@aglyn/aglyn'
import { consentGroupDisclosure } from '@aglyn/aglyn/app-utils/consent-groups'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Stack, Typography } from '@mui/material'
import { readConsentGroupChangeMarker } from './consent-groups-api'

export interface SiteConsentGroupCardProps {
  hostId: string
  /** The group this site sends as, resolved by the page from the org document. */
  consentGroup: ConsentGroup
  /** The org document, for its slug and any change in flight. */
  org?: Record<string, unknown> | null
}

/**
 * Which sender this site is, read-only (AGL-3320).
 *
 * A consent group is declared for the organization, so a site's Emails page
 * says what it is part of and where that is changed, and changes nothing
 * itself. Pure, from the org document the shell already holds: it costs no
 * read, which is also why it can say how many other sites share the group
 * but not which — naming them would mean reading sites this reader may not
 * be able to open.
 */
export function SiteConsentGroupCard(props: SiteConsentGroupCardProps) {
  const { hostId, consentGroup, org } = props
  const slug = typeof org?.['slug'] === 'string' ? org['slug'] : ''
  const orgPage = slug ? `/${slug}/emails/consent-groups` : null
  const marker = readConsentGroupChangeMarker(org)
  const changing = marker != null && marker.hostIds.includes(hostId)
  const disclosure = consentGroupDisclosure(consentGroup)
  const others = consentGroup.hostIds.length - 1

  return (
    <CardDisplay
      header="Consent group"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#consent-groups' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {changing ? (
          <Alert severity="info">
            {marker.phase === 'carry'
              ? 'Your organization is changing its consent groups, and this ' +
                'site is part of the change. Nothing has changed yet: until it ' +
                'takes effect, this site sends as described below.'
              : 'Your organization changed its consent groups, and this site is ' +
                'part of the change. What is described below is already in ' +
                'effect; the CRM records it shares are still being combined.'}
          </Alert>
        ) : null}
        {consentGroup.declared && consentGroup.name ? (
          <Typography variant="body2">
            {`This site sends as part of ${consentGroup.name}, with ${others} ` +
              `other ${others === 1 ? 'site' : 'sites'}.` +
              (disclosure ? ` Signup forms here say: “${disclosure}”` : '') +
              ' Someone who unsubscribes from any of them stops getting ' +
              'marketing email from all of them.'}
          </Typography>
        ) : (
          <Typography variant="body2">
            {'This site sends on its own: someone who signs up here hears only ' +
              'from this site, and an unsubscribe here applies to this site ' +
              'alone.'}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {'Change this on your organization’s '}
          {orgPage ? <AppLink href={orgPage}>{'Emails page'}</AppLink> : 'Emails page'}
          {'.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
SiteConsentGroupCard.displayName = 'SiteConsentGroupCard'

export default SiteConsentGroupCard
