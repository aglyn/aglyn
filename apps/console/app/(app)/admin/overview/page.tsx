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

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  GridItems,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import adminNavTabItems from '../../../../constants/admin-nav-tabs'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

function formatDate(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString() : '—'
}

/**
 * Staff overview (AGL-135/238): headline metrics, newest organizations,
 * purchase feed, and top usage rollups — read-only over
 * /api/admin/overview (staff-claim gated); mutations stay on the audited
 * Organizations page.
 */
const AdminOverview: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)
  const [data, setData] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Staff broadcast (wave v5): system.announcement to org admins.
  const [broadcast, setBroadcast] = useState({
    title: '',
    body: '',
    link: '',
    plan: '',
  })
  const [broadcastBusy, setBroadcastBusy] = useState(false)

  const handleBroadcast = async () => {
    if (!broadcast.title.trim() || broadcastBusy) return
    const accepted = await confirm({
      title: 'Send this announcement?',
      description:
        `"${broadcast.title.trim()}" notifies every ` +
        `${broadcast.plan || 'organization'} owner and admin — this is ` +
        'audited.',
      confirmationText: 'Broadcast',
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBroadcastBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          title: broadcast.title.trim(),
          ...(broadcast.body.trim() ? { body: broadcast.body.trim() } : {}),
          ...(broadcast.link.trim() ? { link: broadcast.link.trim() } : {}),
          ...(broadcast.plan ? { plan: broadcast.plan } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Broadcast failed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      } else {
        enqueueSnackbar(
          `Announcement sent to admins of ${payload.orgs} organizations`,
          { variant: 'success', persist: false },
        )
        setBroadcast({ title: '', body: '', link: '', plan: '' })
      }
    } catch (broadcastError) {
      console.error(broadcastError)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      setBroadcastBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    void (user as any)
      ?.getIdTokenResult?.()
      .then((result: any) => {
        if (active) setIsStaff(Boolean(result?.claims?.staff))
      })
      .catch(() => {
        if (active) setIsStaff(false)
      })
    return () => {
      active = false
    }
  }, [user])

  useEffect(() => {
    if (!isStaff || !user) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/admin/overview', {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        })
        const payload = await response.json()
        if (!active) return
        if (!response.ok) setError(payload?.error ?? 'Overview failed')
        else setData(payload)
      } catch {
        if (active) setError('Overview failed')
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, user])

  const metrics = data?.metrics

  return (
    <>
      <NextPageTitle screen={'Overview – Staff'} />
      <DashboardLayout
        navTabItems={adminNavTabItems()}
        activeTab={buildRoute(Route.ADMIN_OVERVIEW)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
          { children: 'Overview', href: buildRoute(Route.ADMIN_OVERVIEW) },
        ]}
        help="staffConsole"
        header={{
          children: 'Platform Overview',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {isStaff === null ? null : !isStaff ? (
            <Alert severity="warning">
              {'Staff only. Grant access with ' +
                'tools/scripts/set-staff-claim.mjs, then sign out and back ' +
                'in to refresh the claim.'}
            </Alert>
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : (
            <>
            {(data?.anomalies ?? []).length ? (
              <Alert severity="warning" sx={{ mb: 3 }}>
                {'Usage anomalies (10x month-over-month): '}
                {(data.anomalies as any[])
                  .map(
                    (anomaly) =>
                      `${anomaly.orgId} (${anomaly.spikes.join('; ')})`,
                  )
                  .join(' · ')}
              </Alert>
            ) : null}
            <GridItems
              spacing={3}
              items={[
                ...[
                  {
                    label: 'Organizations',
                    value: metrics?.orgs,
                    help: 'Total organizations on the platform — one per customer workspace.',
                  },
                  {
                    label: 'Signups (30d)',
                    value: metrics?.signups30d,
                    help: 'Organizations created in the last 30 days.',
                  },
                  {
                    label: 'Sites',
                    value: metrics?.hosts,
                    help: 'Sites (hosts) across every organization, published and draft.',
                  },
                  {
                    label: 'MRR estimate',
                    value:
                      metrics?.mrrUsd != null ? `$${metrics.mrrUsd}` : null,
                    help: 'Monthly recurring revenue estimated from active plan subscriptions.',
                  },
                ].map((metric) => ({
                  size: { xs: 6, md: 3 },
                  children: (
                    <CardDisplay
                      header={metric.label}
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt: metric.help,
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Typography variant="h4">
                        {metric.value ?? '…'}
                      </Typography>
                    </CardDisplay>
                  ),
                })),
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Newest organizations'}
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt:
                          'The most recently created organizations with their plan — open the Organizations page to manage one.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      {(data?.newestOrgs ?? []).length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {'No organizations yet.'}
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {(data?.newestOrgs ?? []).map((org: any) => (
                            <Stack
                              key={org.$id}
                              direction="row"
                              sx={{ justifyContent: 'space-between' }}
                            >
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{ maxWidth: '60%' }}
                              >
                                {org.name ?? org.slug ?? org.$id}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`${org.plan ?? 'no plan'} · ${formatDate(
                                  org.createdAt,
                                )}`}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      )}
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Marketplace purchases'}
                      help={docsHelp('publisherHandbook', {
                        anchor: '#getting-paid',
                        excerpt:
                          'Recent paid plugin purchases with the platform fee taken from each sale.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      {(data?.purchases ?? []).length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {'No purchases yet.'}
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {(data?.purchases ?? []).map((purchase: any) => (
                            <Stack
                              key={purchase.$id}
                              direction="row"
                              sx={{ justifyContent: 'space-between' }}
                            >
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{ maxWidth: '60%' }}
                              >
                                {purchase.listingId ?? purchase.$id}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`$${(purchase.amountCents / 100).toFixed(2)}` +
                                  ` (fee $${(purchase.feeCents / 100).toFixed(
                                    2,
                                  )}) · ${formatDate(purchase.createdAt)}`}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      )}
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12 },
                  children: (
                    <CardDisplay
                      header={`Top usage (${metrics?.rollupMonth ?? 'last month'})`}
                      help={docsHelp('architectureMultiTenancy', {
                        anchor: '#billing--cost-attribution',
                        excerpt:
                          'The organizations with the highest monthly usage rollups — storage, page views, form submissions, and attributed cost.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      {(data?.topUsage ?? []).length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {'No usage rollups for the month — the ' +
                            'report-usage cron writes them (AGL-41).'}
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {(data?.topUsage ?? []).map((usage: any) => (
                            <Stack
                              key={usage.orgId}
                              direction="row"
                              sx={{ justifyContent: 'space-between' }}
                            >
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{ maxWidth: '50%' }}
                              >
                                {usage.orgId}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`${usage.storageGb.toFixed(2)} GB · ` +
                                  `${usage.pageViews} views · ` +
                                  `${usage.formSubmissions} forms · ` +
                                  `$${usage.costUsd.toFixed(2)}`}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      )}
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12 },
                  children: (
                    <CardDisplay
                      header={'Broadcast announcement'}
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt:
                          'Send an in-app announcement to every organization owner and admin, optionally one plan tier. Audited, and mute preferences are respected.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1.5}>
                        <Typography variant="body2" color="text.secondary">
                          {'Notifies every organization owner and admin ' +
                            '(in-app, respects their mute preferences). ' +
                            'Audited.'}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <TextField
                            size="small"
                            label="Title"
                            value={broadcast.title}
                            onChange={(event) =>
                              setBroadcast((previous) => ({
                                ...previous,
                                title: event.target.value,
                              }))
                            }
                            sx={{ flex: 1 }}
                          />
                          <TextField
                            select
                            size="small"
                            label="Audience"
                            value={broadcast.plan}
                            onChange={(event) =>
                              setBroadcast((previous) => ({
                                ...previous,
                                plan: event.target.value,
                              }))
                            }
                            sx={{ minWidth: 160 }}
                          >
                            <MenuItem value="">{'Every org'}</MenuItem>
                            <MenuItem value="starter">{'Starter'}</MenuItem>
                            <MenuItem value="pro">{'Pro'}</MenuItem>
                            <MenuItem value="business">{'Business'}</MenuItem>
                          </TextField>
                        </Stack>
                        <TextField
                          size="small"
                          label="Body (optional)"
                          multiline
                          minRows={2}
                          value={broadcast.body}
                          onChange={(event) =>
                            setBroadcast((previous) => ({
                              ...previous,
                              body: event.target.value,
                            }))
                          }
                        />
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <TextField
                            size="small"
                            label="Link (optional)"
                            placeholder="/manage/notifications or https://…"
                            value={broadcast.link}
                            onChange={(event) =>
                              setBroadcast((previous) => ({
                                ...previous,
                                link: event.target.value,
                              }))
                            }
                            sx={{ flex: 1 }}
                          />
                          <Button
                            variant="contained"
                            color="secondary"
                            disabled={broadcastBusy || !broadcast.title.trim()}
                            onClick={() => void handleBroadcast()}
                          >
                            {broadcastBusy ? 'Sending…' : 'Broadcast'}
                          </Button>
                        </Stack>
                      </Stack>
                    </CardDisplay>
                  ),
                },
              ]}
            />
            </>
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
AdminOverview.displayName = 'Page:AdminOverview'

export default AdminOverview
