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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Divider,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../../components/staff-only.component'
import { docsHelp } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'

interface VersionEntry {
  version: string
  trust: string | null
  sha256: string
  hostAbi: number | null
  capabilities: { network?: string[]; events?: string[] }
  publishedAt: string | null
  signed: boolean
}

interface ListingDetail {
  listingId: string
  displayName: string
  description: string
  readme: string
  license: string
  categories: string[]
  homepageUrl: string
  repositoryUrl: string
  publisherId: string
  publisherName: string
  publisherSlug: string | null
  reviewStatus: string
  rejectionReason: string
  priceUsd: number
  latestVersion: string
  activeInstalls: number
  hidden: boolean
  hiddenReason: string
  revoked: boolean
  unpublished: boolean
  platformHostAbi: number
  versions: VersionEntry[]
  verifier: {
    ok?: boolean
    problems?: Array<{ level: string; message: string }>
    error?: string
  } | null
}

/** Verifier findings read as a wall of text otherwise; group by severity. */
const SEVERITY_ORDER = ['error', 'warn', 'warning', 'info']

/**
 * One plugin submission or listed plugin, in full (AGL-960).
 *
 * The index is for scanning; this is where a reviewer reads the manifest,
 * weighs the verifier findings and acts. Every consequential action lives
 * here rather than on the list, so nobody grants realm trust or takes a
 * plugin down while skimming rows.
 */
const PluginReviewDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ listingId: string }>()
  const listingId = String(params?.listingId ?? '')
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [detail, setDetail] = useState<ListingDetail | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [takedownReason, setTakedownReason] = useState('')

  const token = useCallback(
    async () =>
      (user as { getIdToken?: () => Promise<string> })?.getIdToken?.(),
    [user],
  )

  const refresh = useCallback(async () => {
    const idToken = await token()
    if (!idToken || !listingId) return
    const response = await fetch(
      `/api/admin/plugin-reviews?listingId=${encodeURIComponent(listingId)}`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    )
    if (response.ok) setDetail(await response.json())
    setLoaded(true)
  }, [token, listingId])

  useEffect(() => {
    if (user) void refresh()
  }, [user, refresh])

  const post = useCallback(
    async (payload: Record<string, unknown>, success: string) => {
      setBusy(true)
      try {
        const idToken = await token()
        const response = await fetch('/api/admin/plugin-reviews', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ listingId, ...payload }),
        })
        const result = await response.json().catch(() => ({}))
        if (response.ok) {
          enqueueSnackbar(success, { variant: 'success' })
          await refresh()
        } else {
          enqueueSnackbar(result?.error ?? 'Action failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [token, listingId, enqueueSnackbar, refresh],
  )

  const signRealm = useCallback(
    async (version: string, action: 'grant' | 'revoke') => {
      setBusy(true)
      try {
        const idToken = await token()
        const response = await fetch('/api/admin/sign-plugin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            listingId,
            version,
            ...(action === 'revoke' ? { action: 'revoke' } : {}),
          }),
        })
        const result = await response.json().catch(() => ({}))
        if (response.ok) {
          enqueueSnackbar(
            action === 'revoke'
              ? `v${version} returned to the sandbox`
              : `v${version} signed for the app realm`,
            { variant: 'success' },
          )
          await refresh()
        } else {
          enqueueSnackbar(result?.error ?? 'Signing failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [token, listingId, enqueueSnackbar, refresh],
  )

  const takedown = useCallback(async () => {
    if (!detail) return
    if (!detail.hidden && !takedownReason.trim()) {
      return void enqueueSnackbar('Taking a plugin down needs a reason', {
        variant: 'warning',
        allowDuplicate: true,
      })
    }
    await post(
      {
        action: detail.hidden ? 'unhide' : 'hide',
        reason: takedownReason,
      },
      detail.hidden
        ? `${detail.displayName} restored`
        : `${detail.displayName} taken down — running installs stop on next load`,
    )
    setTakedownReason('')
  }, [detail, takedownReason, post, enqueueSnackbar])

  const findings = (detail?.verifier?.problems ?? [])
    .slice()
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.level) - SEVERITY_ORDER.indexOf(b.level),
    )

  return (
    <>
      <NextPageTitle screen={`${detail?.displayName ?? 'Plugin'} – Review`} />
      <DashboardLayout
        breadcrumbItems={[
          {
            children: 'Plugin reviews',
            href: buildRoute(Route.ADMIN_PLUGIN_REVIEWS),
          },
          {
            children: detail?.displayName ?? listingId,
            href: buildRoute(Route.ADMIN_PLUGIN_REVIEW, { listingId }),
          },
        ]}
        help="staffConsole"
        header={{
          children: detail?.displayName ?? 'Plugin review',
          icon: { path: ICON_VARIANT_SYMBOL_FLAG.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <StaffOnly>
            {!loaded ? (
              <Stack spacing={2}>
                <Skeleton variant="rounded" height={120} />
                <Skeleton variant="rounded" height={220} />
              </Stack>
            ) : !detail ? (
              <Alert severity="warning">
                {'That listing no longer exists.'}
              </Alert>
            ) : (
              <Stack spacing={3}>
                {/* Status first: a reviewer needs to know what state they
                    are acting on before they read a word of the manifest. */}
                <CardDisplay header="Status" contentGutterX contentGutterY>
                  <Stack spacing={1.5}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Chip size="small" label={detail.reviewStatus} />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`v${detail.latestVersion || '—'}`}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={
                          detail.priceUsd > 0 ? `$${detail.priceUsd}` : 'Free'
                        }
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${detail.activeInstalls} install${
                          detail.activeInstalls === 1 ? '' : 's'
                        }`}
                      />
                      {detail.hidden ? (
                        <Chip
                          size="small"
                          color="error"
                          label="Taken down — revoked"
                        />
                      ) : null}
                      {detail.unpublished ? (
                        <Chip
                          size="small"
                          color="warning"
                          label="Unpublished by the publisher"
                        />
                      ) : null}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {'Publisher: '}
                      {detail.publisherSlug ? (
                        <AppLink
                          href={buildRoute(Route.ORG_MARKETPLACE_PUBLISHER, {
                            orgSlug: detail.publisherSlug,
                            profileId: detail.publisherId,
                          })}
                        >
                          {detail.publisherName}
                        </AppLink>
                      ) : (
                        detail.publisherName
                      )}
                      {` · ${detail.listingId}`}
                    </Typography>
                    {detail.rejectionReason ? (
                      <Alert severity="error">
                        {`Rejected: ${detail.rejectionReason}`}
                      </Alert>
                    ) : null}
                    {detail.hidden ? (
                      <Alert severity="error">
                        {detail.hiddenReason
                          ? `Taken down: ${detail.hiddenReason}`
                          : 'Taken down (no reason recorded)'}
                      </Alert>
                    ) : null}
                  </Stack>
                </CardDisplay>

                <CardDisplay header="Overview" contentGutterX contentGutterY>
                  <Stack spacing={1.5}>
                    <Typography variant="body2">
                      {detail.description || 'No description.'}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      {detail.license ? (
                        <Chip size="small" variant="outlined" label={detail.license} />
                      ) : (
                        <Chip size="small" color="warning" label="No license" />
                      )}
                      {detail.categories.map((category) => (
                        <Chip key={category} size="small" label={category} />
                      ))}
                    </Stack>
                    {detail.homepageUrl || detail.repositoryUrl ? (
                      <Typography variant="body2" color="text.secondary">
                        {detail.homepageUrl ? `Homepage: ${detail.homepageUrl}` : ''}
                        {detail.homepageUrl && detail.repositoryUrl ? ' · ' : ''}
                        {detail.repositoryUrl
                          ? `Repository: ${detail.repositoryUrl}`
                          : ''}
                      </Typography>
                    ) : null}
                    <Divider />
                    <Typography variant="subtitle2">{'README'}</Typography>
                    {detail.readme ? (
                      <Typography
                        variant="body2"
                        component="pre"
                        sx={{
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'inherit',
                          maxHeight: 320,
                          overflowY: 'auto',
                          m: 0,
                        }}
                      >
                        {detail.readme}
                      </Typography>
                    ) : (
                      <Alert severity="warning">
                        {'No README — publishers are expected to ship one.'}
                      </Alert>
                    )}
                  </Stack>
                </CardDisplay>

                {/* What the bundle is allowed to reach, and what the static
                    verifier found in it. The two questions that decide
                    whether this code may run in the app realm. */}
                <CardDisplay header="Security" contentGutterX contentGutterY>
                  <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                      {`Declared network: ${
                        detail.versions[0]?.capabilities?.network?.join(', ') ||
                        'none'
                      } · events: ${
                        detail.versions[0]?.capabilities?.events?.join(', ') ||
                        'none'
                      }`}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {`Host ABI: declared ${
                        detail.versions[0]?.hostAbi ?? 'none (legacy)'
                      }, platform runs ${detail.platformHostAbi}`}
                    </Typography>
                    {detail.verifier?.error ? (
                      <Alert severity="warning">
                        {`Verifier could not run: ${detail.verifier.error}`}
                      </Alert>
                    ) : findings.length ? (
                      <Stack spacing={0.75}>
                        {findings.map((problem, index) => (
                          <Alert
                            key={`${problem.level}-${index}`}
                            severity={
                              problem.level === 'error' ? 'error' : 'warning'
                            }
                          >
                            {problem.message}
                          </Alert>
                        ))}
                      </Stack>
                    ) : (
                      <Alert severity="success">
                        {'Static verifier found nothing.'}
                      </Alert>
                    )}
                  </Stack>
                </CardDisplay>

                <CardDisplay
                  header="Review verdict"
                  contentGutterX
                  contentGutterY
                  help={docsHelp('manifestAndEnvs', {
                    anchor: '#review--trust-lifecycle',
                    excerpt:
                      'Move this submission through the review lifecycle — list, verify, or reject with a reason.',
                  })}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() =>
                        void post({ action: 'start-review' }, 'Now in review')
                      }
                    >
                      {'Start review'}
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busy}
                      onClick={() => void post({ action: 'list' }, 'Listed')}
                    >
                      {'List'}
                    </Button>
                    <Button
                      size="small"
                      color="success"
                      disabled={busy}
                      onClick={() => void post({ action: 'verify' }, 'Verified')}
                    >
                      {'Verify ✓'}
                    </Button>
                    <TextField
                      size="small"
                      placeholder="Rejection reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      sx={{ minWidth: 240 }}
                    />
                    <Button
                      size="small"
                      color="error"
                      disabled={busy}
                      onClick={() =>
                        void post({ action: 'reject', reason }, 'Rejected')
                      }
                    >
                      {'Reject'}
                    </Button>
                  </Stack>
                </CardDisplay>

                <CardDisplay header="Versions" contentGutterX contentGutterY>
                  <Stack spacing={1}>
                    <Typography variant="body2" color="text.secondary">
                      {'Granting realm trust signs a version to run inside ' +
                        'the app realm instead of the sandbox iframe. ' +
                        'Super-staff only, audited.'}
                    </Typography>
                    {detail.versions.map((entry) => (
                      <Stack
                        key={entry.version}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography variant="body2" sx={{ minWidth: 64 }}>
                          {`v${entry.version}`}
                        </Typography>
                        {entry.version === detail.latestVersion ? (
                          <Chip size="small" label="Latest" />
                        ) : null}
                        <Chip
                          size="small"
                          color={entry.trust === 'realm' ? 'success' : 'default'}
                          variant={entry.trust === 'realm' ? 'filled' : 'outlined'}
                          label={
                            entry.trust === 'realm' ? 'Realm-trusted' : 'Sandboxed'
                          }
                        />
                        <Typography variant="caption" color="text.secondary">
                          {entry.publishedAt
                            ? new Date(entry.publishedAt).toLocaleDateString()
                            : '—'}
                          {` · ${entry.sha256.slice(0, 12)}`}
                        </Typography>
                        <Button
                          size="small"
                          color={entry.trust === 'realm' ? 'error' : 'success'}
                          disabled={busy}
                          onClick={() =>
                            void signRealm(
                              entry.version,
                              entry.trust === 'realm' ? 'revoke' : 'grant',
                            )
                          }
                        >
                          {entry.trust === 'realm'
                            ? 'Revoke realm trust'
                            : 'Grant realm trust'}
                        </Button>
                      </Stack>
                    ))}
                  </Stack>
                </CardDisplay>

                {/* Separated on purpose: this is the only control here that
                    reaches code already running in customers' workspaces. */}
                <CardDisplay header="Danger zone" contentGutterX contentGutterY>
                  <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                      {'Taking a plugin down de-lists it AND writes the kill ' +
                        'switch: every workspace that already installed it ' +
                        'stops loading it on the next render, and new ' +
                        'installs are refused. Restoring clears both.'}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      {detail.hidden ? null : (
                        <TextField
                          size="small"
                          placeholder="Takedown reason"
                          value={takedownReason}
                          onChange={(event) =>
                            setTakedownReason(event.target.value)
                          }
                          sx={{ minWidth: 260 }}
                        />
                      )}
                      <Button
                        size="small"
                        variant={detail.hidden ? 'text' : 'outlined'}
                        color={detail.hidden ? 'success' : 'error'}
                        disabled={busy}
                        onClick={() => void takedown()}
                      >
                        {detail.hidden ? 'Restore listing' : 'Take down'}
                      </Button>
                    </Stack>
                  </Stack>
                </CardDisplay>
              </Stack>
            )}
          </StaffOnly>
        </Container>
      </DashboardLayout>
    </>
  )
}

export default PluginReviewDetail
