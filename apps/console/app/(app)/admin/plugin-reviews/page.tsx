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
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
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
    <>
      <NextPageTitle screen={'Plugin reviews – Admin'} />
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
                    {visibleQueue.length ? (
                      <Stack>
                        {visibleQueue.map((entry) =>
                          row(
                            entry.listingId,
                            entry.listingId,
                            entry.displayName,
                            entry.profileId,
                            <>
                              <Chip size="small" label={entry.reviewStatus} />
                              <Chip
                                size="small"
                                variant="outlined"
                                label={`v${entry.version || '—'}`}
                              />
                              {entry.license ? null : (
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
                    {visibleListed.length ? (
                      <Stack>
                        {visibleListed.map((entry) =>
                          row(
                            entry.listingId,
                            entry.listingId,
                            entry.displayName,
                            entry.profileId,
                            <>
                              <Chip size="small" label={entry.reviewStatus} />
                              <Chip
                                size="small"
                                variant="outlined"
                                label={`v${entry.latestVersion || '—'}`}
                              />
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
    </>
  )
}

export default PluginReviews
