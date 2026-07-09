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

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

function formatDate(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString() : '—'
}

/**
 * Staff overview (AGL-135): headline metrics, newest tenants, cross-tenant
 * purchase feed, and top usage rollups — read-only over
 * /api/admin/overview (staff-claim gated); mutations stay on the audited
 * Tenants page.
 */
const AdminOverview: NextPageWithLayout = () => {
  const { data: user } = useUser()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)
  const [data, setData] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        navTabItems={[
          {
            id: 'nav-tab-admin-overview',
            label: 'Overview',
            href: buildRoute(Route.ADMIN_OVERVIEW),
          },
          {
            id: 'nav-tab-admin-tenants',
            label: 'Tenants',
            href: buildRoute(Route.ADMIN_TENANTS),
          },
          {
            id: 'nav-tab-admin-users',
            label: 'Users',
            href: buildRoute(Route.ADMIN_USERS),
          },
          {
            id: 'nav-tab-admin-audit',
            label: 'Audit log',
            href: buildRoute(Route.ADMIN_AUDIT),
          },
        ]}
        activeTab={buildRoute(Route.ADMIN_OVERVIEW)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
          { children: 'Overview', href: buildRoute(Route.ADMIN_OVERVIEW) },
        ]}
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
                      `${anomaly.tenantId} (${anomaly.spikes.join('; ')})`,
                  )
                  .join(' · ')}
              </Alert>
            ) : null}
            <GridItems
              spacing={3}
              items={[
                ...[
                  { label: 'Tenants', value: metrics?.tenants },
                  { label: 'Signups (30d)', value: metrics?.signups30d },
                  { label: 'Hosts', value: metrics?.hosts },
                  {
                    label: 'MRR estimate',
                    value:
                      metrics?.mrrUsd != null ? `$${metrics.mrrUsd}` : null,
                  },
                ].map((metric) => ({
                  size: { xs: 6, md: 3 },
                  children: (
                    <CardDisplay
                      header={metric.label}
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
                      header={'Newest tenants'}
                      contentGutterX
                      contentGutterY
                    >
                      {(data?.newestTenants ?? []).length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {'No tenants yet.'}
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {(data?.newestTenants ?? []).map((tenant: any) => (
                            <Stack
                              key={tenant.$id}
                              direction="row"
                              sx={{ justifyContent: 'space-between' }}
                            >
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{ maxWidth: '60%' }}
                              >
                                {tenant.displayName ?? tenant.$id}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`${tenant.plan ?? 'no plan'} · ${formatDate(
                                  tenant.createdAt,
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
                              key={usage.tenantId}
                              direction="row"
                              sx={{ justifyContent: 'space-between' }}
                            >
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{ maxWidth: '50%' }}
                              >
                                {usage.tenantId}
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
AdminOverview.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Staff Overview',
      enableAppBarElevation: true,
    },
  },
]

export default AdminOverview
