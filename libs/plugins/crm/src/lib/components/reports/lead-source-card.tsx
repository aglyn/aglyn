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

import * as Aglyn from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  percent,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import {
  Alert,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { getDocs, limit, orderBy, query } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useCrmOrgMount } from '../../hooks/use-crm-org-mount'
import { useLeadSourcePicklist } from '../../hooks/use-lead-source-picklist'
import {
  LEAD_SOURCE_DIRECTION_LABELS,
  LEAD_SOURCE_UNSPECIFIED_LABEL,
  type LeadSourceDirection,
} from '../../model/lead-source-direction'
import { leadsByLeadSource } from '../../model/crm-reports'
import { LEAD_CEILING, leadsBetween } from './lead-funnel-card'
import { ReportExport } from './report-export'
import { reportFilename } from './report-format'
import { type CrmReportScope, reportCacheKey } from './report-scope'
import { ReportStatTile } from './report-stat-tile'
import { useAggregateRead, useWindowRead, type WindowRead } from './use-aggregate-read'

type LeadRow = Record<string, unknown> & Aglyn.CrmLeadFields & { $id: string }

/** The CSV's columns: one file for both tables. */
const COLUMNS = ['Kind', 'Label', 'Direction', 'Leads', 'Qualified', 'Conversion'] as const

const LEAD_SOURCE_HELP = Aglyn.pluginDocsHelp('crmReports', {
  anchor: '#lead-sources',
  excerpt:
    'The leads first seen in the period by their lead source, and by the ' +
    'direction each source is grouped under on the Fields page — Inbound, ' +
    'Outbound or Unspecified — with how many of each were qualified.',
})

const directionLabel = (direction: LeadSourceDirection | null): string =>
  direction ? LEAD_SOURCE_DIRECTION_LABELS[direction] : LEAD_SOURCE_UNSPECIFIED_LABEL

export interface LeadSourceCardProps {
  report: CrmReportScope
  /** The site whose leads are read, or `null` at the organization level — as the Lead funnel takes it. */
  hostId: string | null
}

/**
 * Lead sources (AGL-3511): of the leads first seen in the period, how many
 * came from each lead source and in each direction, and how many of each
 * were qualified.
 *
 * The SAME window the Lead funnel places — the period's newest leads by
 * `firstSeenAtMs`, under the same remembered key — so the two cards read
 * the period once between them and can never disagree about which leads
 * it holds. The lead source is grouped through the org's own list as it
 * stands now: a value moved to Outbound on the Fields page reports as
 * Outbound from that moment, for every lead that holds it.
 */
export function LeadSourceCard(props: LeadSourceCardProps) {
  const { report, hostId } = props
  const mount = useCrmOrgMount()
  if (hostId) return <SiteLeadSourceCard report={report} hostId={hostId} />
  if (mount && (!mount.hostsReady || mount.hosts.length > 0)) {
    return <OrgLeadSourceCard report={report} />
  }
  return (
    <CardDisplay header={'Lead sources'} help={LEAD_SOURCE_HELP} contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary">
        {mount
          ? 'Leads live under a site, and this organization has no sites yet.'
          : 'Leads live under a site, and this report is mounted under none.'}
      </Typography>
    </CardDisplay>
  )
}
LeadSourceCard.displayName = 'LeadSourceCard'

/** One site's window, under the Lead funnel's own key. */
function SiteLeadSourceCard(props: { report: CrmReportScope; hostId: string }) {
  const { report, hostId } = props
  const { range } = report
  const firestore = useFirestore()
  const window = useWindowRead<LeadRow>(
    () =>
      query(
        leadsBetween(firestore, report.scope[1], report.tokens, range.from, range.to),
        orderBy('firstSeenAtMs', 'desc'),
        limit(LEAD_CEILING + 1),
      ),
    LEAD_CEILING,
    [firestore, hostId, range],
    { cacheKey: reportCacheKey(report, `leads:window:${hostId}`) },
  )
  return <LeadSourceBody report={report} window={window} />
}
SiteLeadSourceCard.displayName = 'SiteLeadSourceCard'

/** The organization's one unscoped window, under the Lead funnel's own key. */
function OrgLeadSourceCard(props: { report: CrmReportScope }) {
  const { report } = props
  const { range } = report
  const firestore = useFirestore()
  const merged = useAggregateRead<{ rows: LeadRow[]; truncated: boolean }>(
    () =>
      getDocs(
        query(
          leadsBetween(firestore, report.scope[1], null, range.from, range.to),
          orderBy('firstSeenAtMs', 'desc'),
          limit(LEAD_CEILING + 1),
        ),
      ).then((snapshot) =>
        ceilingedWindow(
          snapshot.docs.map(
            (document) => ({ ...document.data(), $id: document.id }) as unknown as LeadRow,
          ),
          LEAD_CEILING,
        ),
      ),
    [firestore, report.scope, range],
    { cacheKey: reportCacheKey(report, 'leads:window:org') },
  )
  const window = useMemo<WindowRead<LeadRow>>(
    () => ({
      rows: merged.value?.rows ?? [],
      truncated: merged.value?.truncated ?? false,
      status: merged.status,
    }),
    [merged],
  )
  return <LeadSourceBody report={report} window={window} />
}
OrgLeadSourceCard.displayName = 'OrgLeadSourceCard'

/** The card as drawn, whichever level fed it. Pure over the window and the org's list. */
function LeadSourceBody(props: { report: CrmReportScope; window: WindowRead<LeadRow> }) {
  const { report, window } = props
  const { period } = report
  const { picklist } = useLeadSourcePicklist(report.scope[1])
  const breakdown = useMemo(() => leadsByLeadSource(window.rows, picklist), [window, picklist])
  const read = window.status === 'success'
  const direction = (id: LeadSourceDirection | null) =>
    breakdown.directions.find((row) => row.direction === id)
  const shareOf = (count: number | undefined): string | undefined =>
    read && breakdown.total > 0 && count !== undefined
      ? `${percent(count / breakdown.total)} of the period's leads`
      : undefined
  const sourceLabel = (label: string, listed: boolean) =>
    label ? (listed ? label : `${label} (not in the list)`) : 'No lead source'

  return (
    <CardDisplay
      header={'Lead sources'}
      help={LEAD_SOURCE_HELP}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <ReportExport
            filename={reportFilename('lead-sources', period)}
            columns={COLUMNS}
            rows={() => [
              ...breakdown.directions.map((row) => [
                'Direction',
                directionLabel(row.direction),
                '',
                row.leads,
                row.qualified,
                row.leads ? percent(row.rate) : '',
              ]),
              ...breakdown.rows.map((row) => [
                'Lead source',
                sourceLabel(row.label, row.listed),
                directionLabel(row.direction),
                row.leads,
                row.qualified,
                percent(row.rate),
              ]),
            ]}
            disabled={!read || !breakdown.total}
          />
        ),
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <ReportStatTile
            label={LEAD_SOURCE_DIRECTION_LABELS.inbound}
            value={read ? (direction('inbound')?.leads ?? 0).toLocaleString() : null}
            note={shareOf(direction('inbound')?.leads)}
          />
          <ReportStatTile
            label={LEAD_SOURCE_DIRECTION_LABELS.outbound}
            value={read ? (direction('outbound')?.leads ?? 0).toLocaleString() : null}
            note={shareOf(direction('outbound')?.leads)}
          />
          <ReportStatTile
            label={LEAD_SOURCE_UNSPECIFIED_LABEL}
            value={read ? (direction(null)?.leads ?? 0).toLocaleString() : null}
            note={'no lead source, or one in no group'}
          />
        </Stack>
        {window.status === 'error' ? (
          <Alert severity="warning">{'The period’s leads could not be read.'}</Alert>
        ) : null}
        <Section title={'By direction'}>
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                {['Direction', 'Leads', 'Qualified', 'Conversion'].map((column, index) => (
                  <TableCell key={column} align={index ? 'right' : 'left'}>
                    {column}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {breakdown.directions.map((row) => (
                <TableRow key={row.direction ?? 'none'}>
                  <TableCell>{directionLabel(row.direction)}</TableCell>
                  <TableCell align="right">{read ? row.leads.toLocaleString() : '—'}</TableCell>
                  <TableCell align="right">{read ? row.qualified.toLocaleString() : '—'}</TableCell>
                  <TableCell align="right">{read && row.leads ? percent(row.rate) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        </Section>
        <Section title={'By lead source'}>
          {breakdown.rows.length ? (
            <ScrollTable size="small">
              <TableHead>
                <TableRow>
                  {['Lead source', 'Direction', 'Leads', 'Qualified', 'Conversion'].map(
                    (column, index) => (
                      <TableCell key={column} align={index > 1 ? 'right' : 'left'}>
                        {column}
                      </TableCell>
                    ),
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {breakdown.rows.map((row) => (
                  <TableRow key={row.label || 'none'}>
                    <TableCell>{sourceLabel(row.label, row.listed)}</TableCell>
                    <TableCell>{directionLabel(row.direction)}</TableCell>
                    <TableCell align="right">{row.leads.toLocaleString()}</TableCell>
                    <TableCell align="right">{row.qualified.toLocaleString()}</TableCell>
                    <TableCell align="right">{percent(row.rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ScrollTable>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {window.status === 'loading' ? 'Reading…' : 'No leads first seen in this period.'}
            </Typography>
          )}
          {read && window.truncated ? (
            <Typography variant="caption" color="text.secondary">
              {`Read from the ${window.rows.length.toLocaleString()} most recently captured leads in the period.`}
            </Typography>
          ) : null}
        </Section>
      </Stack>
    </CardDisplay>
  )
}
LeadSourceBody.displayName = 'LeadSourceBody'

export default LeadSourceCard
