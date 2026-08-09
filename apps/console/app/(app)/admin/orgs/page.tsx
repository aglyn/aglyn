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
  isEnterpriseOrg,
  PLAN_LABELS,
  resolveOrgEntitlements,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import StaffOrgActions, {
  overrideCount,
} from '../../../../components/staff-org-actions.component'
import StaffOrgUsageTable, {
  type StaffOrgUsageMonth,
} from '../../../../components/staff-org-usage-table.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

/**
 * Staff organization management (AGL-238, grown from the AGL-42 tenant
 * page): list orgs, override plan and entitlements, inspect billing state,
 * suspend, and flag GDPR erasure. Every change writes an adminAudit entry.
 * The page trusts the `staff` custom claim (set via
 * tools/scripts/set-staff-claim.mjs); the org rules admit super-staff
 * writes on the billing/suspension keys and billing-staff writes on plan
 * and entitlements, so the same claims gate server-side.
 */
const AdminOrgs: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  // Staff org list via the Admin SDK API (AGL-878). Reading `collection('orgs')`
  // from the client returned a non-deterministic subset — that list is gated by
  // the `isStaff() || isOrgMember()` rule and rides App Check. `/api/admin/orgs`
  // reads it with the service account (bypasses both), so staff reliably see
  // EVERY org, with cursor pagination (`after` = the last doc id).
  const [orgDocs, setOrgDocs] = useState<any[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  // `after` cursor (the last doc id) for the START of each page; page 0 has none.
  const pageCursorsRef = useRef<Array<string | null>>([null])

  const loadPage = useCallback(
    async (index: number) => {
      setLoading(true)
      try {
        const idToken = await (user as { getIdToken?: () => Promise<string> })
          ?.getIdToken?.()
        const after = pageCursorsRef.current[index] ?? ''
        const response = await fetch(
          `/api/admin/orgs${after ? `?after=${encodeURIComponent(after)}` : ''}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error ?? 'Failed')
        setOrgDocs(payload.orgs ?? [])
        setHasMore(Boolean(payload.hasMore))
        // Remember where the NEXT page starts (the last doc id on this one).
        if (payload.hasMore && payload.nextCursor) {
          pageCursorsRef.current[index + 1] = payload.nextCursor
        }
        setPageIndex(index)
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not load organizations', { variant: 'error' })
      } finally {
        setLoading(false)
      }
    },
    [user, enqueueSnackbar],
  )
  // Initial load; also the target for the post-mutation refresh.
  useEffect(() => {
    void loadPage(0)
  }, [loadPage])
  const refresh = useCallback(() => void loadPage(pageIndex), [loadPage, pageIndex])

  // Search/sort (AGL-135) over the current page.
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'plan' | 'newest'>('name')
  const needle = search.trim().toLowerCase()
  const orgs = [...orgDocs]
    .filter(
      (org) =>
        !needle ||
        [org.$id, org.name, org.slug, org.plan]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      if (sortBy === 'plan') {
        return String(a.plan ?? '').localeCompare(String(b.plan ?? ''))
      }
      if (sortBy === 'newest') {
        return (
          (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
        )
      }
      return String(a.name ?? a.$id).localeCompare(String(b.name ?? b.$id))
    })

  // Usage drill-down (AGL-205): last 12 monthly org rollups with deltas.
  const [usage, setUsage] = useState<{
    orgId: string
    months: StaffOrgUsageMonth[]
  } | null>(null)
  const [usageLoading, setUsageLoading] = useState<string | null>(null)
  const handleShowUsage = useCallback(
    (orgId: string) => async () => {
      setUsageLoading(orgId)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/org-usage?orgId=${encodeURIComponent(orgId)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error ?? 'Usage failed')
        setUsage({ orgId, months: payload.months ?? [] })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not load usage', { variant: 'error' })
      } finally {
        setUsageLoading(null)
      }
    },
    [user, enqueueSnackbar],
  )

  // Override, suspend and erasure moved to the shared StaffOrgActions
  // component (AGL-939) so the org detail page carries the same audited
  // actions without this page and that one drifting apart.

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
          { children: 'Organizations', href: buildRoute(Route.ADMIN_ORGS) },
        ]}
        help="staffConsole"
        header={{
          children: 'Organization Management',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {/* Card-framed header + filters (AGL-385), consistent with the
              user-management page. */}
          <StaffOnly>
            <CardDisplay
              header={'Organizations'}
              help={docsHelp('billing', {
                anchor: '#tiers--entitlements',
                excerpt:
                  'Audited staff controls per organization — override the plan and entitlements, inspect usage, suspend its sites, or flag GDPR erasure.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {'Overrides write to the org doc and are audited to ' +
                    'adminAudit. Organizations without a plan keep every ' +
                    'feature (dark launch).'}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    label="Search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    sx={{ minWidth: 220 }}
                  />
                  <TextField
                    select
                    size="small"
                    label="Sort"
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value as any)}
                    sx={{ minWidth: 120 }}
                  >
                    <MenuItem value="name">{'Name'}</MenuItem>
                    <MenuItem value="plan">{'Plan'}</MenuItem>
                    <MenuItem value="newest">{'Newest'}</MenuItem>
                  </TextField>
                </Stack>
              {orgs.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {loading
                    ? 'Loading…'
                    : needle
                      ? 'No organizations on this page match your search.'
                      : 'No organizations yet — they are created at signup ' +
                        'or first site.'}
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Organization'}</TableCell>
                      <TableCell>{'Plan'}</TableCell>
                      <TableCell>{'Subscription'}</TableCell>
                      <TableCell>{'Site limit'}</TableCell>
                      <TableCell>{'Created'}</TableCell>
                      <TableCell align="right">{'Actions'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orgs.map((org) => {
                      const resolved = resolveOrgEntitlements(org)
                      return (
                        <TableRow key={org.$id} hover>
                          <TableCell>
                            <Stack>
                              <Typography variant="body2" noWrap>
                                {org.name ?? org.$id}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontFamily: 'monospace' }}
                              >
                                {org.slug ?? org.$id}
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            {/* Show the plan the org READS as (AGL-1118) — an
                                org on a pre-AGL-1118 enterprise arrangement
                                stores a lower base plan, and listing that here
                                contradicted its own Billing page. */}
                            <Chip
                              label={
                                isEnterpriseOrg(org as never)
                                  ? PLAN_LABELS.enterprise
                                  : (org.plan ?? 'no plan')
                              }
                              size="small"
                              color={org.plan ? 'primary' : 'default'}
                            />
                            {org.suspendedAt ? (
                              <Chip
                                label="suspended"
                                size="small"
                                color="error"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                            {org.erasureRequestedAt ? (
                              <Chip
                                label="erasure requested"
                                size="small"
                                color="error"
                                variant="outlined"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {org.subscription?.status ?? '--'}
                          </TableCell>
                          <TableCell>
                            {/* An UNLIMITED quota is Number.POSITIVE_INFINITY,
                                which renders as the literal "Infinity"
                                (AGL-1118 — the enterprise plan is the first
                                one whose hostLimit is uncapped). */}
                            {!org.plan
                              ? '∞ (no plan)'
                              : Number.isFinite(resolved.hostLimit)
                                ? resolved.hostLimit
                                : '∞'}
                            {overrideCount(org) ? (
                              <Chip
                                label={`${overrideCount(org)} override${
                                  overrideCount(org) === 1 ? '' : 's'
                                }`}
                                size="small"
                                variant="outlined"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {org.createdAt?.seconds
                                ? new Date(
                                    org.createdAt.seconds * 1000,
                                  ).toLocaleDateString()
                                : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <AppLink
                              componentVariant="button"
                              size="small"
                              href={buildRoute(Route.ADMIN_ORG_DETAIL, {
                                orgId: org.$id,
                              })}
                            >
                              {'Open'}
                            </AppLink>
                            <Button
                              size="small"
                              disabled={usageLoading === org.$id}
                              onClick={handleShowUsage(org.$id)}
                            >
                              {usageLoading === org.$id
                                ? 'Loading…'
                                : 'Usage'}
                            </Button>
                            <StaffOrgActions org={org} onChanged={refresh} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
              {/* Pagination (AGL-878): each page is a fresh Admin-SDK read via
                  /api/admin/orgs, so the list is complete and never flickers.
                  Always shown so the control is visible even on a single page. */}
              {orgDocs.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ mt: 1, alignItems: 'center' }}
                >
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={loading || pageIndex === 0}
                    onClick={() => void loadPage(pageIndex - 1)}
                  >
                    {'Previous'}
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    {`Page ${pageIndex + 1} · ${orgDocs.length} shown`}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={loading || !hasMore}
                    onClick={() => void loadPage(pageIndex + 1)}
                  >
                    {'Next'}
                  </Button>
                </Stack>
              ) : null}
              </Stack>
            </CardDisplay>
          </StaffOnly>
        </Container>
      </DashboardLayout>
      <Dialog
        open={Boolean(usage)}
        onClose={() => setUsage(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`Usage — ${usage?.orgId}`}</DialogTitle>
        <DialogContent>
          <StaffOrgUsageTable months={usage?.months ?? []} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUsage(null)}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
AdminOrgs.displayName = 'Page:AdminOrgs'

export default AdminOrgs
