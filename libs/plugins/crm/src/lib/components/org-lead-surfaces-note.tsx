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

import type { ConsolePluginOrgHost } from '@aglyn/aglyn'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import { useCallback, useState } from 'react'
import { type CrmOrgMount, useCrmOrgMount } from '../hooks/use-crm-org-mount'
import type { LeadSurfaceForm } from '../model/lead-surfaces'
import {
  LEAD_SURFACES_CONTACTS_TOO,
  LEAD_SURFACES_INTRO,
  type LeadRoutingTarget,
  LeadSurfaceFormList,
  UnroutedLeadSurfaces,
  useLeadSurfaceForms,
  useTurnOnLeadRouting,
} from './lead-surfaces-note'

/**
 * How many sites the note opens with their forms showing. The rest sit
 * behind a count until asked for — and, since a site's forms are read by
 * the group that shows them, are not read until then either.
 */
export const ORG_LEAD_SURFACES_OPEN_SITES = 3

/**
 * WHAT CREATES A LEAD, ACROSS THE ORGANIZATION (AGL-2638).
 *
 * The org-level Leads section lists every site's leads in one table, and
 * for a while said nothing about why a form's people were in it: the
 * per-site note was drawn only under a site. This is the same note grouped
 * by site — each site's routed forms, the forms that could route with the
 * switch beside them, and the forms that cannot with the reason as the
 * tooltip — over the sites the mount already bounds. The always-on
 * surfaces are named once at the top, because a member sign-up files a
 * lead on every site and saying so three times would suggest otherwise.
 *
 * ## Bounded two ways
 *
 * The sites come from the mount, which the shell already capped; and only
 * the first {@link ORG_LEAD_SURFACES_OPEN_SITES} groups mount their reader
 * until the reader opens the rest, so an org with twenty sites opens three
 * listeners on arrival and not twenty.
 *
 * ## Links
 *
 * A site's name opens its own Leads section, and a form its own page, both
 * built from the mount's `hostsPath` and the site's subdomain the way the
 * mount builds a site's hub; a site whose subdomain never resolved is named
 * and not linked. No host-index read per site: the mount already answered.
 *
 * Rendered only beneath the org mount — under a site the hook answers
 * `null` and so does the note, which keeps the section's one-line choice
 * between the two notes honest.
 */
export function OrgLeadSurfacesNote() {
  const mount = useCrmOrgMount()
  const { turningOn, turnOn } = useTurnOnLeadRouting()
  const [opened, setOpened] = useState(false)
  if (!mount) return null
  const { hosts, hostsReady } = mount
  const shown = opened ? hosts : hosts.slice(0, ORG_LEAD_SURFACES_OPEN_SITES)
  const folded = hosts.length - shown.length
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {`${LEAD_SURFACES_INTRO}, on every site. ${LEAD_SURFACES_CONTACTS_TOO}`}
      </Typography>
      {!hostsReady ? (
        <Typography variant="caption" color="text.secondary">
          {'…'}
        </Typography>
      ) : !hosts.length ? (
        <Typography variant="body2" color="text.secondary">
          {'This organization has no sites yet.'}
        </Typography>
      ) : (
        <>
          {shown.map((host) => (
            <SiteLeadSurfaces
              key={host.id}
              host={host}
              mount={mount}
              turningOn={turningOn}
              onTurnOn={(form) =>
                void turnOn({ hostId: host.id, form, siteName: mount.siteName(host.id) })
              }
            />
          ))}
          {folded > 0 ? (
            <Button
              size="small"
              variant="text"
              onClick={() => setOpened(true)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {`Show ${folded} more ${folded === 1 ? 'site' : 'sites'}`}
            </Button>
          ) : hosts.length > ORG_LEAD_SURFACES_OPEN_SITES ? (
            <Button
              size="small"
              variant="text"
              onClick={() => setOpened(false)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {`Show the first ${ORG_LEAD_SURFACES_OPEN_SITES} sites only`}
            </Button>
          ) : null}
        </>
      )}
    </Stack>
  )
}
OrgLeadSurfacesNote.displayName = 'OrgLeadSurfacesNote'

/**
 * One site's group: its name, then the same two rows the site note draws,
 * read by the same reader. A site with no forms says so in one line rather
 * than drawing an empty "no form routes leads yet" that reads like a
 * verdict on forms that do not exist.
 */
function SiteLeadSurfaces(props: {
  host: ConsolePluginOrgHost
  mount: CrmOrgMount
  turningOn: LeadRoutingTarget | null
  onTurnOn: (form: LeadSurfaceForm) => void
}) {
  const { host, mount, turningOn, onTurnOn } = props
  const { routed, unrouted, truncated, status } = useLeadSurfaceForms(host.id)
  const name = mount.siteName(host.id)
  const hubHref = mount.siteHubHref(host.id)
  const subdomain = mount.siteSubdomain(host.id)
  const formHref = useCallback(
    (formId: string) =>
      subdomain
        ? `${mount.hostsPath}/${encodeURIComponent(subdomain)}/forms/${encodeURIComponent(formId)}`
        : null,
    [mount.hostsPath, subdomain],
  )
  return (
    <Stack spacing={0.25}>
      <Typography variant="subtitle2" component="div">
        {hubHref ? (
          <AppLink href={`${hubHref}/leads`} underline="hover">
            {name}
          </AppLink>
        ) : (
          name
        )}
      </Typography>
      <Typography variant="body2" color="text.secondary" component="div">
        {status === 'loading' ? (
          '…'
        ) : status === 'error' ? (
          'The forms on this site could not be read.'
        ) : !routed.length && !unrouted.length ? (
          'No forms on this site yet.'
        ) : routed.length ? (
          <>
            {'Routing leads: '}
            <LeadSurfaceFormList forms={routed} truncated={truncated} formHref={formHref} />
            {'.'}
          </>
        ) : (
          'No form routes leads yet.'
        )}
      </Typography>
      {unrouted.length ? (
        <UnroutedLeadSurfaces
          hostId={host.id}
          forms={unrouted}
          formHref={formHref}
          turningOn={turningOn}
          onTurnOn={onTurnOn}
        />
      ) : null}
    </Stack>
  )
}
SiteLeadSurfaces.displayName = 'SiteLeadSurfaces'

export default OrgLeadSurfacesNote
