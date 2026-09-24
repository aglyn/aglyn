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
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  Alert,
  Divider,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useMemo, useState } from 'react'
import { campaignSendsQuery } from './campaign-queries'
import {
  readSendFigures,
  readSiteExperimentFigures,
  readSiteOverlayFigures,
  type SiteExperimentFigures,
  type SiteOverlayFigures,
} from './marketing-aggregates'
import { useMarketingOrgMount } from './marketing-org-mount'
import { orgSiteSectionHref } from './org-site-picker-button'
import { useOneShotRead, useOrgSiteReads } from './use-one-shot-reads'

/**
 * How many sites the Overview reads figures for.
 *
 * The one read on this card that grows with the organization: four
 * aggregations a site. Capped, the landing section of the org hub costs four
 * org-wide aggregations and four for each site up to this number, however
 * many sites there are; the sites past it are counted in a note rather than
 * read.
 */
export const ORG_OVERVIEW_SITE_CAP = 25

/** One site's figures: `null` for a channel the plan does not carry. */
interface SiteFigures {
  overlays: SiteOverlayFigures | null
  tests: SiteExperimentFigures | null
}

/** A figure as a cell prints it: a dash for one nobody has measured. */
const figure = (value: number | null | undefined): string =>
  value == null ? '—' : value.toLocaleString()

/**
 * A column's total, or `null` unless EVERY site in it answered. A total over
 * the sites that happened to answer would print as the organization's figure
 * while leaving some of it out.
 */
function totalOf(values: ReadonlyArray<number | null | undefined>): number | null {
  let total = 0
  for (const value of values) {
    if (value == null) return null
    total += value
  }
  return total
}

export interface OrgMarketingOverviewCardProps {
  /** The org's plan, for which channels it carries. */
  org?: Partial<AglynOrgBilling>
}

/**
 * Marketing at a glance, over every site — the landing section of the
 * organization's Marketing hub.
 *
 * The email figures come from ONE collection: campaign sends belong to the
 * organization (`orgs/{orgId}/campaigns`), so four aggregations over it
 * answer for every site at once. Overlays and A/B tests are a SITE's —
 * drawn on its pages, splitting its traffic — so their figures are read per
 * site, each site one row, and each row opens that site's own Overview.
 *
 * A channel the plan does not carry is left out rather than read: an
 * organization without overlays or A/B testing pays for no per-site reads
 * at all, and its landing is the email figures alone.
 */
export function OrgMarketingOverviewCard(props: OrgMarketingOverviewCardProps) {
  const { org } = props
  const mount = useMarketingOrgMount()
  const firestore = useFirestore()
  const orgId = mount?.orgId ?? null
  const overlaysOn = checkEntitlement(org, 'marketingOverlays')
  const testsOn = checkEntitlement(org, 'abTesting')

  const email = useOneShotRead(() => {
    const sends = campaignSendsQuery(firestore, orgId, null)
    return sends ? readSendFigures(sends) : null
  }, [firestore, orgId])

  const allSites = useMemo(() => mount?.hosts ?? [], [mount])
  const sites = useMemo(
    () => allSites.slice(0, ORG_OVERVIEW_SITE_CAP),
    [allSites],
  )
  const perSite = useOrgSiteReads<SiteFigures>(
    overlaysOn || testsOn ? sites.map((site) => site.id) : [],
    (hostId) =>
      Promise.all([
        overlaysOn ? readSiteOverlayFigures(firestore, hostId) : null,
        testsOn ? readSiteExperimentFigures(firestore, hostId) : null,
      ]).then(([overlays, tests]) => ({ overlays, tests })),
    [firestore, overlaysOn, testsOn],
  )

  const rows = useMemo(
    () =>
      sites.map((site) => {
        const answer = perSite.reads.get(site.id)?.value ?? null
        return {
          id: site.id,
          name: site.name || site.subdomain || site.id,
          href: mount ? orgSiteSectionHref(mount, site.id, 'overview') : null,
          views: answer?.overlays?.views ?? null,
          clicks: answer?.overlays?.clicks ?? null,
          running: answer?.tests?.running ?? null,
          decided: answer?.tests?.decided ?? null,
        }
      }),
    [sites, perSite.reads, mount],
  )
  const totals = useMemo(
    () => ({
      views: totalOf(rows.map((row) => row.views)),
      clicks: totalOf(rows.map((row) => row.clicks)),
      running: totalOf(rows.map((row) => row.running)),
      decided: totalOf(rows.map((row) => row.decided)),
    }),
    [rows],
  )

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize)
  const truncated = allSites.length > sites.length

  const sends = email.value
  const emailMetrics: Array<{ label: string; value: string }> = [
    { label: 'Emails sent', value: figure(sends?.sent) },
    {
      label: 'Opens / clicks',
      value: `${figure(sends?.opens)} / ${figure(sends?.clicks)}`,
    },
    ...(sends?.scheduled
      ? [{ label: 'Scheduled sends', value: figure(sends.scheduled) }]
      : []),
  ]

  return (
    <CardDisplay
      header={'At a glance'}
      subheader={'Every site in this organization'}
      help={pluginDocsHelp('marketingOverlays', {
        anchor: '#across-your-sites',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={3}
          sx={{ flexWrap: 'wrap', rowGap: 1.5 }}
        >
          {emailMetrics.map((metric) => (
            <Stack key={metric.label} spacing={0}>
              <Typography variant="caption" color="text.secondary">
                {metric.label}
              </Typography>
              <Typography variant="h6">{metric.value}</Typography>
            </Stack>
          ))}
        </Stack>

        {overlaysOn || testsOn ? (
          <>
            <Divider />
            {mount && !mount.hostsReady ? null : !sites.length ? (
              <Typography variant="body2" color="text.secondary">
                {'This organization has no sites yet, so there are no ' +
                  'overlays or A/B tests to count.'}
              </Typography>
            ) : (
              <Stack spacing={1}>
                {truncated ? (
                  <Alert severity="info">
                    {`This organization has ${allSites.length.toLocaleString()} ` +
                      `sites. The table and its totals cover the first ` +
                      `${ORG_OVERVIEW_SITE_CAP.toLocaleString()}; each other ` +
                      "site's own Marketing page has its figures."}
                  </Alert>
                ) : null}
                <ScrollTable size="small" aria-label="Figures by site">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Site'}</TableCell>
                      {overlaysOn ? (
                        <>
                          <TableCell align="right">{'Overlay views'}</TableCell>
                          <TableCell align="right">{'Overlay clicks'}</TableCell>
                        </>
                      ) : null}
                      {testsOn ? (
                        <>
                          <TableCell align="right">{'Tests running'}</TableCell>
                          <TableCell align="right">{'Tests decided'}</TableCell>
                        </>
                      ) : null}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pageRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {row.href ? (
                            <AppLink href={row.href}>{row.name}</AppLink>
                          ) : (
                            row.name
                          )}
                        </TableCell>
                        {overlaysOn ? (
                          <>
                            <TableCell align="right">{figure(row.views)}</TableCell>
                            <TableCell align="right">{figure(row.clicks)}</TableCell>
                          </>
                        ) : null}
                        {testsOn ? (
                          <>
                            <TableCell align="right">{figure(row.running)}</TableCell>
                            <TableCell align="right">{figure(row.decided)}</TableCell>
                          </>
                        ) : null}
                      </TableRow>
                    ))}
                    {/*
                      THE TOTALS, under every page: they are the sum of every
                      site the card read, not of the page on screen, and say
                      which when not every site was read.
                     */}
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>
                        {truncated
                          ? `These ${sites.length.toLocaleString()} sites`
                          : 'All sites'}
                      </TableCell>
                      {overlaysOn ? (
                        <>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {figure(totals.views)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {figure(totals.clicks)}
                          </TableCell>
                        </>
                      ) : null}
                      {testsOn ? (
                        <>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {figure(totals.running)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {figure(totals.decided)}
                          </TableCell>
                        </>
                      ) : null}
                    </TableRow>
                  </TableBody>
                </ScrollTable>
                <ListPagination
                  page={page}
                  pageSize={pageSize}
                  rowCount={pageRows.length}
                  count={rows.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
                <Typography variant="caption" color="text.secondary">
                  {'Overlay views and clicks are lifetime counts. A dash is ' +
                    'a figure that has not arrived or could not be read — ' +
                    'never a zero.'}
                </Typography>
              </Stack>
            )}
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
OrgMarketingOverviewCard.displayName = 'OrgMarketingOverviewCard'

export default OrgMarketingOverviewCard
