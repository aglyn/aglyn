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
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { Alert, Button, Stack, Typography } from '@mui/material'
import {
  collection,
  type Firestore,
  getCountFromServer,
  getDocs,
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
import {
  type AggregateRead,
  useAggregateRead,
  useWindowRead,
  type WindowRead,
} from './use-aggregate-read'

/**
 * How many of the period's leads the funnel is placed from — the Leads
 * section's own window, over the period rather than over everything.
 *
 * The captured count is a server aggregate and never meets this bound; the
 * funnel needs each lead's status and reason, so it reads the period's
 * newest two hundred and says when there were more. At the organization
 * level the bound is PER SITE (AGL-2634): each site's window is its own,
 * and a site with a thousand leads must not crowd out a site with ten.
 */
export const LEAD_CEILING = 200
/** How many reasons the bar list draws; the rest are counted beneath it. */
const REASONS_SHOWN = 8

/** The CSV's columns: one file for both the statuses and the reasons. */
const COLUMNS = ['Kind', 'Label', 'Count', 'Share'] as const

type LeadRow = Record<string, unknown> & Aglyn.CrmLeadFields & { $id: string }

/** The period's captured count, and the previous period's for the delta. */
interface CapturedFigures {
  current: number
  previous: number
}

export interface LeadFunnelCardProps {
  report: CrmReportScope
  /**
   * The site whose leads are placed. A lead lives under its host, not the
   * org — `hosts/{hostId}/leads`, private by path, no `visibleTo` — so the
   * report's org scope cannot reach it and the card is told the site. At
   * the organization level `null` (AGL-2630): the card then reads every
   * site the mount lists, one window each (AGL-2634).
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

/** One site's leads first seen in a range — a single-field range, no composite index. */
function leadsBetween(firestore: Firestore, hostId: string, from: number, to: number) {
  return query(
    collection(firestore, 'hosts', hostId, 'leads'),
    where('firstSeenAtMs', '>=', from),
    where('firstSeenAtMs', '<', to),
  )
}

const countOf = (target: ReturnType<typeof query>) =>
  getCountFromServer(target).then((snapshot) => snapshot.data().count)

/**
 * The lead funnel, at whichever level the report is mounted (AGL-2624,
 * AGL-2630, AGL-2634).
 *
 * Under a site: that site. At the organization level: every site the
 * mount lists, one window each, totaled — the org hub's reports total
 * every site, and the leads are no exception now that the fan-out is
 * bounded by the org's site list. With no sites to read the card says so
 * instead of guessing.
 */
export function LeadFunnelCard(props: LeadFunnelCardProps) {
  const { report, hostId } = props
  const mount = useCrmOrgMount()
  if (hostId) return <SiteLeadFunnelCard report={report} hostId={hostId} />
  if (mount && (!mount.hostsReady || mount.hosts.length > 0)) {
    return <OrgLeadFunnelCard report={report} />
  }
  return (
    <CardDisplay header={'Lead funnel'} help={LEAD_FUNNEL_HELP} contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary">
        {mount
          ? 'Leads live under a site, and this organization has no sites yet.'
          : 'Leads live under a site, and this report is mounted under none.'}
      </Typography>
    </CardDisplay>
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
function SiteLeadFunnelCard(props: { report: CrmReportScope; hostId: string }) {
  const { report, hostId } = props
  const { range } = report
  const firestore = useFirestore()

  const captured = useAggregateRead<CapturedFigures>(
    () =>
      Promise.all([
        countOf(leadsBetween(firestore, hostId, range.from, range.to)),
        countOf(leadsBetween(firestore, hostId, range.previousFrom, range.previousTo)),
      ]).then(([current, previous]) => ({ current, previous })),
    [firestore, hostId, range],
    { cacheKey: reportCacheKey(report, `leads:counts:${hostId}`) },
  )
  const window = useWindowRead<LeadRow>(
    () =>
      query(
        leadsBetween(firestore, hostId, range.from, range.to),
        orderBy('firstSeenAtMs', 'desc'),
        limit(LEAD_CEILING + 1),
      ),
    LEAD_CEILING,
    [firestore, hostId, range],
    { cacheKey: reportCacheKey(report, `leads:window:${hostId}`) },
  )
  const figures = captured.value
  const sampled =
    window.status === 'success' &&
    (window.truncated || (figures !== null && figures.current > window.rows.length))
  return (
    <LeadFunnelBody
      report={report}
      captured={captured}
      window={window}
      caption={
        sampled
          ? `Placed from the ${window.rows.length.toLocaleString()} most recently captured leads` +
            (figures !== null ? ` of ${figures.current.toLocaleString()}` : '') +
            ' in the period; the captured tile is counted on the server.'
          : undefined
      }
      errorText={'This site’s leads could not be read.'}
    />
  )
}
SiteLeadFunnelCard.displayName = 'SiteLeadFunnelCard'

/**
 * THE CROSS-SITE FUNNEL (AGL-2634): every site of the organization, one
 * window each, totaled.
 *
 * The counts are one server aggregate per site per period, summed. The
 * windows are one bounded read per site — the site card's own query, the
 * same ceiling — merged newest-seen first and NOT cut again: the funnel
 * is a placement of leads by status, and cutting the merged list would
 * place a busy site's leads and drop a quiet site's. What the ceiling
 * bounds is the read per site, and the caption says so when any site had
 * more than its window. Held until the mount's site list has settled, so
 * a first round against a partial list is not answered and remembered.
 */
function OrgLeadFunnelCard(props: { report: CrmReportScope }) {
  const { report } = props
  const { range } = report
  const firestore = useFirestore()
  const mount = useCrmOrgMount()
  const hostIds = useMemo(
    () => (mount?.hostsReady ? mount.hosts.map((host) => host.id) : null),
    [mount],
  )
  const key = hostIds?.join('\n') ?? ''

  const captured = useAggregateRead<CapturedFigures>(
    () =>
      hostIds
        ? Promise.all(
            hostIds.map((hostId) =>
              Promise.all([
                countOf(leadsBetween(firestore, hostId, range.from, range.to)),
                countOf(leadsBetween(firestore, hostId, range.previousFrom, range.previousTo)),
              ]),
            ),
          ).then((pairs) =>
            pairs.reduce(
              (sum, [current, previous]) => ({
                current: sum.current + current,
                previous: sum.previous + previous,
              }),
              { current: 0, previous: 0 },
            ),
          )
        : null,
    [firestore, key, range],
    { cacheKey: reportCacheKey(report, `leads:counts:org:${key}`) },
  )
  const merged = useAggregateRead<{ rows: LeadRow[]; truncated: boolean }>(
    () =>
      hostIds
        ? Promise.all(
            hostIds.map((hostId) =>
              getDocs(
                query(
                  leadsBetween(firestore, hostId, range.from, range.to),
                  orderBy('firstSeenAtMs', 'desc'),
                  limit(LEAD_CEILING + 1),
                ),
              ).then((snapshot) =>
                ceilingedWindow(
                  snapshot.docs.map(
                    (document) =>
                      ({ ...document.data(), $id: `${hostId}/${document.id}` }) as unknown as LeadRow,
                  ),
                  LEAD_CEILING,
                ),
              ),
            ),
          ).then((windows) => ({
            rows: windows
              .flatMap((window) => window.rows)
              .sort(
                (a, b) =>
                  Number(b['firstSeenAtMs'] ?? 0) - Number(a['firstSeenAtMs'] ?? 0),
              ),
            truncated: windows.some((window) => window.truncated),
          }))
        : null,
    [firestore, key, range],
    { cacheKey: reportCacheKey(report, `leads:window:org:${key}`) },
  )
  const window = useMemo<WindowRead<LeadRow>>(
    () => ({
      rows: merged.value?.rows ?? [],
      truncated: merged.value?.truncated ?? false,
      status: merged.status,
    }),
    [merged],
  )
  const sites = hostIds?.length ?? 0
  const figures = captured.value
  const sampled =
    window.status === 'success' &&
    (window.truncated || (figures !== null && figures.current > window.rows.length))
  return (
    <LeadFunnelBody
      report={report}
      subheader={`Every site (${sites.toLocaleString()})`}
      captured={captured}
      window={window}
      caption={
        sampled
          ? `Placed from the ${window.rows.length.toLocaleString()} most recently captured leads` +
            ` across ${plural(sites, 'site')} — at most ${LEAD_CEILING.toLocaleString()} per site` +
            (figures !== null ? ` — of ${figures.current.toLocaleString()}` : '') +
            ' in the period; the captured tile is counted on the server.'
          : undefined
      }
      errorText={'Some site’s leads could not be read.'}
    />
  )
}
OrgLeadFunnelCard.displayName = 'OrgLeadFunnelCard'

/**
 * The funnel as drawn, whichever level fed it: four tiles, the statuses,
 * the reasons, the export. Pure over the two reads.
 */
function LeadFunnelBody(props: {
  report: CrmReportScope
  subheader?: string
  captured: AggregateRead<CapturedFigures>
  window: WindowRead<LeadRow>
  caption?: string
  errorText: string
}) {
  const { report, subheader, captured, window, caption, errorText } = props
  const { period, routes } = report
  const status = window.status

  const funnel = useMemo(() => Aglyn.leadFunnel(window.rows), [window])
  const read = status === 'success'
  const figures = captured.value
  const share = (count: number, of: number): string | null =>
    of > 0 ? percent(count / of) : null
  const reasons = funnel.reasons.slice(0, REASONS_SHOWN)
  const moreReasons = funnel.reasons.length - reasons.length

  return (
    <CardDisplay
      header={'Lead funnel'}
      subheader={subheader}
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
          <Alert severity="warning">{errorText}</Alert>
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
LeadFunnelBody.displayName = 'LeadFunnelBody'
LeadFunnelCard.displayName = 'LeadFunnelCard'

export default LeadFunnelCard
