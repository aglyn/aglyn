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
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  percent,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { Alert, Button, Stack, Typography } from '@mui/material'
import {
  collection,
  getCountFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useCrmOrgMount } from '../../hooks/use-crm-org-mount'
import { ReportBreakdown } from './report-breakdown'
import { ReportExport } from './report-export'
import { plural, reportFilename } from './report-format'
import { type CrmReportScope, reportCacheKey } from './report-scope'
import { ReportStatTile } from './report-stat-tile'
import { useAggregateRead, useWindowRead } from './use-aggregate-read'

/**
 * How many of the period's leads the funnel is placed from — the Leads
 * section's own window, over the period rather than over everything.
 *
 * The captured count is a server aggregate and never meets this bound; the
 * funnel needs each lead's status and reason, so it reads the period's
 * newest two hundred and says when there were more.
 */
const LEAD_CEILING = 200
/** How many reasons the bar list draws; the rest are counted beneath it. */
const REASONS_SHOWN = 8

/** The CSV's columns: one file for both the statuses and the reasons. */
const COLUMNS = ['Kind', 'Label', 'Count', 'Share'] as const

type LeadRow = Record<string, unknown> & Aglyn.CrmLeadFields & { $id: string }

export interface LeadFunnelCardProps {
  report: CrmReportScope
  /**
   * The site whose leads are placed. A lead lives under its host, not the
   * org — `hosts/{hostId}/leads`, private by path, no `visibleTo` — so the
   * report's org scope cannot reach it and the card is told the site. At
   * the organization level `null` (AGL-2630): the card then reads the site
   * the reader picked for creates, and with none picked says so.
   */
  hostId: string | null
}

const LEAD_FUNNEL_HELP = Aglyn.pluginDocsHelp('crmReports', {
  anchor: '#lead-funnel',
  excerpt:
    'Of the leads this site captured in the period, how many are ' +
    'still new, being worked, qualified or unqualified — and the ' +
    'reasons the unqualified ones were closed. Placed by when each ' +
    'lead was first seen.',
})

/**
 * The site the funnel reads, decided once (AGL-2630).
 *
 * Under a site: that site. At the organization level the reports total
 * every site, but leads have no cross-site listener a report can afford —
 * one per site, each its own window — so the card places the leads of the
 * site the reader has picked for creates and names it in the subheader;
 * before any pick it has nothing to read and says so instead of guessing.
 */
export function LeadFunnelCard(props: LeadFunnelCardProps) {
  const { report, hostId } = props
  const mount = useCrmOrgMount()
  const siteId = hostId ?? mount?.createHostId ?? null
  if (!siteId) {
    return (
      <CardDisplay header={'Lead funnel'} help={LEAD_FUNNEL_HELP} contentGutterX contentGutterY>
        <Typography variant="body2" color="text.secondary">
          {'Leads live under a site. Pick one — in New contact, New deal or ' +
            'any other create — and this card places that site’s leads.'}
        </Typography>
      </CardDisplay>
    )
  }
  return (
    <SiteLeadFunnelCard
      report={report}
      hostId={siteId}
      siteName={hostId ? undefined : mount?.siteName(siteId)}
    />
  )
}

/**
 * The lead funnel (AGL-2624): of the leads this site captured in the
 * period, how many are still new, being worked, qualified or unqualified —
 * and why the unqualified ones were closed.
 *
 * A cohort by first sighting, followed to where each lead stands now,
 * because that is the question a period asks of leads — "what became of
 * the ones we got" — and because a lead's status has no history on the
 * document: only its current value. The window is a range on
 * `firstSeenAtMs`, which the capture door stamps once on creation and
 * never again, so a returning visitor's second form is not a second lead
 * in a second period. A single-field range needs no composite index.
 *
 * Read directly off `hosts/{hostId}/leads` under the site's own rules —
 * any member of the site may read it — the way the Leads section reads
 * it, so the funnel and the list can never disagree about who may see a
 * lead.
 */
function SiteLeadFunnelCard(props: {
  report: CrmReportScope
  hostId: string
  /** Named at the organization level, where the site was picked and not mounted. */
  siteName?: string
}) {
  const { report, hostId, siteName } = props
  const { range, period, routes } = report
  const firestore = useFirestore()

  const leadsBetween = (from: number, to: number) =>
    query(
      collection(firestore, 'hosts', hostId, 'leads'),
      where('firstSeenAtMs', '>=', from),
      where('firstSeenAtMs', '<', to),
    )
  const countOf = (target: ReturnType<typeof query>) =>
    getCountFromServer(target).then((snapshot) => snapshot.data().count)

  const captured = useAggregateRead(
    () =>
      Promise.all([
        countOf(leadsBetween(range.from, range.to)),
        countOf(leadsBetween(range.previousFrom, range.previousTo)),
      ]).then(([current, previous]) => ({ current, previous })),
    [firestore, hostId, range],
    { cacheKey: reportCacheKey(report, `leads:counts:${hostId}`) },
  )
  const window = useWindowRead<LeadRow>(
    () =>
      query(
        leadsBetween(range.from, range.to),
        orderBy('firstSeenAtMs', 'desc'),
        limit(LEAD_CEILING + 1),
      ),
    LEAD_CEILING,
    [firestore, hostId, range],
    { cacheKey: reportCacheKey(report, `leads:window:${hostId}`) },
  )
  const status = window.status

  const funnel = useMemo(() => Aglyn.leadFunnel(window.rows), [window])
  const read = status === 'success'
  const figures = captured.value
  const share = (count: number, of: number): string | null =>
    of > 0 ? percent(count / of) : null
  const sampled =
    read &&
    (window.truncated ||
      (figures !== null && figures.current > window.rows.length))
  const caption = sampled
    ? `Placed from the ${window.rows.length.toLocaleString()} most recently captured leads` +
      (figures !== null ? ` of ${figures.current.toLocaleString()}` : '') +
      ' in the period; the captured tile is counted on the server.'
    : undefined
  const reasons = funnel.reasons.slice(0, REASONS_SHOWN)
  const moreReasons = funnel.reasons.length - reasons.length

  return (
    <CardDisplay
      header={'Lead funnel'}
      subheader={siteName}
      help={LEAD_FUNNEL_HELP}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={routes.section('leads')}
            size="small"
            color="primary"
          >
            {'Open leads'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <ReportStatTile
            label={'Leads captured'}
            value={figures ? figures.current.toLocaleString() : null}
            deltaPct={figures ? Aglyn.deltaPercent(figures.current, figures.previous) : null}
            note={'first seen in the period'}
            href={routes.section('leads')}
          />
          <ReportStatTile
            label={'Qualified'}
            value={read ? funnel.byStatus.qualified.toLocaleString() : null}
            note={
              funnel.qualifiedRate === null
                ? read
                  ? 'nobody captured in the period'
                  : undefined
                : `${percent(funnel.qualifiedRate)} of those captured`
            }
          />
          <ReportStatTile
            label={'Unqualified'}
            value={read ? funnel.byStatus.unqualified.toLocaleString() : null}
            note={
              funnel.unqualifiedRate === null
                ? undefined
                : `${percent(funnel.unqualifiedRate)} of those captured`
            }
            riseIsGood={false}
          />
          <ReportStatTile
            label={'Still open'}
            value={read ? funnel.open.toLocaleString() : null}
            note={'new or being worked'}
            href={routes.section('leads')}
          />
        </Stack>
        {captured.status === 'error' || status === 'error' ? (
          <Alert severity="warning">{'This site’s leads could not be read.'}</Alert>
        ) : null}
        <Section title={'Where they stand'}>
          <ReportBreakdown
            rows={Aglyn.CRM_LEAD_STATUSES.map((leadStatus) => ({
              key: leadStatus,
              label: Aglyn.CRM_LEAD_STATUS_LABELS[leadStatus],
              value: funnel.byStatus[leadStatus],
              note: share(funnel.byStatus[leadStatus], funnel.total) ?? undefined,
              color:
                leadStatus === 'qualified'
                  ? 'success.main'
                  : leadStatus === 'unqualified'
                    ? 'warning.main'
                    : undefined,
            }))}
            emptyText={''}
          />
          {read && !funnel.total ? (
            <Typography variant="body2" color="text.secondary">
              {'No leads captured in this period.'}
            </Typography>
          ) : null}
        </Section>
        <Section title={'Why leads were unqualified'}>
          <ReportBreakdown
            rows={reasons.map((reason) => ({
              key: reason.key,
              label: reason.label,
              value: reason.count,
              note: share(reason.count, funnel.byStatus.unqualified) ?? undefined,
              color: 'warning.main',
            }))}
            emptyText={
              status === 'loading' ? 'Reading…' : 'No lead was unqualified in this period.'
            }
          />
          {moreReasons > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {`And ${plural(moreReasons, 'other reason')}, each given once or twice.`}
            </Typography>
          ) : null}
        </Section>
        <ReportExport
          filename={reportFilename('lead-funnel', period)}
          columns={COLUMNS}
          rows={() => [
            ...Aglyn.CRM_LEAD_STATUSES.map((leadStatus) => [
              'Status',
              Aglyn.CRM_LEAD_STATUS_LABELS[leadStatus],
              funnel.byStatus[leadStatus],
              share(funnel.byStatus[leadStatus], funnel.total) ?? '',
            ]),
            ...funnel.reasons.map((reason) => [
              'Unqualified reason',
              reason.label,
              reason.count,
              share(reason.count, funnel.byStatus.unqualified) ?? '',
            ]),
          ]}
          disabled={!read || !funnel.total}
          caption={caption}
        />
      </Stack>
    </CardDisplay>
  )
}
SiteLeadFunnelCard.displayName = 'SiteLeadFunnelCard'
LeadFunnelCard.displayName = 'LeadFunnelCard'

export default LeadFunnelCard
