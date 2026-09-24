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
import { hostEventLabel, pluginDocsHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
/*
 * The MODULE, not the barrel, for the two pure helpers — the cards' specs
 * mock `@aglyn/tenant-feature-instance` wholesale, and a query builder
 * imported through that barrel disappears under the mock.
 */
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import {
  Alert,
  Button,
  Menu,
  MenuItem,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { collection } from 'firebase/firestore'
import { useState } from 'react'
import {
  orgSiteAutomationPath,
  type WorkflowsOrgMount,
} from './workflows-org-mount'

/** The three site collections the org hub lists across its sites. */
export type OrgSiteAutomationKind = 'workflows' | 'actions' | 'webhooks'

/**
 * How many sites a list opens with their rows read. The rest wait behind
 * "Show more" — and, since each site's rows are read by the row group that
 * shows them, are not read until then either.
 */
export const ORG_SITE_LIST_OPEN_SITES = 5

/**
 * The most sites one list will read, however many the organization has —
 * the platform's per-scan site bound. Past it the list says so and each
 * site's own hub is the way in.
 */
export const ORG_SITE_LIST_MAX_SITES = 25

/**
 * Rows read per site. A ceiling with a probe row, not a page: the org list is
 * an index of where things are, and each site's own hub holds the full,
 * editable list the row links to.
 */
export const ORG_SITE_LIST_ROWS = 10

/** A trigger bound to one element, which makes an `actions` row an interaction. */
const LEAF_SELECTOR = /^\[data-aglyn="leaf:.+"\]$/

const COPY: Record<
  OrgSiteAutomationKind,
  { header: string; noun: string; plural: string; intro: string }
> = {
  workflows: {
    header: 'Workflows on every site',
    noun: 'workflow',
    plural: 'workflows',
    intro:
      'Every site’s workflows, side by side. A workflow calls its own site’s ' +
      'functions and variables, so it is built and edited in that site’s ' +
      'Automation.',
  },
  actions: {
    header: 'Actions on every site',
    noun: 'action',
    plural: 'actions',
    intro:
      'Every site’s own actions, side by side. To run one automation on ' +
      'several sites, make it an org automation instead.',
  },
  webhooks: {
    header: 'Webhooks on every site',
    noun: 'webhook',
    plural: 'webhooks',
    intro:
      'Every site’s webhooks, side by side. A webhook holds its site’s ' +
      'address and secret, so it is managed in that site’s Automation.',
  },
}

/**
 * EVERY SITE'S WORKFLOWS, ACTIONS OR WEBHOOKS, on the org hub (AGL-3302).
 *
 * Read-only and bounded: one ceilinged read per open site, the first
 * {@link ORG_SITE_LIST_OPEN_SITES} sites on arrival and up to
 * {@link ORG_SITE_LIST_MAX_SITES} when asked, each row naming its site and
 * linking into that site's own Automation hub, where the thing is edited.
 * "Add" asks which site and goes there.
 *
 * `canRead` gates the webhooks list: a webhook holds its site's secret and
 * the rules admit only a site's admins and editors, so a reader who is
 * neither is told so rather than handed listeners that would be refused.
 */
export function OrgSiteAutomationList(props: {
  mount: WorkflowsOrgMount
  kind: OrgSiteAutomationKind
  canRead: boolean
}) {
  const { mount, kind, canRead } = props
  const copy = COPY[kind]
  const [opened, setOpened] = useState(false)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const reachable = mount.hosts.slice(0, ORG_SITE_LIST_MAX_SITES)
  const shown = opened
    ? reachable
    : reachable.slice(0, ORG_SITE_LIST_OPEN_SITES)
  const folded = reachable.length - shown.length
  const linkable = mount.hosts.filter((host) =>
    orgSiteAutomationPath(mount, host.id, kind),
  )
  return (
    <CardDisplay
      header={copy.header}
      help={pluginDocsHelp('orgAutomations', {
        anchor: '#every-sites-own-automations',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {copy.intro}
        </Typography>
        {!canRead ? (
          <Alert severity="info">
            {`Each site’s ${copy.plural} are listed for its admins and editors.`}
          </Alert>
        ) : !mount.hostsReady ? (
          <Typography variant="caption" color="text.secondary">
            {'…'}
          </Typography>
        ) : !mount.hosts.length ? (
          <Typography variant="body2" color="text.secondary">
            {'This organization has no sites yet.'}
          </Typography>
        ) : (
          <>
            <ScrollTable size="small" aria-label={copy.header}>
              <TableHead>
                <TableRow>
                  <TableCell>{'Name'}</TableCell>
                  <TableCell>{'Site'}</TableCell>
                  <TableCell>
                    {kind === 'webhooks' ? 'Direction' : 'Trigger'}
                  </TableCell>
                  <TableCell>{'Status'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((host) => (
                  <SiteRows key={host.id} mount={mount} host={host} kind={kind} />
                ))}
              </TableBody>
            </ScrollTable>
            {folded > 0 ? (
              <Button
                size="small"
                variant="text"
                onClick={() => setOpened(true)}
                sx={{ alignSelf: 'flex-start' }}
              >
                {`Show ${folded} more ${folded === 1 ? 'site' : 'sites'}`}
              </Button>
            ) : null}
            {mount.hosts.length > ORG_SITE_LIST_MAX_SITES ? (
              <Alert severity="info">
                {`Listing the first ${ORG_SITE_LIST_MAX_SITES} sites. Open a ` +
                  `site’s own Automation for the ${copy.plural} of the rest.`}
              </Alert>
            ) : null}
          </>
        )}
        {linkable.length ? (
          <Stack direction="row" spacing={1} sx={{ alignSelf: 'flex-start' }}>
            <Button
              size="small"
              color="primary"
              aria-haspopup="menu"
              onClick={(event) => setAddAnchor(event.currentTarget)}
            >
              {`Add ${copy.noun} on a site`}
            </Button>
          </Stack>
        ) : null}
      </Stack>
      <Menu
        anchorEl={addAnchor}
        open={Boolean(addAnchor)}
        onClose={() => setAddAnchor(null)}
      >
        {linkable.map((host) => (
          <MenuItem
            key={host.id}
            component={AppLink as any}
            {...({ componentVariant: 'naked' } as any)}
            href={orgSiteAutomationPath(mount, host.id, kind) ?? ''}
            onClick={() => setAddAnchor(null)}
          >
            {host.name || host.subdomain || host.id}
          </MenuItem>
        ))}
      </Menu>
    </CardDisplay>
  )
}
OrgSiteAutomationList.displayName = 'OrgSiteAutomationList'

/** How a row's trigger or direction reads. */
function rowTrigger(kind: OrgSiteAutomationKind, row: any): string {
  if (kind === 'webhooks') {
    return row?.direction === 'inbound' ? 'Inbound' : 'Outbound'
  }
  const event = row?.trigger?.event
  if (!event) return kind === 'workflows' ? 'Run by other automations' : '—'
  return hostEventLabel(event)
}

/** How a row's status reads. */
function rowStatus(kind: OrgSiteAutomationKind, row: any): string {
  if (kind === 'workflows') return 'Ready'
  return row?.enabled === false ? 'Off' : 'On'
}

/**
 * One site's rows: its own ceilinged read, drawn as table rows naming the
 * site. A site with none draws nothing; one past the ceiling says so in a row
 * that links to where the rest are.
 */
function SiteRows(props: {
  mount: WorkflowsOrgMount
  host: ConsolePluginOrgHost
  kind: OrgSiteAutomationKind
}) {
  const { mount, host, kind } = props
  const firestore = useFirestore()
  const { data } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', host.id, kind),
        ORG_SITE_LIST_ROWS,
      ),
    [firestore, host.id, kind],
    { idField: '$id' },
  )
  const { rows, truncated } = ceilingedWindow<any>(data, ORG_SITE_LIST_ROWS)
  const live = (rows ?? []).filter(
    (row: any) =>
      !row.deletedAt &&
      // An element interaction belongs to its page, not to the site's
      // automation list — the site's own Actions card counts rather than
      // lists them, and so does this.
      !(kind === 'actions' && LEAF_SELECTOR.test(String(row?.trigger?.selector ?? ''))),
  )
  const siteName = host.name || host.subdomain || host.id
  const href = orgSiteAutomationPath(mount, host.id, kind)
  const site = href ? (
    <AppLink href={href} underline="hover">
      {siteName}
    </AppLink>
  ) : (
    siteName
  )
  return (
    <>
      {live.map((row: any) => (
        <TableRow key={`${host.id}/${row.$id}`}>
          <TableCell>
            {href ? (
              <AppLink href={href} underline="hover">
                {String(row.name || row.$id)}
              </AppLink>
            ) : (
              String(row.name || row.$id)
            )}
          </TableCell>
          <TableCell>{site}</TableCell>
          <TableCell>{rowTrigger(kind, row)}</TableCell>
          <TableCell>{rowStatus(kind, row)}</TableCell>
        </TableRow>
      ))}
      {truncated ? (
        <TableRow>
          <TableCell colSpan={4}>
            <Typography variant="caption" color="text.secondary">
              {`${siteName} has more than ${ORG_SITE_LIST_ROWS} — `}
              {href ? (
                <AppLink href={href} underline="hover">
                  {'open the site to see them all'}
                </AppLink>
              ) : (
                'open the site to see them all'
              )}
            </Typography>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
SiteRows.displayName = 'SiteRows'

export default OrgSiteAutomationList
