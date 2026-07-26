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
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Link as MuiLink,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

interface QueueEntry {
  listingId: string
  displayName: string
  description: string
  readme: string
  license: string
  categories: string[]
  homepageUrl: string
  repositoryUrl: string
  profileId: string
  reviewStatus: string
  priceUsd: number
  version: string
  capabilities: { network?: string[]; events?: string[] }
  hostAbi: number | null
  trust: string | null
  verifier: {
    ok?: boolean
    problems?: Array<{ level: string; message: string }>
    error?: string
  } | null
}

/** A listed/verified plugin with per-version trust state (AGL-885). */
interface ListedEntry {
  listingId: string
  displayName: string
  reviewStatus: string
  latestVersion: string
  versions: Array<{ version: string; trust: string | null }>
}

/**
 * Marketplace review queue (AGL-432): staff move submitted plugin
 * listings through in_review → listed/verified/rejected, with the static
 * verifier re-run and a manual checklist alongside. Realm trust is the
 * separate super-staff grant (sign-plugin) surfaced as its own button.
 */
const PluginReviews: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [listed, setListed] = useState<ListedEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({})

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
    }
    setLoaded(true)
  }, [token])

  useEffect(() => {
    if (user) void refresh()
  }, [user, refresh])

  const act = useCallback(
    async (entry: QueueEntry, action: string) => {
      setBusy(entry.listingId)
      try {
        const idToken = await token()
        const response = await fetch('/api/admin/plugin-reviews', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            listingId: entry.listingId,
            action,
            reason: rejectReason[entry.listingId] ?? '',
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok) {
          enqueueSnackbar(`${entry.displayName}: ${payload.reviewStatus}`, {
            variant: 'success',
          })
          await refresh()
        } else {
          enqueueSnackbar(payload?.error ?? 'Action failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
      } finally {
        setBusy(null)
      }
    },
    [token, rejectReason, enqueueSnackbar, refresh],
  )

  // Grant or revoke realm trust for any listing+version (AGL-885) — the
  // super-staff sign-plugin call, shared by the queue button and the
  // listed-plugins section below.
  const signRealm = useCallback(
    async (listingId: string, version: string, action: 'grant' | 'revoke') => {
      setBusy(listingId)
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
        const payload = await response.json().catch(() => ({}))
        if (response.ok) {
          enqueueSnackbar(
            action === 'revoke'
              ? 'Realm trust revoked'
              : 'Realm trust granted (version signed)',
            { variant: 'success' },
          )
          await refresh()
        } else {
          enqueueSnackbar(payload?.error ?? 'Signing failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
      } finally {
        setBusy(null)
      }
    },
    [token, enqueueSnackbar, refresh],
  )

  const grantRealm = useCallback(
    (entry: QueueEntry) => signRealm(entry.listingId, entry.version, 'grant'),
    [signRealm],
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
            {loaded && queue.length === 0 ? (
              <Alert severity="success">
                {'No plugin submissions waiting for review.'}
              </Alert>
            ) : null}
            {queue.map((entry) => (
              <CardDisplay
                key={entry.listingId}
                header={`${entry.displayName} v${entry.version}`}
                help={docsHelp('manifestAndEnvs', {
                  anchor: '#review--trust-lifecycle',
                  excerpt:
                    'Advance this submission through the review lifecycle — list, verify, or reject with a reason. Realm trust is a separate super-staff signing grant.',
                })}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={1.5}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Chip size="small" label={entry.reviewStatus} />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={entry.priceUsd > 0 ? `$${entry.priceUsd}` : 'Free'}
                    />
                    {entry.license ? (
                      <Chip size="small" variant="outlined" label={entry.license} />
                    ) : (
                      <Chip size="small" color="warning" label="No license" />
                    )}
                    {entry.categories.map((category) => (
                      <Chip key={category} size="small" label={category} />
                    ))}
                    {entry.trust === 'realm' ? (
                      <Chip size="small" color="success" label="Realm-trusted" />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {entry.description || 'No description.'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {`Publisher: ${entry.profileId} · README: ${
                      entry.readme ? `${entry.readme.length} chars` : 'MISSING'
                    } · Capabilities: network ${
                      entry.capabilities.network?.length ?? 0
                    }, events ${entry.capabilities.events?.length ?? 0} · ` +
                      `hostAbi ${entry.hostAbi ?? 'undeclared'}`}
                  </Typography>
                  {entry.homepageUrl || entry.repositoryUrl ? (
                    <Stack direction="row" spacing={2}>
                      {entry.homepageUrl ? (
                        <MuiLink
                          href={entry.homepageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="caption"
                        >
                          {'Homepage'}
                        </MuiLink>
                      ) : null}
                      {entry.repositoryUrl ? (
                        <MuiLink
                          href={entry.repositoryUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="caption"
                        >
                          {'Repository'}
                        </MuiLink>
                      ) : null}
                    </Stack>
                  ) : null}
                  {entry.verifier ? (
                    entry.verifier.error ? (
                      <Alert severity="warning">
                        {`Verifier: ${entry.verifier.error}`}
                      </Alert>
                    ) : entry.verifier.ok ? (
                      <Alert severity="success">
                        {'Static verifier: clean'}
                      </Alert>
                    ) : (
                      <Alert severity="error">
                        {'Static verifier found problems: ' +
                          (entry.verifier.problems ?? [])
                            .map((problem) => problem.message)
                            .join(' · ')}
                      </Alert>
                    )
                  ) : null}
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    {entry.reviewStatus === 'submitted' ? (
                      <Button
                        size="small"
                        disabled={busy === entry.listingId}
                        onClick={() => void act(entry, 'start-review')}
                      >
                        {'Start review'}
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busy === entry.listingId}
                      onClick={() => void act(entry, 'list')}
                    >
                      {'List'}
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      color="info"
                      disabled={busy === entry.listingId}
                      onClick={() => void act(entry, 'verify')}
                    >
                      {'Verify ✓'}
                    </Button>
                    <Button
                      size="small"
                      color="success"
                      disabled={busy === entry.listingId}
                      onClick={() => void grantRealm(entry)}
                    >
                      {'Grant realm trust'}
                    </Button>
                    <TextField
                      size="small"
                      placeholder="Rejection reason"
                      value={rejectReason[entry.listingId] ?? ''}
                      onChange={(event) =>
                        setRejectReason((current) => ({
                          ...current,
                          [entry.listingId]: event.target.value,
                        }))
                      }
                      sx={{ minWidth: 220 }}
                    />
                    <Button
                      size="small"
                      color="error"
                      disabled={busy === entry.listingId}
                      onClick={() => void act(entry, 'reject')}
                    >
                      {'Reject'}
                    </Button>
                  </Stack>
                </Stack>
              </CardDisplay>
            ))}
            {/* Realm trust for LISTED plugins (AGL-885): once a listing
                leaves the queue, its trust must stay administrable —
                especially revoke, which pulls marketplace code back out of
                the app realm. */}
            {listed.length ? (
              <CardDisplay
                header={'Listed plugins — realm trust'}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    {'Grant signs a version to run in the app realm; revoke ' +
                      'returns it to the sandbox on next load. Super-staff ' +
                      'only, audited.'}
                  </Typography>
                  {listed.map((entry) => (
                    <Stack key={entry.listingId} spacing={0.75}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography variant="subtitle2">
                          {entry.displayName}
                        </Typography>
                        <Chip size="small" label={entry.reviewStatus} />
                        <Typography variant="caption" color="text.secondary">
                          {entry.listingId}
                        </Typography>
                      </Stack>
                      {entry.versions.map((versionEntry) => (
                        <Stack
                          key={versionEntry.version}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap', pl: 1 }}
                        >
                          <Typography variant="body2" sx={{ minWidth: 64 }}>
                            {`v${versionEntry.version}`}
                          </Typography>
                          {versionEntry.version === entry.latestVersion ? (
                            <Chip size="small" label="Latest" />
                          ) : null}
                          {versionEntry.trust === 'realm' ? (
                            <Chip
                              size="small"
                              color="success"
                              label="Realm-trusted"
                            />
                          ) : (
                            <Chip
                              size="small"
                              variant="outlined"
                              label="Sandboxed"
                            />
                          )}
                          {versionEntry.trust === 'realm' ? (
                            <Button
                              size="small"
                              color="error"
                              disabled={busy === entry.listingId}
                              onClick={() =>
                                void signRealm(
                                  entry.listingId,
                                  versionEntry.version,
                                  'revoke',
                                )
                              }
                            >
                              {'Revoke realm trust'}
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              color="success"
                              disabled={busy === entry.listingId}
                              onClick={() =>
                                void signRealm(
                                  entry.listingId,
                                  versionEntry.version,
                                  'grant',
                                )
                              }
                            >
                              {'Grant realm trust'}
                            </Button>
                          )}
                        </Stack>
                      ))}
                    </Stack>
                  ))}
                </Stack>
              </CardDisplay>
            ) : null}
          </Stack>
          </StaffOnly>
        </Container>
      </DashboardLayout>
    </>
  )
}
PluginReviews.displayName = 'Page:AdminPluginReviews'

export default PluginReviews
