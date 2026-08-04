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

import { ICON_VARIANT_SYMBOL_FLAG } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
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
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { reviewStatusMeaning } from '../../../../constants/plugin-review-status'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

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

/**
 * Staff marketplace review index (AGL-961).
 *
 * Scanning surface only: rows carry just enough to pick the right listing,
 * and every consequential action — verdicts, realm trust, takedown — lives
 * on the detail page. The previous version stacked all of it inline, which
 * meant the most destructive controls in the platform sat as same-weight
 * text buttons in a wall of caption text.
 */
const PluginReviews: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [listed, setListed] = useState<ListedRow[]>([])
  const [verificationRequests, setVerificationRequests] = useState<QueueRow[]>(
    [],
  )
  const [publishers, setPublishers] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')

  const token = useCallback(
    async () =>
      (user as { getIdToken?: () => Promise<string> })?.getIdToken?.(),
    [user],
  )

  const refresh = useCallback(async () => {
    const idToken = await token()
    if (!idToken) return
    const response = await fetch('/api/admin/plugin-reviews', {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (response.ok) {
      const payload = await response.json()
      setQueue(payload?.queue ?? [])
      setListed(payload?.listed ?? [])
      setVerificationRequests(payload?.verificationRequests ?? [])
      setPublishers(payload?.publishers ?? {})
    }
    setLoaded(true)
  }, [token])

  useEffect(() => {
    if (user) void refresh()
  }, [user, refresh])

  const publisherName = useCallback(
    (profileId: string) => publishers[profileId] ?? profileId,
    [publishers],
  )

  // One predicate for both sections, so a search never means two things.
  const matches = useCallback(
    (row: { displayName: string; listingId: string; profileId: string; reviewStatus: string; hidden: boolean }) => {
      const term = search.trim().toLowerCase()
      if (
        term &&
        ![row.displayName, row.listingId, publisherName(row.profileId)].some(
          (field) => String(field).toLowerCase().includes(term),
        )
      ) {
        return false
      }
      if (status === 'all') return true
      if (status === 'hidden') return row.hidden
      return row.reviewStatus === status
    },
    [search, status, publisherName],
  )

  const visibleQueue = useMemo(() => queue.filter(matches), [queue, matches])
  const visibleListed = useMemo(() => listed.filter(matches), [listed, matches])
  const visibleVerification = useMemo(
    () => verificationRequests.filter(matches),
    [verificationRequests, matches],
  )
  const filtering = search.trim().length > 0 || status !== 'all'

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
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <AppLink href={buildRoute(Route.ADMIN_PLUGIN_REVIEW, { listingId })}>
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
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Plugin reviews',
          href: buildRoute(Route.ADMIN_PLUGIN_REVIEWS),
        },
      ]}
      help="staffConsole"
      header={{
        children: 'Plugin reviews',
        icon: { path: ICON_VARIANT_SYMBOL_FLAG.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {/* Without this a non-staff visitor is told "No plugin submissions
            waiting for review" — the queue fetch 403s and the empty result
            reads as good news rather than as a refusal (AGL-760). */}
        <StaffOnly>
          <Stack spacing={3}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <TextField
                size="small"
                placeholder="Search name, publisher or listing id"
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
                    header={`Verification requested (${visibleVerification.length})`}
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
                    </Stack>
                  </CardDisplay>
                ) : null}
                <CardDisplay
                  header={`Awaiting review (${visibleQueue.length})`}
                  help={docsHelp('manifestAndEnvs', {
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
                  header={`Listed plugins (${visibleListed.length})`}
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
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}

export default PluginReviews
