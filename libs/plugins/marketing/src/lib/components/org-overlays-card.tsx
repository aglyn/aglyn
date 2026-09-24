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
  type AglynOrgBilling,
  checkEntitlement,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { compareOverlayPrecedence, overlayStatus, type HostOverlay } from '../model'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Chip,
  Stack,
  Switch,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  type Firestore,
} from 'firebase/firestore'
import { Fragment, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { useMarketingOrgMount } from './marketing-org-mount'
import {
  OrgSitePickerButton,
  orgSiteSectionHref,
} from './org-site-picker-button'
import {
  overlayDisplayName,
  overlayEngagementLabel,
  overlayPagesLabel,
  overlayWindowLabel,
} from './overlay-labels'
import { ORG_SITES_PER_PAGE, useOrgSiteReads } from './use-one-shot-reads'

/**
 * How many overlays are read for each site.
 *
 * Smaller than the site's own ceiling on purpose: a site runs a handful of
 * bars and popups, a page here holds a page of sites' worth of them, and a
 * site with more says so on its row and links to its own list, where every
 * one of them is — and where the order they take can be changed.
 */
export const ORG_OVERLAYS_PER_SITE = 10

type OverlayRow = HostOverlay & { $id: string }

/** What one site's group of rows is drawn from. */
interface SiteOverlays {
  /** In the order the site shows them: see `compareOverlayPrecedence`. */
  rows: OverlayRow[]
  /** The site has more overlays than were read. */
  truncated: boolean
  /**
   * Whether the site's always-on default bar and popup would show — the ones
   * a matching overlay takes priority over. `null` when the site document
   * could not be read, which is drawn as nothing rather than as "off".
   */
  defaults: { bar: boolean; popup: boolean } | null
}

/**
 * One site's overlays and its defaults: the overlays ordered and ceilinged
 * the way the site's own list reads them — `name` is on every overlay its
 * only creator writes — and the host document for the defaults, which the
 * console shell already listens to for its site list.
 */
async function readSiteOverlays(
  firestore: Firestore,
  hostId: string,
): Promise<SiteOverlays> {
  const [overlays, host] = await Promise.all([
    getDocs(
      query(
        collection(firestore, 'hosts', hostId, 'overlays'),
        orderBy('name'),
        limit(ORG_OVERLAYS_PER_SITE + 1),
      ),
    ),
    getDoc(doc(firestore, 'hosts', hostId)).catch(() => null),
  ])
  const { rows, truncated } = ceilingedWindow(
    overlays.docs.map(
      (entry) => ({ ...(entry.data() as HostOverlay), $id: entry.id }) as OverlayRow,
    ),
    ORG_OVERLAYS_PER_SITE,
  )
  const site = host?.exists() ? (host.data() as Record<string, any>) : null
  return {
    // In the order the site shows them. A window the ceiling cut short is
    // the first overlays by name, and the site's line says so.
    rows: [...rows].sort(compareOverlayPrecedence),
    truncated,
    // The same test the page enricher applies before it draws either one.
    defaults: site
      ? {
          bar: Boolean(site.announcementBar?.enabled && site.announcementBar?.text),
          popup: Boolean(site.popup?.enabled && site.popup?.body),
        }
      : null,
  }
}

const STATUS_CHIP: Record<
  ReturnType<typeof overlayStatus>,
  { label: string; color: 'default' | 'info' | 'success' }
> = {
  off: { label: 'Off', color: 'default' },
  scheduled: { label: 'Scheduled', color: 'info' },
  live: { label: 'Live', color: 'success' },
}

/** Columns in a row, so a site's own line can span all of them. */
const COLUMNS = 7

export interface OrgOverlaysCardProps {
  /** The org's plan, for the `marketingOverlays` entitlement. */
  org?: Partial<AglynOrgBilling>
}

/**
 * Every site's announcement bars and popups, on the organization's
 * Marketing hub.
 *
 * READ-ONLY but for the switch. An overlay is drawn on one site's pages and
 * written against that site's variables, screens and order, so its editor
 * stays on the site: each row's Edit and the New button open the site's own
 * Overlays section. What the org hub adds is the view across sites — which
 * of them are showing what, and their lifetime engagement — and the one
 * change that needs no editor, turning an overlay on or off.
 *
 * Grouped by site, each group in the order the site shows its overlays,
 * under a line naming the site and whether its default bar and popup are
 * on. No 14-day analytics row: that is a document read per day per site,
 * and it lives on the site.
 */
export function OrgOverlaysCard(props: OrgOverlaysCardProps) {
  const { org } = props
  const mount = useMarketingOrgMount()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const entitled = checkEntitlement(org, 'marketingOverlays')

  const sites = mount?.hosts ?? []
  const [page, setPage] = useState(0)
  const pageSites = sites.slice(
    page * ORG_SITES_PER_PAGE,
    (page + 1) * ORG_SITES_PER_PAGE,
  )
  const { reads, patch } = useOrgSiteReads<SiteOverlays>(
    entitled ? pageSites.map((site) => site.id) : [],
    (hostId) => readSiteOverlays(firestore, hostId),
    [firestore, entitled],
  )

  /**
   * One field, merged, on the row's own site — the write the site's own
   * switch makes, and one the rules allow every editor of that site.
   */
  const handleToggle = async (hostId: string, overlay: OverlayRow) => {
    const enabled = overlay.enabled === false
    try {
      await setDoc(
        doc(firestore, 'hosts', hostId, 'overlays', overlay.$id),
        { enabled },
        { merge: true },
      )
      patch(hostId, (site) => ({
        ...site,
        rows: site.rows.map((row) =>
          row.$id === overlay.$id ? { ...row, enabled } : row,
        ),
      }))
    } catch (error) {
      console.error(error)
      enqueueSnackbar('The overlay could not be switched', {
        variant: 'error',
      })
    }
  }

  return (
    <CardDisplay
      header="Announcement bars & popups"
      subheader="Every site in this organization"
      help={pluginDocsHelp('marketingOverlays', {
        anchor: '#across-your-sites',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {!entitled ? (
        <Alert severity="info">
          {'Announcement bars and popups are included from the Starter ' +
            'plan — see Billing to upgrade.'}
        </Alert>
      ) : !mount || !mount.hostsReady ? null : !sites.length ? (
        <Typography variant="body2" color="text.secondary">
          {'This organization has no sites yet. Overlays are drawn on a ' +
            'site’s pages, so they are created on a site.'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="body2" color="text.secondary">
              {'Each site shows the first matching bar and popup in its own ' +
                'order. Edit and create them on the site; switch them on or ' +
                'off here.'}
            </Typography>
            <OrgSitePickerButton
              mount={mount}
              section="overlays"
              label="New overlay"
            />
          </Stack>
          <ScrollTable size="small" aria-label="Overlays by site">
            <TableHead>
              <TableRow>
                <TableCell>{'Overlay'}</TableCell>
                <TableCell>{'Kind'}</TableCell>
                <TableCell>{'Status'}</TableCell>
                <TableCell>{'Window'}</TableCell>
                <TableCell>{'Pages'}</TableCell>
                <TableCell>{'Engagement'}</TableCell>
                <TableCell align="right">{'Actions'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageSites.map((site) => {
                const read = reads.get(site.id)
                const answer = read?.value ?? null
                const href = orgSiteSectionHref(mount, site.id, 'overlays')
                const name = site.name || site.subdomain || site.id
                return (
                  <Fragment key={site.id}>
                    {/* The site's own line: its name, its defaults, and what was not read. */}
                    <TableRow>
                      <TableCell colSpan={COLUMNS}>
                        <Stack
                          direction="row"
                          spacing={2}
                          sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
                        >
                          <Typography variant="subtitle2">
                            {href ? <AppLink href={href}>{name}</AppLink> : name}
                          </Typography>
                          {answer?.defaults ? (
                            <Typography variant="caption" color="text.secondary">
                              {`Default bar ${answer.defaults.bar ? 'on' : 'off'} · ` +
                                `default popup ${answer.defaults.popup ? 'on' : 'off'}`}
                            </Typography>
                          ) : null}
                          {answer?.truncated ? (
                            <Typography variant="caption" color="text.secondary">
                              {`More than ${ORG_OVERLAYS_PER_SITE} on this ` +
                                'site — these are the first by name; the ' +
                                'site’s own list has every one.'}
                            </Typography>
                          ) : null}
                        </Stack>
                      </TableCell>
                    </TableRow>
                    {read?.status === 'error' ? (
                      <TableRow>
                        <TableCell colSpan={COLUMNS}>
                          <Typography variant="body2" color="text.secondary">
                            {'This site’s overlays could not be read.'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : answer && !answer.rows.length ? (
                      <TableRow>
                        <TableCell colSpan={COLUMNS}>
                          <Typography variant="body2" color="text.secondary">
                            {'No overlays on this site.'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      (answer?.rows ?? []).map((overlay) => {
                        const status = STATUS_CHIP[overlayStatus(overlay, Date.now())]
                        return (
                          <TableRow key={overlay.$id}>
                            <TableCell>{overlayDisplayName(overlay)}</TableCell>
                            <TableCell>
                              {overlay.kind === 'bar' ? 'Bar' : 'Popup'}
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                color={status.color}
                                label={status.label}
                              />
                            </TableCell>
                            <TableCell>{overlayWindowLabel(overlay)}</TableCell>
                            <TableCell>{overlayPagesLabel(overlay)}</TableCell>
                            <TableCell>
                              <Typography variant="caption" color="text.secondary">
                                {overlayEngagementLabel(overlay.stats)}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Switch
                                size="small"
                                checked={overlay.enabled !== false}
                                onChange={() => void handleToggle(site.id, overlay)}
                                slotProps={{
                                  input: {
                                    'aria-label': `Show ${overlayDisplayName(overlay)} on ${name}`,
                                  },
                                }}
                              />
                              {/* A site the shell could not address has no Overlays section to open. */}
                              {href ? (
                                <AppLink
                                  componentVariant="button"
                                  href={href}
                                  size="small"
                                  color="primary"
                                  aria-label={`Edit ${overlayDisplayName(overlay)} on ${name}`}
                                >
                                  {'Edit'}
                                </AppLink>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </ScrollTable>
          <ListPagination
            page={page}
            pageSize={ORG_SITES_PER_PAGE}
            rowCount={pageSites.length}
            count={sites.length}
            onPageChange={setPage}
            labelDisplayedRows={({ from, to, count }) =>
              `Sites ${from}–${to} of ${count}`
            }
          />
        </Stack>
      )}
    </CardDisplay>
  )
}
OrgOverlaysCard.displayName = 'OrgOverlaysCard'

export default OrgOverlaysCard
