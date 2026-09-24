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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  orgSiteName,
  orgSitePageLabel,
  useEmailOrgMount,
  useOrgSitePage,
  type EmailOrgMount,
} from './email-org-mount'
import {
  readSuppressionTotals,
  SUPPRESSION_REASONS,
  type SuppressionTotals,
} from './suppression-totals'

/** The breakdown's columns, in the order a site's own card lists its chips. */
const REASON_COLUMNS: ReadonlyArray<keyof SuppressionTotals> = [
  'unsubscribe',
  'bounce',
  'complaint',
  'manual',
]

/** A site's figures, or why there are none. */
type SiteTotals = SuppressionTotals | 'failed'

/**
 * EVERY SITE'S SUPPRESSION LIST, SUMMED BY REASON.
 *
 * A suppression is one site's: the unsubscribe was from that site's mail, the
 * bounce was an address that site sent to, and the send path filters each
 * site's audience by its own list. So the organization's page does not merge
 * the lists into one — an address suppressed on one site is still mailable by
 * another — it answers the question a person managing several sites actually
 * has, "is any site's list going stale?", with one row per site, and opens a
 * site's own list from its row.
 *
 * The figures are the same four server aggregates a site's own card reads,
 * through the same function, so a row here and that site's chips agree. They
 * are read for one page of sites at a time and never as documents: a
 * suppression list can hold tens of thousands of addresses, and an aggregate
 * costs the same whatever it counts.
 */
export function OrgSuppressionsCard() {
  const mount = useEmailOrgMount()
  return mount ? <OrgSuppressionsTable mount={mount} /> : null
}
OrgSuppressionsCard.displayName = 'OrgSuppressionsCard'

function OrgSuppressionsTable(props: { mount: EmailOrgMount }) {
  const { mount } = props
  const firestore = useFirestore()
  const router = useRouter()
  const sitePage = useOrgSitePage(mount)
  const { sites } = sitePage
  const [totals, setTotals] = useState<Record<string, SiteTotals>>({})

  /*
   * Each site is counted ONCE per visit. Paging asks only the sites not yet
   * counted, so paging back re-reads nothing. An answer is kept whenever it
   * lands, so moving on mid-flight does not strand a site's count — only
   * leaving the section discards one.
   */
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    for (const site of sites) {
      if (requested.current.has(site.id)) continue
      requested.current.add(site.id)
      const settle = (read: SiteTotals) => {
        if (mounted.current) {
          setTotals((current) => ({ ...current, [site.id]: read }))
        }
      }
      void readSuppressionTotals(firestore, site.id)
        .then(settle)
        .catch(() => settle('failed'))
    }
  }, [firestore, sites])

  const siteHref = (hostId: string) =>
    `${mount.basePath}/suppressions/${encodeURIComponent(hostId)}`
  const noSites = mount.hostsReady && mount.hosts.length === 0
  const anyFailed = sites.some((site) => totals[site.id] === 'failed')

  return (
    <CardDisplay
      header="Suppressions"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#suppressions' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Addresses each site’s marketing email skips, and why. Every site ' +
            'keeps its own list — someone who unsubscribed from one site can ' +
            'still be emailed by another — so open a site to see who is on ' +
            'its list, or to add or remove someone.'}
        </Typography>
        {noSites ? (
          <Typography variant="body2" color="text.secondary">
            {'This organization has no sites yet.'}
          </Typography>
        ) : (
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Site'}</TableCell>
                {REASON_COLUMNS.map((reason) => (
                  <TableCell key={reason} align="right">
                    {SUPPRESSION_REASONS[reason].label}
                  </TableCell>
                ))}
                <TableCell align="right">{'Total'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sites.map((site) => {
                const read = totals[site.id]
                const figures = read && read !== 'failed' ? read : null
                /*
                 * Loading and failed are different answers, and neither is a
                 * zero. A dash says the count could not be read; the ellipsis
                 * says it has not arrived yet.
                 */
                const cell = (value: number | undefined) =>
                  figures
                    ? Number(value ?? 0).toLocaleString()
                    : read === 'failed'
                      ? '—'
                      : '…'
                const total = figures
                  ? REASON_COLUMNS.reduce(
                      (sum, reason) => sum + figures[reason],
                      0,
                    )
                  : undefined
                return (
                  <TableRow
                    key={site.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => router.push(siteHref(site.id))}
                  >
                    <TableCell>
                      {/*
                        The row's own handler would fire too and push the same
                        route twice — one history entry per back press.
                       */}
                      <AppLink
                        href={siteHref(site.id)}
                        onClick={(event: { stopPropagation: () => void }) =>
                          event.stopPropagation()
                        }
                      >
                        {orgSiteName(mount, site.id)}
                      </AppLink>
                    </TableCell>
                    {REASON_COLUMNS.map((reason) => (
                      <TableCell key={reason} align="right">
                        {cell(figures?.[reason])}
                      </TableCell>
                    ))}
                    <TableCell align="right">{cell(total)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ScrollTable>
        )}
        {anyFailed ? (
          <Typography variant="caption" color="text.secondary">
            {'A dash is a count that could not be read. It is not the same ' +
              'as nobody being suppressed.'}
          </Typography>
        ) : null}
        {noSites ? null : (
          <ListPagination
            page={sitePage.page}
            pageSize={sitePage.pageSize}
            rowCount={sites.length}
            count={sitePage.count}
            onPageChange={sitePage.setPage}
            labelDisplayedRows={orgSitePageLabel}
          />
        )}
      </Stack>
    </CardDisplay>
  )
}
OrgSuppressionsTable.displayName = 'OrgSuppressionsTable'

export default OrgSuppressionsCard
