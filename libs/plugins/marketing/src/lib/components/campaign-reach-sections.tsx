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

import { AppLink } from '@aglyn/shared-ui-jsx'
import {
  Figure,
  Section,
} from '@aglyn/shared-ui-email-campaigns/components/report-figures'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  Alert,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  CAMPAIGN_CONVERSION_KINDS,
  CAMPAIGN_CONVERSION_KIND_COPY,
  type CampaignConversionKind,
  type CampaignLinkRollup,
} from '@aglyn/shared-ui-email-campaigns/model'

/**
 * A CAMPAIGN BEYOND ITS MAIL — what it caused, and where it sent people.
 *
 * ## Attribution is the mechanism, and there is no other one
 *
 * A campaign owns no screen, no form and no overlay. Nothing in the stored
 * model connects `emailCampaigns/{id}` to a page a visitor lands on:
 * `HostExperiment` names a screen and never a campaign, `HostOverlay` names
 * neither, and a form document carries no campaign field. So a section
 * claiming a campaign CONTAINS a landing page would be inventing an edge, and
 * the containment would be a claim nothing in the data supports.
 *
 * What the data does support is EVIDENCE, of two kinds, and both are already
 * being written:
 *
 *  - **Where it sent people.** `campaigns/{sendId}/reports/links` counts
 *    clicks per destination URL, so the union across a campaign's emails is
 *    the set of pages that campaign drove traffic to — observed rather than
 *    declared, which is also why it stays true when a marketer re-points a
 *    link.
 *  - **What it caused there.** `campaignAttributions` records one row per
 *    identify moment — a form submission, a lead, a contact, a booking —
 *    carrying the SEND whose link the visitor followed.
 *
 * Both sections below therefore hang off the campaign's own send ids, which
 * is the only handle either collection offers.
 *
 * ## What neither section can say, and says so instead
 *
 * A conversion credited to a WEB touch carries `utm_` labels and no send id.
 * A campaign container has no `utm_` label of its own — a marketer types
 * those into a URL — so there is no join to make, and no amount of matching
 * on the campaign's NAME would be one: two campaigns may share a name, and a
 * label is a string anybody who can vary a query string can mint. The
 * site-wide Conversions section is where the web channel is read, and the
 * copy below points at it rather than quietly leaving it out.
 *
 * A conversion with no touch at all is credited to nobody and is in neither
 * collection. That makes a page showing only credited conversions a partial
 * account by construction, which is why the figures are labelled "credited to
 * this campaign" everywhere they appear.
 */

/** Firestore's cap on the values in one `in` filter. */
const ID_CHUNK = 30

export interface CampaignReachProps {
  hostId: string
  /**
   * The campaign's emails, by send id — the handle both collections join on.
   *
   * A stable array is not required: both sections key their reads on the
   * joined string, so a caller rebuilding the array every render pays for one
   * set of reads rather than one per render.
   */
  sendIds: readonly string[]
  /** The campaign holds more emails than `sendIds` names. */
  truncated: boolean
}

/** The ids as one primitive, so an effect depends on the VALUE not the array. */
const idsKey = (sendIds: readonly string[]): string => sendIds.join(',')

/** `['a','b','c']` in runs of at most {@link ID_CHUNK}. */
function chunked(ids: readonly string[]): string[][] {
  const out: string[][] = []
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    out.push(ids.slice(index, index + ID_CHUNK))
  }
  return out
}

/**
 * WHAT THE CAMPAIGN CAUSED, counted rather than listed.
 *
 * Four aggregation counts over `campaignAttributions`, one per kind, each
 * narrowed to this campaign's own sends. An aggregation is billed per
 * thousand index entries rather than per document, so the honest figure costs
 * about as much as a single row — which is what lets this run on mount
 * instead of behind a button. Listing the records would not: that is the
 * per-record read every figure on this page is arranged to avoid, and the
 * site-wide Conversions section already lists them.
 *
 * The composite index the query needs — `kind` then `campaignId` — is already
 * declared for the conversions list's own campaign-scoped view, and an `in`
 * runs as a disjunction of equalities against that same index.
 *
 * ## The kinds are never added together
 *
 * One form submission by a new person writes a submission, a contact AND a
 * lead: three true statements about one visit. A total would count that visit
 * three times and would look exactly like a bigger number, so there is no
 * total here and the note under the figures says why.
 */
export function CampaignConversionsSection(
  props: CampaignReachProps & {
    /** The marketing hub URL, for the site-wide conversions list. */
    basePath: string
  },
) {
  const { hostId, sendIds, truncated, basePath } = props
  const firestore = useFirestore()
  const key = idsKey(sendIds)
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const ids = key ? key.split(',') : []
    setCounts(null)
    setFailed(false)
    if (!ids.length) return
    let active = true
    const attributions = collection(
      firestore,
      'hosts',
      hostId,
      'campaignAttributions',
    )
    /*
     * Summed ACROSS chunks, which is safe because a record carries exactly
     * one `campaignId`: the chunks partition the send ids, so no record can
     * be counted by two of them.
     */
    void Promise.all(
      CAMPAIGN_CONVERSION_KINDS.map(async (kind) => {
        const perChunk = await Promise.all(
          chunked(ids).map((chunk) =>
            getCountFromServer(
              query(
                attributions,
                where('kind', '==', kind),
                where('campaignId', 'in', chunk),
              ),
            ).then((snapshot) => Number(snapshot.data().count ?? 0)),
          ),
        )
        return [kind, perChunk.reduce((sum, value) => sum + value, 0)] as const
      }),
    )
      .then((entries) => {
        if (active) setCounts(Object.fromEntries(entries))
      })
      .catch(() => {
        /*
         * WITHHELD, never zeroed. A count that failed and a campaign that
         * caused nothing are opposite facts, and rendering the first as the
         * second is the most flattering wrong answer available here.
         */
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, key])

  return (
    <Section title="What it caused">
      {!key ? (
        <Typography variant="body2" color="text.secondary">
          {'No emails have gone out under this campaign, so nothing can be ' +
            'credited to it yet.'}
        </Typography>
      ) : failed ? (
        <Alert severity="warning">
          {'The conversions credited to this campaign could not be counted.'}
        </Alert>
      ) : !counts ? (
        <Typography variant="body2" color="text.secondary">
          {'Counting what this campaign is credited with…'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
            {CAMPAIGN_CONVERSION_KINDS.map((kind: CampaignConversionKind) => (
              <Figure
                key={kind}
                label={CAMPAIGN_CONVERSION_KIND_COPY[kind].label}
                value={counts[kind] ?? 0}
                note={CAMPAIGN_CONVERSION_KIND_COPY[kind].note}
              />
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {'These count different things about the same visits and are ' +
              'deliberately not added together — one person filling in one ' +
              'form appears as a submission, a contact and a lead.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {'Credited to this campaign’s own emails. Somebody who arrived ' +
              'from a link tagged with utm_ parameters is credited to that ' +
              'label instead, and somebody who arrived directly is credited ' +
              'to nobody — both are counted on the site’s conversions list.'}
          </Typography>
          {truncated ? (
            <Typography variant="caption" color="text.secondary">
              {'Over the emails listed below. This campaign has sent more ' +
                'than the page holds, and their conversions are not in these ' +
                'figures.'}
            </Typography>
          ) : null}
        </Stack>
      )}
      <Stack direction="row">
        <Button
          component={AppLink as any}
          {...({ componentVariant: 'naked', nativeButton: false } as any)}
          href={`${basePath}/conversions`}
          size="small"
          color="primary"
        >
          {'All conversions'}
        </Button>
      </Stack>
    </Section>
  )
}
CampaignConversionsSection.displayName = 'CampaignConversionsSection'

/** One destination, summed across the campaign's emails. */
interface DestinationRow {
  url: string
  clicks: number
  /** How many of the campaign's emails carried a link to it. */
  emails: number
}

/** What one pass over the campaign's link rollups produced. */
interface DestinationsResult {
  rows: DestinationRow[]
  /** Emails whose rollup was read, which is the population the rows describe. */
  read: number
  /** Clicks on destinations past each email's own rollup cap. */
  overflowClicks: number
  /** Clicks that arrived naming no destination at all. */
  unattributedClicks: number
}

/**
 * WHERE THE CAMPAIGN SENT PEOPLE — the pages its mail pointed at.
 *
 * The union of `campaigns/{sendId}/reports/links` across the campaign's
 * emails, which is the closest the stored data comes to "the surfaces this
 * campaign runs across". It is observed rather than declared: a page is on
 * this list because a link in this campaign's mail was followed to it.
 *
 * ## Behind a button, and the button says the price
 *
 * One document per email, up to the ceiling the page holds — which is the
 * per-record read the figures above are shaped to avoid, so it is asked for
 * rather than paid on mount. The same bargain the conversions list makes for
 * its landing-page grouping.
 *
 * ## What a row is, and what it is not
 *
 * A destination is the link's address with its query string dropped, because
 * a campaign body is merged per recipient and a personalised query would mint
 * one row per person — and could carry that person's address into an
 * aggregate the whole team reads. The cost is that two links to one page
 * distinguished only by their tracking parameters are one row, which the note
 * under the table states rather than leaving the reader to discover.
 *
 * Clicks are EVENTS. One reader clicking twice counts twice, so a destination
 * total is not a count of people.
 */
export function CampaignDestinationsSection(props: CampaignReachProps) {
  const { hostId, sendIds, truncated } = props
  const firestore = useFirestore()
  const key = idsKey(sendIds)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DestinationsResult | null>(null)
  /*
   * The page is a SLICE of a window this section already holds. One campaign
   * can reach fifty destinations per email over fifty emails, so the row
   * count is bounded by the rollups rather than small — and a table that
   * grows with the campaign gets a footer like every other one.
   */
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleRows = useMemo(
    () => (result?.rows ?? []).slice(page * pageSize, page * pageSize + pageSize),
    [result, page, pageSize],
  )

  // A grouping read for one set of emails describes that set. Leaving it on
  // screen after the campaign's emails change labels it as something it is not.
  useEffect(() => {
    setResult(null)
    setError(null)
    setPage(0)
  }, [key])

  const load = useCallback(async () => {
    if (busy) return
    const ids = key ? key.split(',') : []
    if (!ids.length) return
    setBusy(true)
    setError(null)
    try {
      const snapshots = await Promise.all(
        ids.map((id) =>
          getDoc(
            doc(
              firestore,
              'hosts',
              hostId,
              'campaigns',
              id,
              'reports',
              'links',
            ),
          ),
        ),
      )
      const byUrl = new Map<string, DestinationRow>()
      let overflowClicks = 0
      let unattributedClicks = 0
      snapshots.forEach((snapshot) => {
        const rollup = snapshot.data() as CampaignLinkRollup | undefined
        if (!rollup) return
        overflowClicks += Number(rollup.overflowClicks ?? 0)
        unattributedClicks += Number(rollup.unattributedClicks ?? 0)
        Object.values(rollup.links ?? {}).forEach((entry) => {
          const url = String(entry?.url ?? '').trim()
          if (!url) return
          const row = byUrl.get(url) ?? { url, clicks: 0, emails: 0 }
          row.clicks += Number(entry?.clicks ?? 0)
          // One rollup holds at most one entry per destination, so this
          // counts EMAILS that linked there rather than link occurrences.
          row.emails += 1
          byUrl.set(url, row)
        })
      })
      setPage(0)
      setResult({
        rows: [...byUrl.values()].sort(
          (a, b) => b.clicks - a.clicks || a.url.localeCompare(b.url),
        ),
        read: ids.length,
        overflowClicks,
        unattributedClicks,
      })
    } catch (caught) {
      console.error(caught)
      setError('The destinations could not be read')
    } finally {
      setBusy(false)
    }
  }, [busy, firestore, hostId, key])

  const count = key ? key.split(',').length : 0

  return (
    <Section title="Where it sent people">
      {!count ? (
        <Typography variant="body2" color="text.secondary">
          {'No emails have gone out under this campaign, so it has sent ' +
            'nobody anywhere yet.'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {'The pages this campaign’s links were followed to. A campaign ' +
              'does not own a page — this is where its mail actually sent ' +
              'people, read from each email’s own click report.'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button size="small" onClick={() => void load()} disabled={busy}>
              {busy ? 'Reading…' : result ? 'Read again' : 'Show destinations'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {`Reads one record per email — ${count.toLocaleString()} of them.`}
            </Typography>
          </Stack>
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {result ? (
            result.rows.length ? (
              <Stack spacing={0.5}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Destination'}</TableCell>
                      <TableCell align="right">{'Emails'}</TableCell>
                      <TableCell align="right">{'Clicks'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleRows.map((row) => (
                      <TableRow key={row.url}>
                        <TableCell sx={{ wordBreak: 'break-all' }}>
                          {row.url}
                        </TableCell>
                        <TableCell align="right">
                          {row.emails.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          {row.clicks.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <ListPagination
                  page={page}
                  pageSize={pageSize}
                  rowCount={visibleRows.length}
                  count={result.rows.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
                <Typography variant="caption" color="text.secondary">
                  {'A destination is the address without its query string, ' +
                    'so two links to one page that differ only in their ' +
                    'tracking parameters are one row. Clicks are events — ' +
                    'one reader clicking twice counts twice.'}
                </Typography>
                {result.overflowClicks ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${result.overflowClicks.toLocaleString()} further ` +
                      'clicks landed on destinations past the per-email cap ' +
                      'and are not in the table.'}
                  </Typography>
                ) : null}
                {result.unattributedClicks ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${result.unattributedClicks.toLocaleString()} clicks ` +
                      'arrived naming no destination, so they belong to no ' +
                      'row.'}
                  </Typography>
                ) : null}
                {truncated ? (
                  <Typography variant="caption" color="text.secondary">
                    {`Across the ${result.read.toLocaleString()} emails this ` +
                      'page holds. The campaign has sent more.'}
                  </Typography>
                ) : null}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {'None of this campaign’s emails has recorded a followed ' +
                  'link yet.'}
              </Typography>
            )
          ) : null}
        </Stack>
      )}
    </Section>
  )
}
CampaignDestinationsSection.displayName = 'CampaignDestinationsSection'
