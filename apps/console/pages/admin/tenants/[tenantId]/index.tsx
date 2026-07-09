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

import {
  PLAN_ENTITLEMENTS,
  resolveTenantEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Alert,
  Chip,
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
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../hooks/use-firestore-doc'

/**
 * Read-only tenant detail for staff (AGL-207). This is the "view as
 * tenant" support surface WITHOUT session impersonation: staff read
 * privileges render the tenant's hosts, effective entitlements, and the
 * audit slice for this tenant — no minted tokens, no write surface, so
 * there is nothing to lock down. Mutations stay on the audited tenants
 * list page.
 */
const AdminTenantDetail: NextPageWithLayout = () => {
  const params = useParams<{ tenantId?: string }>()
  const tenantId = params?.tenantId ?? ''
  const { data: user } = useUser()
  const firestore = useFirestore()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)

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

  const { data: tenant } = useFirestoreDoc<any>(
    () => doc(firestore, 'tenants', tenantId || 'missing'),
    [firestore, tenantId],
    { idField: '$id' },
  )
  const { data: hostDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts'),
        where('tenantId', '==', tenantId || 'missing'),
        limit(50),
      ),
    [firestore, tenantId],
    { idField: '$id' },
  )
  const { data: auditDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'adminAudit'),
        orderBy('at', 'desc'),
        limit(200),
      ),
    [firestore],
    { idField: '$id' },
  )
  const tenantAudit = useMemo(
    () =>
      (auditDocs ?? [])
        .filter((entry: any) =>
          String(entry.target ?? '').includes(tenantId),
        )
        .slice(0, 20),
    [auditDocs, tenantId],
  )

  const resolved = tenant ? resolveTenantEntitlements(tenant) : null
  const planDefaults = tenant?.plan
    ? PLAN_ENTITLEMENTS[tenant.plan as keyof typeof PLAN_ENTITLEMENTS]
    : null
  const formatLimit = (value: number) =>
    value === UNLIMITED ? '∞' : value.toLocaleString()

  return (
    <>
      <NextPageTitle screen={'Tenant – Staff'} />
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
        activeTab={buildRoute(Route.ADMIN_TENANTS)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_TENANTS) },
          { children: 'Tenants', href: buildRoute(Route.ADMIN_TENANTS) },
          { children: tenantId },
        ]}
        header={{
          children: 'Tenant Detail',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {isStaff === null ? null : !isStaff ? (
            <Alert severity="error">
              {'This area requires the staff role.'}
            </Alert>
          ) : (
            <>
              <Alert severity="info" sx={{ mb: 3 }}>
                {'Read-only staff view — changes happen on the Tenants ' +
                  'page where they are audited.'}
              </Alert>
              <GridItems
                spacing={3}
                items={[
                  {
                    size: { xs: 12, md: 6 },
                    children: (
                      <CardDisplay
                        header={'Summary'}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={1}>
                            <Chip
                              label={tenant?.plan ?? 'no plan'}
                              size="small"
                              color={tenant?.plan ? 'secondary' : 'default'}
                            />
                            {tenant?.suspendedAt ? (
                              <Chip
                                label={`suspended${
                                  tenant?.suspendedReason
                                    ? `: ${tenant.suspendedReason}`
                                    : ''
                                }`}
                                size="small"
                                color="error"
                              />
                            ) : null}
                            {tenant?.subscription?.status ? (
                              <Chip
                                label={tenant.subscription.status}
                                size="small"
                                variant="outlined"
                              />
                            ) : null}
                          </Stack>
                          <Typography variant="body2">
                            {tenant?.displayName ?? '—'}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {tenantId}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {`Stripe: ${tenant?.stripeCustomerId ?? '—'}`}
                          </Typography>
                        </Stack>
                      </CardDisplay>
                    ),
                  },
                  {
                    size: { xs: 12, md: 6 },
                    children: (
                      <CardDisplay
                        header={`Hosts (${(hostDocs ?? []).length})`}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={1}>
                          {(hostDocs ?? []).length === 0 ? (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {'No hosts.'}
                            </Typography>
                          ) : (
                            (hostDocs ?? []).map((host: any) => (
                              <Stack
                                key={host.$id}
                                direction="row"
                                spacing={1}
                                sx={{ justifyContent: 'space-between' }}
                              >
                                <Typography variant="body2" noWrap>
                                  {host.displayName ??
                                    host.subdomain ??
                                    host.$id}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ fontFamily: 'monospace' }}
                                >
                                  {host.$id}
                                </Typography>
                              </Stack>
                            ))
                          )}
                        </Stack>
                      </CardDisplay>
                    ),
                  },
                  {
                    size: { xs: 12, md: 6 },
                    children: (
                      <CardDisplay
                        header={'Effective entitlements'}
                        contentGutterX
                        contentGutterY
                      >
                        {resolved ? (
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>{'Key'}</TableCell>
                                <TableCell align="right">
                                  {'Effective'}
                                </TableCell>
                                <TableCell align="right">
                                  {'Plan default'}
                                </TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {Object.entries(resolved)
                                .filter(
                                  ([key, value]) =>
                                    key !== 'features' &&
                                    typeof value === 'number',
                                )
                                .map(([key, value]) => {
                                  const fallback = (planDefaults as any)?.[
                                    key
                                  ]
                                  const overridden =
                                    tenant?.entitlements?.[key] != null
                                  return (
                                    <TableRow key={key}>
                                      <TableCell>
                                        {key}
                                        {overridden ? (
                                          <Chip
                                            label="override"
                                            size="small"
                                            variant="outlined"
                                            sx={{ ml: 1 }}
                                          />
                                        ) : null}
                                      </TableCell>
                                      <TableCell align="right">
                                        {formatLimit(value as number)}
                                      </TableCell>
                                      <TableCell align="right">
                                        {fallback != null
                                          ? formatLimit(fallback)
                                          : '—'}
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                            </TableBody>
                          </Table>
                        ) : null}
                      </CardDisplay>
                    ),
                  },
                  {
                    size: { xs: 12, md: 6 },
                    children: (
                      <CardDisplay
                        header={'Recent admin actions on this tenant'}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={1}>
                          {tenantAudit.length === 0 ? (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {'No audit entries reference this tenant in ' +
                                'the latest 200.'}
                            </Typography>
                          ) : (
                            tenantAudit.map((entry: any) => (
                              <Stack
                                key={entry.$id}
                                direction="row"
                                spacing={1}
                                sx={{ justifyContent: 'space-between' }}
                              >
                                <Chip label={entry.action} size="small" />
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {`${entry.actorUid} · ${
                                    entry.at?.seconds
                                      ? new Date(
                                          entry.at.seconds * 1000,
                                        ).toLocaleString()
                                      : '—'
                                  }`}
                                </Typography>
                              </Stack>
                            ))
                          )}
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
AdminTenantDetail.displayName = 'Page:AdminTenantDetail'
AdminTenantDetail.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Tenant – Staff' } },
]

export default AdminTenantDetail
