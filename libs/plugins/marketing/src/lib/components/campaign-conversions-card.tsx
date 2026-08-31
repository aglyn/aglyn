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
import { mdiEyeOutline, mdiMapMarkerOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { Figure, Section } from '@aglyn/shared-ui-email-campaigns/components/report-figures'
import {
  Alert,
  Button,
  Chip,
  Divider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import {
  collection,
  documentId,
  getCountFromServer,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useFirestore,
  useOrgDataScope,
  usePagedCollection,
} from '@aglyn/tenant-feature-instance'
/*
 * The MODULE, not the barrel, for the pure query helpers — a spec that mocks
 * `@aglyn/tenant-feature-instance` wholesale to stage its Firestore hooks
 * would otherwise lose them, and neither is a hook.
 */
import {
  ceilingedWindow,
  collectionCeiling,
  collectionPage,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import {
  CAMPAIGN_CONVERSION_KINDS,
  CAMPAIGN_CONVERSION_KIND_COPY,
  campaignConversionsCoverage,
  campaignTouchLabel,
  type CampaignConversionKind,
  type CampaignConversionRecord,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-conversions'

/**
 * WHAT THE CAMPAIGNS CAUSED, from the conversions' end.
 *
 * A campaign's own report says what that campaign caused. This is the list
 * the report cannot be: every credited conversion on the site, the ones
 * credited to a tagged web link rather than to a campaign document, and — the
 * half a report of successes can never show — how many were credited to
 * nothing at all.
 *
 * ## ONE KIND AT A TIME, and that is the whole design
 *
 * A form submission by a new person writes a submission record, a contact and
 * a lead. Three true statements about one visit, and a screen that showed
 * them together would invite the reader to add them and treble every figure.
 * So the kind is a MODE rather than a column: the query carries
 * `where('kind','==', …)`, only one kind's rows are ever on screen, and there
 * is no view in which two kinds could be totalled because there is no view in
 * which two kinds are both present.
 *
 * ## THE TWO CHANNELS ARE TWO LISTS, and never one
 *
 * An email touch names a campaign document — a real entity with a report to
 * open. A web touch names `utm_` text a marketer typed into a URL: no
 * document, no id, no bound on how many distinct values exist. Merging them
 * would put a linkable record and an unlinkable label in one column and imply
 * they are the same kind of thing, and grouping the web side into a rollup
 * would build a map anybody who can vary a query string can grow. So there
 * are two tables, the web one is read as records, and neither is summed into
 * the other.
 *
 * ## The read cost
 *
 * Two paged listeners bounded by the page size, and two aggregation counts.
 * Nothing scans a collection, no row triggers a read of its own, and the
 * landing-page join — the only expensive thing here — is behind a button and
 * says what it will cost before it runs.
 */

/**
 * How many attribution records the landing-page join reads.
 *
 * A CEILING rather than a page size: grouping is over a window and a window
 * sliced ten at a time cannot be grouped at all. Kept low because this is the
 * one read on the surface that is measured in hundreds — see the button that
 * asks for it.
 */
const LANDING_PAGE_CEILING = 100

/** Firestore's cap on the values in one `in` filter. */
const ID_CHUNK = 30

const conversionsDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#the-campaign-report',
  excerpt:
    'A conversion is credited to the last campaign whose link the visitor ' +
    'followed. The four kinds count different things about the same visits ' +
    'and are never added together.',
})

/** The stored record plus the document name the reader listed it under. */
type ConversionRow = CampaignConversionRecord & { $id: string }

const day = (ms: unknown): string => {
  const value = Number(ms ?? 0)
  return Number.isFinite(value) && value > 0
    ? new Date(value).toLocaleString()
    : '—'
}

export interface CampaignConversionsCardProps {
  hostId: string
  /** The marketing hub URL, for the link to each credited campaign. */
  basePath: string
  /**
   * One campaign's conversions rather than the whole site's.
   *
   * Set from `/marketing/conversions/{campaignId}`. It narrows the EMAIL list
   * only: a web-channel record carries no campaign id, so there is nothing
   * for it to be narrowed by — and the uncredited figure is withheld
   * entirely, because a conversion credited to nobody belongs to no campaign
   * and attributing the site's whole direct traffic to whichever campaign the
   * reader happens to be looking at is the exact inference this join refuses
   * to make.
   */
  campaignId?: string
}

export function CampaignConversionsCard(props: CampaignConversionsCardProps) {
  const { hostId, basePath, campaignId } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { scope: dataScope } = useOrgDataScope({ hostId })
  const [kind, setKind] = useState<CampaignConversionKind>('form')

  const attributions = useCallback(
    () => collection(firestore, 'hosts', hostId, 'campaignAttributions'),
    [firestore, hostId],
  )

  /*==========================================
   * THE TWO LISTS.
   *
   * Both walk the collection in DOCUMENT-NAME order through `collectionPage`,
   * which is the console's one ordering decision: `orderBy` on a field
   * matches only documents that HAVE it, so ordering on a date would hide
   * rows rather than merely mis-order them, and an unordered `limit()` is a
   * pseudo-random sample whose gaps leave nothing to notice. The walk is
   * total — every row is reachable by paging — and it is deliberately NOT
   * newest-first, which the note under each table says out loud.
   *
   * `campaignId` narrows the email list when the reader arrived from one
   * campaign. It is never applied to the web list: a `utm_` label is not a
   * campaign id and a query pretending otherwise would return nothing while
   * reading as "this campaign caused no web conversions".
   *=========================================*/
  const emailList = usePagedCollection<ConversionRow>(
    (pageLimit) =>
      collectionPage(
        campaignId
          ? query(
              attributions(),
              where('kind', '==', kind),
              where('campaignId', '==', campaignId),
            )
          : query(
              attributions(),
              where('kind', '==', kind),
              where('channel', '==', 'email'),
            ),
        pageLimit,
      ),
    [firestore, hostId, kind, campaignId],
    { idField: '$id' },
  )

  const webList = usePagedCollection<ConversionRow>(
    (pageLimit) =>
      collectionPage(
            query(
              attributions(),
              where('kind', '==', kind),
              where('channel', '==', 'web'),
            ),
            pageLimit,
          ),
    [firestore, hostId, kind, campaignId],
    { idField: '$id' },
  )

  /*==========================================
   * THE UNCREDITED HALF.
   *
   * Two aggregation counts, and they are on the page by DEFAULT rather than
   * behind a button, because the tables above them are a list of the
   * successes: showing only those renders "we credited nine of these" as
   * "nine of these happened", which is the conclusion this surface exists to
   * stop a reader drawing. An aggregation is billed per thousand index
   * entries rather than per document, so the honest figure costs about as
   * much as one row.
   *
   * Withheld entirely when either count fails. Defaulting the total to the
   * attributed figure would render every conversion as attributed, which is
   * the most flattering wrong answer available here.
   *=========================================*/
  /*
   * A PATH STRING and a BOOLEAN, not an object.
   *
   * Both are effect dependencies, and an object rebuilt on every render
   * reopens the effect on every render — which here means paying for two
   * aggregation counts per render rather than per kind. Primitives compare by
   * value, so the reads happen when the question changes and not when React
   * re-runs the component.
   */
  const totalCollectionPath = useMemo((): string | null => {
    switch (kind) {
      case 'form':
        return `hosts/${hostId}/formSubmissions`
      case 'lead':
        return `hosts/${hostId}/leads`
      case 'booking':
        return `hosts/${hostId}/bookings`
      case 'contact':
        /*
         * ORG-SCOPED, and the coverage model is told so below. A contact is
         * shared across every site in the org while an attribution belongs to
         * one host, so this total counts contacts created on another site
         * that could never have been credited here.
         */
        return dataScope ? `${dataScope[0]}/${dataScope[1]}/contacts` : null
      default:
        return null
    }
  }, [kind, hostId, dataScope])

  /** The kind's records live outside this host, so the total over-counts. */
  const totalCrossesHosts = kind === 'contact'

  const [attributedCount, setAttributedCount] = useState<number | null>(null)
  const [totalCount, setTotalCount] = useState<number | null>(null)

  useEffect(() => {
    // A campaign-scoped view has no uncredited figure to compute — see the
    // prop's docblock — so it does not pay for one either.
    if (campaignId || !totalCollectionPath) {
      setAttributedCount(null)
      setTotalCount(null)
      return
    }
    let active = true
    setAttributedCount(null)
    setTotalCount(null)
    void getCountFromServer(query(attributions(), where('kind', '==', kind)))
      .then((snapshot) => {
        if (active) setAttributedCount(snapshot.data().count)
      })
      .catch(() => {
        // Left null, which withholds the split. See the block comment.
      })
    const segments = totalCollectionPath.split('/')
    void getCountFromServer(
      collection(firestore, segments[0], ...segments.slice(1)),
    )
      .then((snapshot) => {
        if (active) setTotalCount(snapshot.data().count)
      })
      .catch(() => {
        // Left null, which withholds the split. See the block comment.
      })
    return () => {
      active = false
    }
  }, [attributions, firestore, kind, campaignId, totalCollectionPath])

  const coverage = campaignConversionsCoverage({
    kind,
    attributed: attributedCount,
    total: totalCount,
    crossHostTotal: totalCrossesHosts,
  })

  /*==========================================
   * LANDING PAGES — a join, and an EXPENSIVE one, so it is asked for.
   *
   * The attribution record carries `refId`; a form submission carries the
   * `path` it was submitted from. Joining the two is the only landing-page
   * answer the stored data supports, and the notice below says plainly what
   * it is not: `path` is where the FORM was, not where the campaign link
   * landed, so a visitor who arrived on one page and submitted on another is
   * grouped under the second.
   *
   * Two reads deep and both bounded: a ceiling over the attributions, then
   * their submissions by document name in chunks of thirty. `getDocs` rather
   * than a listener — a grouping nobody is watching does not need to be kept
   * live, and a listener would go on costing after the reader looked away.
   *=========================================*/
  const [landingBusy, setLandingBusy] = useState(false)
  const [landingError, setLandingError] = useState<string | null>(null)
  const [landing, setLanding] = useState<{
    rows: { $id: string; path: string; conversions: number }[]
    /** Attributions read, which is the population the grouping describes. */
    read: number
    /** The ceiling bit: there are more credited submissions than were read. */
    truncated: boolean
    /** Of `read`, how many named a submission that could not be found. */
    missing: number
  } | null>(null)

  // A grouping computed for one kind describes that kind. Switching the mode
  // leaves it on screen labelled as something it is not.
  useEffect(() => {
    setLanding(null)
    setLandingError(null)
  }, [kind, campaignId])

  const groupByLandingPage = useCallback(async () => {
    if (landingBusy) return
    setLandingBusy(true)
    setLandingError(null)
    try {
      const credited = await getDocs(
        collectionCeiling(
          campaignId
            ? query(
                attributions(),
                where('kind', '==', 'form'),
                where('campaignId', '==', campaignId),
              )
            : query(attributions(), where('kind', '==', 'form')),
          LANDING_PAGE_CEILING,
        ),
      )
      const { rows: credits, truncated } = ceilingedWindow(
        credited.docs.map((entry) => entry.data() as CampaignConversionRecord),
        LANDING_PAGE_CEILING,
      )
      const refIds = Array.from(
        new Set(
          credits
            .map((record) => String(record.refId ?? ''))
            .filter((id) => id.length > 0),
        ),
      )

      const submissions = collection(
        firestore,
        'hosts',
        hostId,
        'formSubmissions',
      )
      const paths = new Map<string, string>()
      for (let index = 0; index < refIds.length; index += ID_CHUNK) {
        const chunk = refIds.slice(index, index + ID_CHUNK)
        // eslint-disable-next-line no-await-in-loop
        const found = await getDocs(
          query(submissions, where(documentId(), 'in', chunk)),
        )
        found.docs.forEach((entry) => {
          const path = String((entry.data() as any)?.path ?? '').trim()
          if (path) paths.set(entry.id, path)
        })
      }

      const counts = new Map<string, number>()
      let missing = 0
      refIds.forEach((refId) => {
        const path = paths.get(refId)
        if (!path) {
          /*
           * The submission was deleted, or it carries no path — an older one,
           * or a form posted by an integration that sent none. Counted and
           * REPORTED rather than filed under a placeholder page: a bar
           * labelled "/" that is really "we do not know" is the kind of row a
           * reader acts on.
           */
          missing += 1
          return
        }
        counts.set(path, (counts.get(path) ?? 0) + 1)
      })

      setLanding({
        rows: Array.from(counts.entries())
          .map(([path, conversions]) => ({ $id: path, path, conversions }))
          .sort(
            (a, b) =>
              b.conversions - a.conversions || a.path.localeCompare(b.path),
          ),
        read: refIds.length,
        truncated,
        missing,
      })
    } catch (error) {
      console.error(error)
      setLandingError('The landing pages could not be read')
    } finally {
      setLandingBusy(false)
    }
  }, [attributions, campaignId, firestore, hostId, landingBusy])

  const campaignHref = (row: ConversionRow) =>
    row.campaignId ? `${basePath}/campaigns/${row.campaignId}` : undefined

  const columns = useMemo(
    () => [
      {
        field: 'refId',
        headerName: 'Record',
        flex: 1,
        minWidth: 200,
        renderCell: ({ row }: any) => (
          <Stack sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {String(row.refId ?? row.$id)}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {CAMPAIGN_CONVERSION_KIND_COPY[kind].label}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'campaign',
        headerName: 'Credited to',
        flex: 1,
        minWidth: 180,
        renderCell: ({ row }: any) => {
          const label = campaignTouchLabel(row) || '—'
          const href = campaignHref(row)
          return href ? (
            <AppLink
              href={href}
              onClick={(event: { stopPropagation: () => void }) =>
                event.stopPropagation()
              }
            >
              {label}
            </AppLink>
          ) : (
            <Typography variant="body2" noWrap>
              {label}
            </Typography>
          )
        },
      },
      {
        field: 'convertedAtMs',
        headerName: 'Converted',
        width: 190,
        renderCell: ({ row }: any) => (
          <Typography variant="body2" noWrap>
            {day(row.convertedAtMs)}
          </Typography>
        ),
      },
      listActionsColumn((row: any) => (
        <ListRowActions
          label={String(row.refId ?? row.$id)}
          items={[
            {
              key: 'campaign',
              label: 'Open campaign',
              icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
              href: campaignHref(row),
              disabled: !campaignHref(row),
              /*
               * Shown disabled with the reason rather than hidden. A control
               * that vanishes and one that does not apply look identical from
               * the outside, and only one of them is honest — there is no
               * campaign document behind a `utm_` label to open.
               */
              disabledReason:
                'This came from a tagged link rather than a campaign email, ' +
                'so there is no campaign to open',
            },
          ]}
        />
      )),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, basePath],
  )

  const landingColumns = useMemo(
    () => [
      {
        field: 'path',
        headerName: 'Page the form was on',
        flex: 1,
        minWidth: 240,
        renderCell: ({ row }: any) => (
          <Typography variant="body2" noWrap>
            {row.path}
          </Typography>
        ),
      },
      {
        field: 'conversions',
        headerName: 'Credited submissions',
        width: 190,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }: any) => (
          <Typography variant="body2">
            {Number(row.conversions).toLocaleString()}
          </Typography>
        ),
      },
    ],
    [],
  )

  const kindCopy = CAMPAIGN_CONVERSION_KIND_COPY[kind]

  return (
    <CardDisplay
      header="Conversions"
      subheader={
        campaignId
          ? 'Credited to this campaign'
          : 'What the campaigns caused, one kind at a time'
      }
      help={conversionsDocsHelp}
      HeaderProps={{
        action: campaignId ? (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={`${basePath}/conversions`}
            size="small"
            color="primary"
          >
            {'All conversions'}
          </Button>
        ) : undefined,
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {/*
          THE KIND IS A MODE, NOT A COLUMN.

          One form submission by a new person writes a submission, a contact
          and a lead, so any view holding two kinds at once invites a total
          that counts one visit twice. Only one kind's rows can be on screen,
          which is what makes the addition unavailable rather than merely
          discouraged.
         */}
        <Stack spacing={1}>
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            value={kind}
            onChange={(_event, next) => {
              if (next) setKind(next as CampaignConversionKind)
            }}
            aria-label="Conversion kind"
          >
            {CAMPAIGN_CONVERSION_KINDS.map((one) => (
              <ToggleButton key={one} value={one}>
                {CAMPAIGN_CONVERSION_KIND_COPY[one].label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">
            {'One kind at a time. The four count different things about the ' +
              'same visits — one person filling in one form appears as a ' +
              'submission, a contact and a lead — so they are never shown ' +
              'together and never added.'}
          </Typography>
        </Stack>

        <Divider />

        {/*==========================================
          * WHAT IS NOT CREDITED, beside what is.
          *
          * The tables below list the successes. Without this strip the reader
          * has no way to see how much of their site's activity the campaigns
          * account for, and every campaign reads as more effective than it is.
          *=========================================*/}
        {campaignId ? (
          <Alert severity="info">
            {'This is one campaign’s share. Conversions credited to no ' +
              'campaign belong to no campaign, so they are not counted here ' +
              '— open all conversions for the site-wide figure.'}
          </Alert>
        ) : coverage ? (
          <Section title={`${kindCopy.label} on this site`}>
            <Stack
              direction="row"
              spacing={4}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <Figure
                label="Credited to a campaign"
                value={coverage.attributed}
                note="from a campaign email or a tagged link"
              />
              <Figure
                label="Not credited"
                value={coverage.unattributed}
                note="arrived directly, or predate attribution"
              />
              <Figure
                label={`${kindCopy.label} in total`}
                value={coverage.total}
                note={
                  coverage.exact ? 'on this site' : 'on this site, all time'
                }
              />
            </Stack>
            {coverage.caveats.map((caveat) => (
              <Alert key={caveat.id} severity="info">
                {caveat.message}
              </Alert>
            ))}
          </Section>
        ) : (
          <Alert severity="info">
            {'How many of these were credited to no campaign could not be ' +
              'counted, so it is not shown. The lists below are the credited ' +
              'ones only and are not a count of everything that happened.'}
          </Alert>
        )}

        <Divider />

        <Section title="From campaign emails">
          <ListTable
            rows={emailList.rows}
            columns={columns as any}
            hideFooter
            onOpen={(_id, row) => {
              const href = campaignHref(row as ConversionRow)
              if (href) router.push(href)
            }}
            noRowsLabel="Nothing credited to a campaign email"
            noRowsDescription={
              'A conversion is credited when the visitor followed a link in ' +
              'a campaign email before converting.'
            }
          />
          <ListPagination
            page={emailList.page}
            pageSize={emailList.pageSize}
            rowCount={emailList.rows.length}
            hasMore={emailList.hasMore}
            onPageChange={emailList.setPage}
            onPageSizeChange={emailList.setPageSize}
          />
          <Typography variant="caption" color="text.secondary">
            {'Listed in the order they are stored, which is not the order ' +
              'they happened in — every row is reachable by paging, but the ' +
              'first page is not the most recent conversions.'}
          </Typography>
        </Section>

        {/*==========================================
          * THE WEB CHANNEL — its own list, and no rollup.
          *
          * A `utm_` label is text somebody typed into a URL. There is no
          * document behind it, no id, and no bound on how many distinct
          * values exist, so it gets no rollup under a campaign and no summary
          * keyed on the label: a map anybody who can vary a query string can
          * grow is a map that grows. The records stand on their own and this
          * lists them.
          *
          * Absent entirely on a campaign-scoped view, because these belong to
          * no campaign.
          *=========================================*/}
        {campaignId ? null : (
          <Section title="From tagged web links">
            <Typography variant="body2" color="text.secondary">
              {'Credited to the utm_ label on the link the visitor followed. ' +
                'These are listed one by one rather than grouped: the label ' +
                'is free text with no campaign behind it, so there is ' +
                'nothing to open and no fixed set to total.'}
            </Typography>
            <ListTable
              rows={webList.rows}
              columns={columns as any}
              hideFooter
              noRowsLabel="Nothing credited to a tagged link"
              noRowsDescription={
                'A conversion lands here when the visitor arrived on a URL ' +
                'carrying utm_ parameters.'
              }
            />
            <ListPagination
              page={webList.page}
              pageSize={webList.pageSize}
              rowCount={webList.rows.length}
              hasMore={webList.hasMore}
              onPageChange={webList.setPage}
              onPageSizeChange={webList.setPageSize}
            />
          </Section>
        )}

        {/*==========================================
          * LANDING PAGES, on request.
          *
          * `refId` on the record, `path` on the submission: joining those is
          * the landing-page surface, and it is hundreds of reads, so it is a
          * button rather than something every reader of this page pays for.
          *=========================================*/}
        {kind === 'form' ? (
          <>
            <Divider />
            <Section title="Landing pages">
              <Typography variant="body2" color="text.secondary">
                {'Groups credited form submissions by the page the form was ' +
                  'on. This reads up to ' +
                  `${LANDING_PAGE_CEILING.toLocaleString()} attribution ` +
                  'records and their submissions, so it runs when you ask ' +
                  'for it rather than on every visit.'}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={landingBusy}
                  startIcon={
                    <MdiIcon path={mdiMapMarkerOutline.path} size={0.8} />
                  }
                  onClick={() => void groupByLandingPage()}
                >
                  {landingBusy ? 'Reading…' : 'Group by landing page'}
                </Button>
              </Stack>
              {landingError ? (
                <Alert severity="warning">{landingError}</Alert>
              ) : null}
              {landing ? (
                <Stack spacing={1}>
                  {/*
                    WHAT THIS CANNOT ANSWER, above the table rather than under
                    it. Every line is a question a reader will otherwise
                    assume it answered.
                   */}
                  <Alert severity="info">
                    {'This is the page each form sat on, not the page the ' +
                      'campaign link landed on — a visitor who arrived on ' +
                      'one page and submitted on another is counted under ' +
                      'the second. There is no conversion RATE here either: ' +
                      'the record carries no count of visits to a page from ' +
                      'a campaign, so there is no denominator to divide by. ' +
                      'Only form submissions carry a page at all, so leads, ' +
                      'contacts and bookings have no landing page.'}
                  </Alert>
                  {landing.truncated ? (
                    <Alert severity="warning">
                      {`More than ${LANDING_PAGE_CEILING.toLocaleString()} ` +
                        'credited submissions exist. This groups the ' +
                        `${landing.read.toLocaleString()} that were read, ` +
                        'which are not the most recent — they are the ones ' +
                        'that came first in storage order.'}
                    </Alert>
                  ) : null}
                  {landing.missing ? (
                    <Alert severity="info">
                      {`${landing.missing.toLocaleString()} of the ` +
                        `${landing.read.toLocaleString()} credited ` +
                        'submissions are not grouped: the submission has ' +
                        'been deleted, or it recorded no page. They are ' +
                        'reported here rather than filed under a page they ' +
                        'may not have come from.'}
                    </Alert>
                  ) : null}
                  <ListTable
                    rows={landing.rows}
                    columns={landingColumns as any}
                    hideFooter
                    noRowsLabel="No pages to group"
                    noRowsDescription="None of the credited submissions recorded a page."
                  />
                  <Stack direction="row" spacing={1}>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${landing.read.toLocaleString()} credited submissions read`}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${landing.rows.length.toLocaleString()} pages`}
                    />
                  </Stack>
                </Stack>
              ) : null}
            </Section>
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
CampaignConversionsCard.displayName = 'CampaignConversionsCard'

export default CampaignConversionsCard
