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

import { PageHeaderHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  Alert,
  Chip,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { reviewStatusMeaning } from '../model/plugin-review-status'
import {
  REVIEW_QUEUE_QUERY,
  type ReviewQueueSection,
} from '../model/listing-query'

interface QueueRow {
  listingId: string
  displayName: string
  description: string
  license: string
  categories: string[]
  profileId: string
  reviewStatus: string
  priceUsd: number
  version: string
  hidden: boolean
  /** Private plugin (AGL-968): reviewed identically, never listed. */
  private: boolean
  /** The publisher's standing ask for the Verified badge (AGL-1217). */
  verificationRequest?: { state?: string; requestedAt?: unknown } | null
}

interface ListedRow {
  listingId: string
  displayName: string
  reviewStatus: string
  profileId: string
  latestVersion: string
  hidden: boolean
  hiddenReason: string
  realmVersions: number
  versionCount: number
  private: boolean
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_review', label: 'In review' },
  { value: 'listed', label: 'Listed' },
  { value: 'verified', label: 'Verified' },
  { value: 'hidden', label: 'Taken down' },
]

/** How the queue's clauses read in a refusal. */
const QUEUE_HEADERS: Readonly<Record<string, string>> = {
  reviewStatus: 'Status',
  takenDown: 'Taken down',
}
const QUEUE_OPTIONS = {
  reviewStatus: STATUS_FILTERS.filter(
    (option) => option.value !== 'all' && option.value !== 'hidden',
  ),
}

/** Rows per page of each section. */
const QUEUE_PAGE = 50
/** How long the search box waits for typing to stop before it asks again. */
const SEARCH_SETTLE_MS = 300

const NO_MORE: Record<ReviewQueueSection, boolean> = {
  queue: false,
  listed: false,
  verification: false,
}
const FIRST_PAGES: Record<ReviewQueueSection, number> = {
  queue: 0,
  listed: 0,
  verification: 0,
}

/**
 * Staff marketplace review index (AGL-961).
 *
 * Scanning surface only: rows carry just enough to pick the right listing,
 * and every consequential action — verdicts, realm trust, takedown — lives
 * on the detail page. The previous version stacked all of it inline, which
 * meant the most destructive controls in the platform sat as same-weight
 * text buttons in a wall of caption text.
 *
 * The search box and the Status select are served by the route's QUERY
 * (AGL-3321): each section asks Firestore for its rows with the status and
 * the searched name word on it, so a plugin past the first hundred is found.
 * They used to be matched here over the hundred the route had read. Search
 * reads the listing name; a refusal or a one-word notice from the plan is
 * shown above the sections. Each section pages: the route reads every section
 * out to the furthest page asked plus one row, which is how a section knows
 * there is a next page (the window `usePagedCollection` reads, over a route).
 */
export function PluginReviewsQueue({ basePath }: { basePath: string }) {
  const { data: user } = useUser()
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [listed, setListed] = useState<ListedRow[]>([])
  const [verificationRequests, setVerificationRequests] = useState<QueueRow[]>(
    [],
  )
  const [publishers, setPublishers] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [asked, setAsked] = useState('')
  const [status, setStatus] = useState('all')
  const [pages, setPages] =
    useState<Record<ReviewQueueSection, number>>(FIRST_PAGES)
  /** Every section is read out to the furthest page any of them is on. */
  const limit = QUEUE_PAGE * (Math.max(...Object.values(pages)) + 1)
  const [more, setMore] = useState<Record<ReviewQueueSection, boolean>>(NO_MORE)
  const [refused, setRefused] = useState<
    Array<{ clause: ListFilterClause | 'search'; reason: string }>
  >([])
  const [notices, setNotices] = useState<string[]>([])

  // The search is asked once typing settles, not per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(search.trim()), SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [search])
  // A new question starts from the first page.
  useEffect(() => {
    setPages(FIRST_PAGES)
  }, [asked, status])

  const refresh = useCallback(async () => {
    const params = new URLSearchParams()
    if (asked) params.set('q', asked)
    if (status !== 'all') params.set('status', status)
    params.set('limit', String(limit))
    const suffix = params.toString()
    const response = await authorizedFetch(
      user,
      `/api/marketplace/admin/reviews${suffix ? `?${suffix}` : ''}`,
    )
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      setLoadError(null)
      setQueue(payload?.queue ?? [])
      setListed(payload?.listed ?? [])
      setVerificationRequests(payload?.verificationRequests ?? [])
      setPublishers(payload?.publishers ?? {})
      setMore({ ...NO_MORE, ...(payload?.more ?? {}) })
      setRefused(payload?.refused ?? [])
      setNotices(payload?.notices ?? [])
    } else {
      // Named, not swallowed. An empty queue and a queue that could not be
      // read look identical, and only one of them means there is no work.
      setLoadError(
        payload?.error ?? `Loading the queue failed (${response.status})`,
      )
    }
    setLoaded(true)
  }, [user, asked, status, limit])

  useEffect(() => {
    if (user) void refresh()
  }, [user, refresh])

  const publisherName = useCallback(
    (profileId: string) => publishers[profileId] ?? profileId,
    [publishers],
  )

  // Every section is already what the query answered: nothing is matched
  // here, only the page on screen sliced out of the window read.
  const pageOf = <T,>(section: ReviewQueueSection, rows: T[]): T[] =>
    rows.slice(pages[section] * QUEUE_PAGE, (pages[section] + 1) * QUEUE_PAGE)
  const visibleQueue = pageOf('queue', queue)
  const visibleListed = pageOf('listed', listed)
  const visibleVerification = pageOf('verification', verificationRequests)
  const total: Record<ReviewQueueSection, number> = {
    queue: queue.length,
    listed: listed.length,
    verification: verificationRequests.length,
  }
  const filtering = asked.length > 0 || status !== 'all'
  const refusals = useMemo(
    () =>
      listQueryRefusals(refused, {
        fields: REVIEW_QUEUE_QUERY.fields,
        headers: QUEUE_HEADERS,
        options: QUEUE_OPTIONS,
      }),
    [refused],
  )
  const pager = (section: ReviewQueueSection, shown: number) => {
    const hasMore =
      total[section] > (pages[section] + 1) * QUEUE_PAGE || more[section]
    return pages[section] > 0 || hasMore ? (
      <ListPagination
        page={pages[section]}
        pageSize={QUEUE_PAGE}
        rowCount={shown}
        hasMore={hasMore}
        onPageChange={(page) =>
          setPages((previous) => ({ ...previous, [section]: page }))
        }
      />
    ) : null
  }

  const row = (
    key: string,
    listingId: string,
    name: string,
    profileId: string,
    chips: React.ReactNode,
    caption: string,
  ) => (
    <Stack
      key={key}
      spacing={0.25}
      sx={{
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Stack
        useFlexGap
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <AppLink href={`${basePath}/${encodeURIComponent(listingId)}`}>
          <Typography variant="subtitle2" component="span">
            {name}
          </Typography>
        </AppLink>
        {chips}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {`${publisherName(profileId)} · ${caption}`}
      </Typography>
    </Stack>
  )

  return (
    <>
      {/*
        The staff console's own topic, anchored. A `staffPages` entry carries
        one `docsTopic` and no anchor, and the staff console page is long
        enough that landing at the top of it is the AGL-2200 shape.
      */}
      <PageHeaderHelp topic="staffConsole" anchor="#plugin-reviews" />
      {/*
        The staff gate is the shell's: the generic staff route renders every
        plugin page inside `StaffOnly`, which renders nothing while the claim
        resolves and 404s a non-holder. Without it a non-staff visitor was
        told "No plugin submissions waiting for review" — the queue fetch
        403s and the empty result reads as good news rather than a refusal
        (AGL-760).
      */}
          <Stack spacing={3}>
            <Stack
              useFlexGap
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <TextField
                size="small"
                placeholder="Search plugin names"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                sx={{ minWidth: 320 }}
              />
              <TextField
                size="small"
                select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                sx={{ minWidth: 180 }}
              >
                {STATUS_FILTERS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            {loadError ? (
              <Alert severity="error">{loadError}</Alert>
            ) : null}
            <ListQueryNotices refused={refusals} notices={notices} />

            {!loaded ? (
              <Stack spacing={2}>
                <Skeleton variant="rounded" height={140} />
                <Skeleton variant="rounded" height={200} />
              </Stack>
            ) : (
              <>
                {/* Its own card, above the review queue (AGL-1217). A
                    verification request is a different question from
                    "have these bytes been read" — it is about the
                    publisher, and it is answered by a different action.
                    Folded into Awaiting review it would be invisible: a
                    listing whose bytes are already approved does not
                    appear there at all. Hidden when empty, so it costs
                    nothing on the common day. */}
                {visibleVerification.length ? (
                  <CardDisplay
                    header={`Verification requested (${total.verification}${more.verification ? '+' : ''})`}
                    help={pluginDocsHelp('publisherHandbook', {
                      anchor: '#asking-to-be-verified',
                      excerpt:
                        'Publishers who asked to be VERIFIED — a claim about who they are, ' +
                        'separate from reviewing any one version.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mb: 1 }}
                    >
                      {'These plugins are already live. The publisher has ' +
                        'asked us to vouch for who they are — granting adds ' +
                        'the badge and changes nothing about installability.'}
                    </Typography>
                    <Stack>
                      {visibleVerification.map((entry) =>
                        row(
                          `verify-${entry.listingId}`,
                          entry.listingId,
                          entry.displayName,
                          entry.profileId,
                          <>
                            <Chip
                              size="small"
                              color="info"
                              label="Verification requested"
                            />
                            <Chip
                              size="small"
                              color={reviewStatusMeaning(entry.reviewStatus).color}
                              label={reviewStatusMeaning(entry.reviewStatus).label}
                            />
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`v${entry.version || '—'}`}
                            />
                          </>,
                          'Awaiting a verification decision',
                        ),
                      )}
                      {pager('verification', visibleVerification.length)}
                    </Stack>
                  </CardDisplay>
                ) : null}
                <CardDisplay
                  header={`Awaiting review (${total.queue}${more.queue ? '+' : ''})`}
                  help={pluginDocsHelp('manifestAndEnvs', {
                    anchor: '#review--trust-lifecycle',
                    excerpt:
                      'Submissions waiting on a staff verdict. Open one to read its manifest, verifier findings and act.',
                  })}
                  contentGutterX
                  contentGutterY
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1 }}
                  >
                    {'Submitted and In review are not installable by anyone.'}
                  </Typography>
                  {visibleQueue.length ? (
                    <Stack>
                      {visibleQueue.map((entry) =>
                        row(
                          entry.listingId,
                          entry.listingId,
                          entry.displayName,
                          entry.profileId,
                          <>
                            <Chip
                              size="small"
                              color={reviewStatusMeaning(entry.reviewStatus).color}
                              label={reviewStatusMeaning(entry.reviewStatus).label}
                            />
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`v${entry.version || '—'}`}
                            />
                            {/* Same bar, smaller audience (AGL-968/995).
                                Worth flagging so a reviewer knows the
                                blast radius is one workspace — never so
                                they review it more loosely. */}
                            {entry.private ? (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Private"
                              />
                            ) : null}
                            {/* A private plugin has no marketplace listing
                                page, so "no license" is not a finding. */}
                            {entry.license || entry.private ? null : (
                              <Chip
                                size="small"
                                color="warning"
                                label="No license"
                              />
                            )}
                          </>,
                          entry.priceUsd > 0 ? `$${entry.priceUsd}` : 'Free',
                        ),
                      )}
                      {pager('queue', visibleQueue.length)}
                    </Stack>
                  ) : (
                    <Alert severity={filtering ? 'info' : 'success'}>
                      {filtering
                        ? 'No submissions match this filter.'
                        : 'No plugin submissions waiting for review.'}
                    </Alert>
                  )}
                </CardDisplay>

                <CardDisplay
                  header={`Listed plugins (${total.listed}${more.listed ? '+' : ''})`}
                  help={pluginDocsHelp('publisherHandbook', {
                    anchor: '#review-what-happens-after-you-publish',
                    excerpt:
                      'Listings already installable. Listing is the step that makes a ' +
                      'version reachable from Browse.',
                  })}
                  contentGutterX
                  contentGutterY
                >
                  {/* Listed vs Verified is the distinction reviewers get
                      wrong (AGL-966): both are LIVE. Verified only adds a
                      badge — it does not change who can install. */}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1 }}
                  >
                    {'Both states are live — installable by every workspace. ' +
                      'Verified additionally carries the reviewed badge on ' +
                      'its listing page; it does not change installability. ' +
                      // The sentence above is false for a private row
                      // (AGL-968/995), and it sits directly over the rows
                      // it would misdescribe.
                      'Rows marked Private are the exception: approved and ' +
                      'live, but only for the org that published them.'}
                  </Typography>
                  {visibleListed.length ? (
                    <Stack>
                      {visibleListed.map((entry) =>
                        row(
                          entry.listingId,
                          entry.listingId,
                          entry.displayName,
                          entry.profileId,
                          <>
                            <Chip
                              size="small"
                              color={reviewStatusMeaning(entry.reviewStatus).color}
                              label={reviewStatusMeaning(entry.reviewStatus).label}
                            />
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`v${entry.latestVersion || '—'}`}
                            />
                            {entry.private ? (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Private"
                              />
                            ) : null}
                            {entry.realmVersions ? (
                              <Chip
                                size="small"
                                color="success"
                                label={`${entry.realmVersions} realm-trusted`}
                              />
                            ) : null}
                            {entry.hidden ? (
                              <Chip
                                size="small"
                                color="error"
                                label="Taken down"
                              />
                            ) : null}
                          </>,
                          `${entry.versionCount} version${
                            entry.versionCount === 1 ? '' : 's'
                          }${entry.hidden && entry.hiddenReason ? ` · ${entry.hiddenReason}` : ''}`,
                        ),
                      )}
                      {pager('listed', visibleListed.length)}
                    </Stack>
                  ) : (
                    <Alert severity="info">
                      {filtering
                        ? 'No listed plugins match this filter.'
                        : 'No listed plugins yet.'}
                    </Alert>
                  )}
                </CardDisplay>
              </>
            )}
          </Stack>
    </>
  )
}

export default PluginReviewsQueue
