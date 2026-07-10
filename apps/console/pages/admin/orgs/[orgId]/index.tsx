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
import adminNavTabItems from '../../../../constants/admin-nav-tabs'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../hooks/use-firestore-doc'

/**
 * Read-only organization detail for staff (AGL-207/238). Support surface
 * WITHOUT session impersonation: staff read privileges render the org's
 * sites, member roster, effective entitlements, and the audit slice for
 * this org — no minted tokens, no write surface, so there is nothing to
 * lock down. Mutations stay on the audited Organizations list page.
 */
const AdminOrgDetail: NextPageWithLayout = () => {
  const params = useParams<{ orgId?: string }>()
  const orgId = params?.orgId ?? ''
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

  const { data: org } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId || 'missing'),
    [firestore, orgId],
    { idField: '$id' },
  )
  const { data: hostDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts'),
        where('orgId', '==', orgId || 'missing'),
        limit(50),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId || 'missing', 'members'),
        limit(100),
      ),
    [firestore, orgId],
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
  const orgAudit = useMemo(
    () =>
      (auditDocs ?? [])
        .filter((entry: any) => String(entry.target ?? '').includes(orgId))
        .slice(0, 20),
    [auditDocs, orgId],
  )

  const resolved = org ? resolveTenantEntitlements(org) : null
  const planDefaults = org?.plan
    ? PLAN_ENTITLEMENTS[org.plan as keyof typeof PLAN_ENTITLEMENTS]
    : null
  const formatLimit = (value: number) =>
    value === UNLIMITED ? '∞' : value.toLocaleString()

  return (
    <>
      <NextPageTitle screen={'Organization – Staff'} />
      <DashboardLayout
        navTabItems={adminNavTabItems()}
        activeTab={buildRoute(Route.ADMIN_ORGS)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_ORGS) },
          { children: 'Organizations', href: buildRoute(Route.ADMIN_ORGS) },
          { children: org?.name ?? orgId },
        ]}
        header={{
          children: 'Organization Detail',
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
                {'Read-only staff view — changes happen on the ' +
                  'Organizations page where they are audited.'}
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
                              label={org?.plan ?? 'no plan'}
                              size="small"
                              color={org?.plan ? 'secondary' : 'default'}
                            />
                            {org?.suspendedAt ? (
                              <Chip
                                label={`suspended${
                                  org?.suspendedReason
                                    ? `: ${org.suspendedReason}`
                                    : ''
                                }`}
                                size="small"
                                color="error"
                              />
                            ) : null}
                            {org?.subscription?.status ? (
                              <Chip
                                label={org.subscription.status}
                                size="small"
                                variant="outlined"
                              />
                            ) : null}
                          </Stack>
                          <Typography variant="body2">
                            {org?.name ?? '—'}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {`${orgId} · ${org?.slug ?? 'no slug'}`}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {`Owner: ${org?.ownerUid ?? '—'}`}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {`Stripe: ${org?.stripeCustomerId ?? '—'}`}
                          </Typography>
                        </Stack>
                      </CardDisplay>
                    ),
                  },
                  {
                    size: { xs: 12, md: 6 },
                    children: (
                      <CardDisplay
                        header={`Sites (${(hostDocs ?? []).length})`}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={1}>
                          {(hostDocs ?? []).length === 0 ? (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {'No sites.'}
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
                        header={`Members (${(memberDocs ?? []).length})`}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={1}>
                          {(memberDocs ?? []).length === 0 ? (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {'No members.'}
                            </Typography>
                          ) : (
                            (memberDocs ?? []).map((member: any) => (
                              <Stack
                                key={member.$id}
                                direction="row"
                                spacing={1}
                                sx={{
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <Typography variant="body2" noWrap>
                                  {member.email ??
                                    member.displayName ??
                                    member.$id}
                                </Typography>
                                <Stack direction="row" spacing={1}>
                                  <Chip
                                    label={member.role ?? 'viewer'}
                                    size="small"
                                    variant="outlined"
                                  />
                                  {member.allHosts ? (
                                    <Chip
                                      label="all sites"
                                      size="small"
                                    />
                                  ) : null}
                                </Stack>
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
                                    org?.entitlements?.[key] != null
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
                        header={'Recent admin actions on this organization'}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={1}>
                          {orgAudit.length === 0 ? (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {'No audit entries reference this ' +
                                'organization in the latest 200.'}
                            </Typography>
                          ) : (
                            orgAudit.map((entry: any) => (
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
AdminOrgDetail.displayName = 'Page:AdminOrgDetail'
AdminOrgDetail.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Organization – Staff' } },
]

export default AdminOrgDetail
