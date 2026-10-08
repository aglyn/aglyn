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
  checkDiscountMargin,
  DISCOUNT_APPROVAL_THRESHOLD_PCT,
  MARGIN_SCOPE_NOTE,
} from '@aglyn/aglyn'
import {
  couponCaseLabel,
  deepestCouponPercentWithinFullUse,
  describeDiscountFullUse,
  rateCouponAgainstFullUse,
} from '@aglyn/aglyn/app-utils/full-use-cost'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { GridColDef } from '@mui/x-data-grid'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import StaffListPaginationControls from '../../../../components/staff-list-pagination.component'
import StaffOnly from '../../../../components/staff-only.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import { useStaffListQuery } from '../../../../hooks/use-staff-list-query'
import {
  COUPON_DURATIONS,
  COUPON_FILTER_FIELDS,
  COUPON_FILTER_HEADERS,
  COUPON_FILTER_OPTIONS,
  type CouponListRow,
  type CouponRow,
} from '../../../../utils/coupon-list-query'

/** The picked fields, which the panel shows as selects. */
const COUPON_SELECT_FIELDS = Object.keys(COUPON_FILTER_OPTIONS)

/** Asks the route for the Coupons page's list rather than the picker's set. */
const COUPON_LIST_PARAMS = { view: 'list' } as const

/**
 * A representative paying subscription for the live rating readout — a
 * typical Business customer on a single site. The rating on the creation page
 * is a "what would this do to a normal customer" preview; the real per-org
 * check runs when staff apply the coupon on an organization.
 *
 * Note what this cannot know (AGL-1120): the coupon has no org yet, so the
 * cost side of the rating is a hypothetical, and a single site is the
 * CHEAPEST case to serve — the most generous assumption available, which is
 * backwards for a guardrail. The depth half of the verdict is exact, since
 * percent-off list does not depend on which org redeems it; the readout says
 * as much rather than presenting the whole rating as binding.
 */
const REFERENCE_ORG = {
  plan: 'business',
  subscription: { status: 'active', interval: 'month' },
} as const

const RATING_COLOR = {
  ok: 'success',
  warn: 'warning',
  block: 'error',
} as const

/**
 * The promotion code a staff member has asked to flip, held while the confirm
 * dialog is open. `activate` is the direction being requested, not the state
 * the code is in; `percentOff` comes from the owning coupon so the dialog can
 * raise the same sign-off the creation form raises.
 */
interface PendingToggle {
  id: string
  code: string
  activate: boolean
  percentOff: number | null
  /** The rest of the owning coupon, for its full-use warning (AGL-3473). */
  amountOffUsd: number | null
  duration: string | null
  durationInMonths: number | null
}

/** A coupon row's discount and duration, as the full-use verdict reads them. */
function couponFullUse(
  row: Pick<CouponRow, 'percentOff' | 'amountOffUsd' | 'duration' | 'durationInMonths'>,
) {
  return rateCouponAgainstFullUse(
    row.percentOff != null
      ? { percentOff: row.percentOff }
      : row.amountOffUsd != null
        ? { amountOffUsd: row.amountOffUsd }
        : {},
    { duration: row.duration, durationInMonths: row.durationInMonths },
  )
}

/**
 * What each duration takes the discount off, under the Duration picker —
 * Stripe's three durations already say "first month", "first N months" and
 * "the annual purchase", once it is said which charges they reach.
 */
const DURATION_HELP: Record<'once' | 'repeating' | 'forever', string> = {
  once: 'The first charge: the first month, or the whole first year when billed annually.',
  repeating: 'The charges in the first N months: N monthly charges, or the first annual charge.',
  forever: 'Every charge, for as long as the subscription lasts.',
}

/**
 * Staff coupon console (AGL-1105): create discount coupons and promotion
 * codes (percent or fixed, once/repeating/forever, optional code, redemption
 * cap and expiry), see the live net-margin rating before committing, and
 * review existing coupons. Backed by the audited `/api/admin/coupons` route.
 */
const AdminCoupons: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const isStaff = useIsStaff()

  /*
   * The list PAGES (AGL-2501), and the route answers every filter and the
   * search (AGL-3321). A coupon is a Stripe object, so there is no query to
   * put a clause on: the route reads every coupon and every promotion code
   * Stripe holds and matches the clauses over all of them, then hands back
   * one page. Nothing here narrows the rows it is given.
   */
  const gridFilter = useListGridFilter({ selectFields: COUPON_SELECT_FIELDS })
  // Stable, because the list re-reads whenever its error handler changes.
  const onListError = useCallback(
    (error: unknown) =>
      enqueueSnackbar(
        error instanceof Error && error.message ? error.message : 'Loading coupons failed',
        { variant: 'error' },
      ),
    [enqueueSnackbar],
  )
  const couponList = useStaffListQuery<CouponListRow>({
    endpoint: isStaff ? '/api/admin/coupons' : null,
    clauses: gridFilter.clauses,
    search: gridFilter.searchWords,
    params: COUPON_LIST_PARAMS,
    onError: onListError,
  })
  const { refresh: refreshCoupons } = couponList
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    name: '',
    kind: 'percent' as 'percent' | 'amount',
    percentOff: '25',
    amountOffUsd: '10',
    duration: 'once' as 'once' | 'repeating' | 'forever',
    durationInMonths: '3',
    code: '',
    maxRedemptions: '',
    expiresAt: '',
    confirmHighDiscount: false,
  })

  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null)
  const [toggleConfirmed, setToggleConfirmed] = useState(false)

  // Live rating (AGL-1105): rate the proposed discount against a typical
  // Business subscription so staff see the margin impact as they type.
  const rating = useMemo(() => {
    const discount =
      form.kind === 'percent'
        ? { percentOff: Number(form.percentOff) || 0 }
        : { amountOffUsd: Number(form.amountOffUsd) || 0 }
    return checkDiscountMargin(REFERENCE_ORG as any, discount)
  }, [form.kind, form.percentOff, form.amountOffUsd])

  // The full-use warning (AGL-3473), on every paid plan at both intervals,
  // on the charges the chosen duration reaches. Unlike the rating above it
  // does not depend on which org redeems the coupon — a code can be typed on
  // any plan — and it refuses nothing: the route answers the same verdict
  // with the created coupon.
  const fullUse = useMemo(
    () =>
      couponFullUse({
        percentOff: form.kind === 'percent' ? Number(form.percentOff) || 0 : null,
        amountOffUsd: form.kind === 'amount' ? Number(form.amountOffUsd) || 0 : null,
        duration: form.duration,
        durationInMonths:
          form.duration === 'repeating' ? Number(form.durationInMonths) || null : null,
      }),
    [form.kind, form.percentOff, form.amountOffUsd, form.duration, form.durationInMonths],
  )
  const deepestPercent = useMemo(() => deepestCouponPercentWithinFullUse(), [])

  const needsApproval =
    form.kind === 'percent' &&
    Number(form.percentOff) >= DISCOUNT_APPROVAL_THRESHOLD_PCT

  const update = (patch: Partial<typeof form>) =>
    setForm((previous) => ({ ...previous, ...patch }))

  const create = async () => {
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim() || undefined,
          percentOff: form.kind === 'percent' ? Number(form.percentOff) : undefined,
          amountOffUsd:
            form.kind === 'amount' ? Number(form.amountOffUsd) : undefined,
          duration: form.duration,
          durationInMonths:
            form.duration === 'repeating' ? Number(form.durationInMonths) : undefined,
          code: form.code.trim() || undefined,
          maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : undefined,
          expiresAt: form.expiresAt || undefined,
          confirmHighDiscount: form.confirmHighDiscount,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Create failed (${response.status})`)
      }
      enqueueSnackbar('Coupon created', { variant: 'success' })
      // Created all the same; the server's account of what it spends stays
      // up long enough to read.
      if (payload.fullUse?.warning) {
        enqueueSnackbar(`Under full-use cost. ${payload.fullUse.warning}`, {
          variant: 'warning',
          autoHideDuration: 15000,
        })
      }
      update({ code: '', name: '', confirmHighDiscount: false })
      refreshCoupons()
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the coupon failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  /*
   * Turning a code back on re-commits the discount, so it carries the same
   * ≥`DISCOUNT_APPROVAL_THRESHOLD_PCT`% sign-off the creation form does. The
   * server enforces it either way; the checkbox is what makes the commitment
   * visible before the click rather than after the refusal.
   */
  const toggleNeedsApproval =
    pendingToggle?.activate === true &&
    pendingToggle.percentOff != null &&
    pendingToggle.percentOff >= DISCOUNT_APPROVAL_THRESHOLD_PCT

  // Turning a code on is minting it again, so the dialog carries the same
  // full-use warning the creation form does.
  const toggleFullUse = useMemo(
    () => (pendingToggle?.activate ? couponFullUse(pendingToggle) : null),
    [pendingToggle],
  )

  const openToggle = useCallback((pending: PendingToggle) => {
    setPendingToggle(pending)
    setToggleConfirmed(false)
  }, [])

  const toggleCode = async () => {
    if (!pendingToggle) return
    const { id, code, activate } = pendingToggle
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: activate ? 'activate' : 'deactivate',
          promotionCodeId: id,
          confirmHighDiscount: toggleConfirmed,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Update failed (${response.status})`)
      }
      enqueueSnackbar(`${code} ${activate ? 'activated' : 'deactivated'}`, {
        variant: 'success',
      })
      if (payload.fullUse?.warning) {
        enqueueSnackbar(`Under full-use cost. ${payload.fullUse.warning}`, {
          variant: 'warning',
          autoHideDuration: 15000,
        })
      }
      setPendingToggle(null)
      refreshCoupons()
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Updating the code failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const couponRefusals = useMemo(
    () =>
      listQueryRefusals(couponList.refused, {
        fields: COUPON_FILTER_FIELDS,
        headers: COUPON_FILTER_HEADERS,
        options: COUPON_FILTER_OPTIONS,
      }),
    [couponList.refused],
  )
  const noCouponsYet =
    !couponList.loading &&
    !couponList.failed &&
    !couponList.filtering &&
    couponList.rows.length === 0 &&
    couponList.pageIndex === 0

  const discountLabel = (row: Pick<CouponRow, 'percentOff' | 'amountOffUsd'>) =>
    row.percentOff != null
      ? `${row.percentOff}% off`
      : row.amountOffUsd != null
        ? `$${row.amountOffUsd} off`
        : '—'

  const couponColumns = useMemo(() => listFilterGridColumns([
    {
      field: 'name',
      headerName: 'Coupon',
      flex: 1.2,
      minWidth: 180,
      valueGetter: (_value, row: CouponListRow) => row.name ?? row.id,
      renderCell: ({ row }: { row: CouponListRow }) => (
        <Stack spacing={0.25} sx={{ py: 1 }}>
          <Typography variant="body2">{row.name ?? row.id}</Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: 'monospace' }}
          >
            {row.id}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'discount',
      headerName: 'Discount',
      width: 120,
      sortable: false,
      valueGetter: (_value, row: CouponListRow) => discountLabel(row),
    },
    {
      field: 'duration',
      headerName: 'Duration',
      width: 130,
      renderCell: ({ row }: { row: CouponListRow }) =>
        row.duration === 'repeating'
          ? `${row.durationInMonths}mo`
          : (row.duration ?? '—'),
    },
    {
      // The full-use verdict (AGL-3473), worked out here from the row: the
      // worst plan and billing combination the coupon could be redeemed on.
      field: 'fullUse',
      headerName: 'Full-use cost',
      width: 170,
      sortable: false,
      filterable: false,
      renderCell: ({ row }: { row: CouponListRow }) => {
        const verdict = couponFullUse(row)
        return (
          <Tooltip
            title={
              verdict.warning ??
              describeDiscountFullUse(verdict.worst, couponCaseLabel(verdict.worst))
            }
          >
            <Chip
              size="small"
              variant={verdict.ok ? 'outlined' : 'filled'}
              color={verdict.ok ? 'success' : 'warning'}
              label={
                verdict.ok
                  ? 'Covers cost'
                  : `Under · ${verdict.worst.coverage.toFixed(2)}×`
              }
            />
          </Tooltip>
        )
      },
    },
    {
      field: 'codes',
      headerName: 'Codes',
      flex: 1.4,
      minWidth: 240,
      sortable: false,
      renderCell: ({ row }: { row: CouponListRow }) =>
        row.codes.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {'—'}
          </Typography>
        ) : (
          <Stack spacing={0.5} sx={{ py: 1 }}>
            {row.codes.map((code) => (
              <Stack
                key={code.id}
                direction="row"
                spacing={0.5}
                sx={{ alignItems: 'center' }}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={code.code}
                  color={code.active ? 'default' : 'error'}
                />
                {/* An inactive code is not merely a badge: checkout looks
                    codes up with `active=true`, so a customer typing it is
                    told it is not recognized. */}
                <Button
                  size="small"
                  color={code.active ? 'error' : 'primary'}
                  disabled={busy}
                  onClick={() =>
                    openToggle({
                      id: code.id,
                      code: code.code,
                      activate: !code.active,
                      percentOff: row.percentOff,
                      amountOffUsd: row.amountOffUsd,
                      duration: row.duration,
                      durationInMonths: row.durationInMonths,
                    })
                  }
                >
                  {code.active ? 'Deactivate' : 'Activate'}
                </Button>
              </Stack>
            ))}
          </Stack>
        ),
    },
    {
      field: 'timesRedeemed',
      headerName: 'Redeemed',
      type: 'number',
      width: 110,
      renderCell: ({ row }: { row: CouponListRow }) =>
        row.maxRedemptions
          ? `${row.timesRedeemed}/${row.maxRedemptions}`
          : row.timesRedeemed,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: ({ row }: { row: CouponListRow }) => (
        <Chip
          size="small"
          label={row.valid ? 'valid' : 'expired'}
          color={row.valid ? 'success' : 'default'}
        />
      ),
    },
  ] as GridColDef<CouponListRow>[] as GridColDef[],
  COUPON_FILTER_FIELDS,
  COUPON_FILTER_OPTIONS,
  COUPON_FILTER_HEADERS),
  [busy, openToggle])

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Coupons', href: buildRoute(Route.ADMIN_COUPONS) },
      ]}
      help={{ topic: 'staffConsole', anchor: '#coupons' }}
      header={{
        children: 'Coupons',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            <Alert severity="info">
              {
                'Coupons live in Stripe. Create one here, then apply it to an ' +
                'organization from its staff detail page, or give out a code ' +
                'for customers to redeem at checkout. The net-margin rating ' +
                'warns before a discount eats the margin floor.'
              }
            </Alert>

            <CardDisplay
              header={'Create a coupon'}
              help={docsHelp('billing', {
                anchor: '#tiers--entitlements',
                excerpt:
                  'Create a percent or fixed-amount discount coupon, optionally with a redemption code, and see its net-margin rating before committing.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2} sx={{ maxWidth: 560 }}>
                <TextField
                  size="small"
                  label="Name (shown on the invoice)"
                  value={form.name}
                  onChange={(event) => update({ name: event.target.value })}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    select
                    size="small"
                    label="Type"
                    value={form.kind}
                    onChange={(event) =>
                      update({ kind: event.target.value as 'percent' | 'amount' })
                    }
                    sx={{ width: 160 }}
                  >
                    <MenuItem value="percent">{'Percent off'}</MenuItem>
                    <MenuItem value="amount">{'Fixed amount off'}</MenuItem>
                  </TextField>
                  {form.kind === 'percent' ? (
                    <TextField
                      size="small"
                      type="number"
                      label="Percent off"
                      value={form.percentOff}
                      onChange={(event) =>
                        update({ percentOff: event.target.value })
                      }
                      slotProps={{ htmlInput: { min: 1, max: 100 } }}
                      sx={{ flex: 1 }}
                    />
                  ) : (
                    <TextField
                      size="small"
                      type="number"
                      label="Amount off (USD)"
                      value={form.amountOffUsd}
                      onChange={(event) =>
                        update({ amountOffUsd: event.target.value })
                      }
                      slotProps={{ htmlInput: { min: 1 } }}
                      sx={{ flex: 1 }}
                    />
                  )}
                </Stack>
                <Stack direction="row" spacing={2}>
                  <TextField
                    select
                    size="small"
                    label="Duration"
                    value={form.duration}
                    onChange={(event) =>
                      update({
                        duration: event.target.value as typeof form.duration,
                      })
                    }
                    helperText={DURATION_HELP[form.duration]}
                    sx={{ flex: 1 }}
                  >
                    {COUPON_DURATIONS.map(({ value, label }) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {form.duration === 'repeating' ? (
                    <TextField
                      size="small"
                      type="number"
                      label="Months"
                      value={form.durationInMonths}
                      onChange={(event) =>
                        update({ durationInMonths: event.target.value })
                      }
                      slotProps={{ htmlInput: { min: 1 } }}
                      sx={{ width: 120 }}
                    />
                  ) : null}
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    size="small"
                    label="Redemption code (optional)"

                    placeholder="LAUNCH25"
                    value={form.code}
                    onChange={(event) =>
                      update({ code: event.target.value.toUpperCase() })
                    }
                    helperText="Give a code and customers can redeem it at checkout."
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Max redemptions"
                    value={form.maxRedemptions}
                    onChange={(event) =>
                      update({ maxRedemptions: event.target.value })
                    }
                    slotProps={{ htmlInput: { min: 1 } }}
                    sx={{ width: 160 }}
                  />
                </Stack>
                <TextField
                  size="small"
                  type="date"
                  label="Expires (optional)"
                  value={form.expiresAt}
                  onChange={(event) => update({ expiresAt: event.target.value })}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ width: 220 }}
                />

                {/* Live rating readout (AGL-1105, re-shaped AGL-1120). */}
                <Alert severity={RATING_COLOR[rating.rating] as any}>
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Chip
                        size="small"
                        color={RATING_COLOR[rating.rating] as any}
                        label={`Rating: ${rating.rating.toUpperCase()}`}
                      />
                      <Typography variant="body2">
                        {/* Lead with whatever actually bound. The old readout
                            always led with net margin, which is why a 93%
                            coupon could read "OK — net margin 78.1%": that
                            number was right, and it was answering a question
                            nobody was asking. */}
                        {rating.reason === 'depth'
                          ? `${(rating.depthPct * 100).toFixed(0)}% off list price`
                          : rating.reason === 'underwater'
                            ? 'This discount leaves nothing after fees'
                            : `Net margin ${(rating.marginPct * 100).toFixed(1)}% vs a ${(
                                rating.floorPct * 100
                              ).toFixed(0)}% floor`}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {`${(rating.depthPct * 100).toFixed(0)}% off list. ` +
                        `Illustrated on a Business subscription ($${rating.grossUsd}/mo, ` +
                        `1 site — the cheapest case to serve): discounted to ` +
                        `$${rating.discountedUsd}, keeps $${rating.netUsd} net of ` +
                        `processor fees, less $${rating.infraCogsUsd} infra.`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {/* A coupon created here can be applied to ANY org on
                          ANY plan with any number of sites, so this figure
                          describes a scenario that may never happen — and
                          1 site is the most generous one possible. */}
                      {'Illustrative only. The binding check runs against the ' +
                        'organization’s own plan, sites and measured usage when ' +
                        'the coupon is applied.'}
                    </Typography>
                    {/* AGL-1930 — say what the margin percentage above is a
                        margin ON. Nothing in the model costs support,
                        acquisition or overhead, and a staff member has no way
                        to know that from "Net margin 78.1%". */}
                    <Typography variant="caption" color="text.secondary">
                      {MARGIN_SCOPE_NOTE}
                    </Typography>
                  </Stack>
                </Alert>

                {/* The full-use warning (AGL-3473). A warning, not a gate:
                    a coupon that spends cost to close a deal is created all
                    the same, and this is what it spends. */}
                <Alert severity={fullUse.ok ? 'success' : 'warning'}>
                  <Stack spacing={0.5}>
                    <Typography variant="body2" sx={{ fontWeight: fullUse.ok ? undefined : 600 }}>
                      {fullUse.ok
                        ? 'Covers full-use cost on every paid plan.'
                        : `Under full-use cost on ${fullUse.under.length} of ` +
                          `${fullUse.cases.length} plan and billing combinations.`}
                    </Typography>
                    <Typography variant="body2">
                      {`Worst case ${describeDiscountFullUse(
                        fullUse.worst,
                        couponCaseLabel(fullUse.worst),
                      )}`}
                    </Typography>
                    {fullUse.ok ? null : (
                      <Typography variant="caption" color="text.secondary">
                        {`Under on: ${fullUse.under.join('; ')}.`}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {'A code can be redeemed on any paid plan, monthly or ' +
                        'annual, by a customer using everything the plan ' +
                        'includes. Judged on the charges the duration ' +
                        'reaches, after Stripe’s fee. ' +
                        (deepestPercent == null
                          ? 'A plan is under its full-use cost at list price, ' +
                            'so any discount spends cost on it.'
                          : `Every plan carries up to ${deepestPercent}% off ` +
                            'on every charge it reaches.')}
                    </Typography>
                  </Stack>
                </Alert>

                {needsApproval ? (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={form.confirmHighDiscount}
                        onChange={(event) =>
                          update({ confirmHighDiscount: event.target.checked })
                        }
                      />
                    }
                    label={
                      `I confirm this ${form.percentOff}% coupon (≥` +
                      `${DISCOUNT_APPROVAL_THRESHOLD_PCT}% needs sign-off)`
                    }
                  />
                ) : null}

                <Button
                  variant="contained"
                  disabled={busy || (needsApproval && !form.confirmHighDiscount)}
                  onClick={() => void create()}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {busy ? 'Creating…' : 'Create coupon'}
                </Button>
              </Stack>
            </CardDisplay>

            <CardDisplay
              header={'Existing coupons'}
              help={docsHelp('staffConsole', {
                anchor: '#existing-coupons',
                excerpt:
                  'Every Stripe coupon and its promotion codes, with redemption counts and validity.',
              })}
              contentGutterX
              contentGutterY
            >
              {noCouponsYet ? (
                <Typography variant="body2" color="text.secondary">
                  {'No coupons yet.'}
                </Typography>
              ) : (
                <>
                <Stack spacing={1}>
                <ListFilterChips
                  fields={COUPON_FILTER_FIELDS}
                  headers={COUPON_FILTER_HEADERS}
                  options={COUPON_FILTER_OPTIONS}
                  clauses={gridFilter.clauses}
                  onChange={gridFilter.setClauses}
                />
                <ListQueryNotices refused={couponRefusals} notices={couponList.notices} />
                <ListTable
                  aria-label="Existing coupons"
                  rows={couponList.rows}
                  columns={couponColumns}
                  loading={couponList.loading}
                  filterMode="server"
                  filterModel={gridFilter.filterModel}
                  onFilterModelChange={gridFilter.onFilterModelChange}
                  quickFilter
                  // A coupon lists one line per promotion code, so a row is
                  // as tall as its codes.
                  getRowHeight={() => 'auto'}
                  // The route answers one page at a time; the footer below
                  // walks the pages, and a header sort would order only one.
                  hideFooter
                  disableColumnSorting
                  noRowsLabel={
                    couponList.loading ? 'Loading coupons…' : 'No coupons match these filters'
                  }
                />
                </Stack>
                <StaffListPaginationControls pagination={couponList} />
                </>
              )}
            </CardDisplay>

            {/* Flipping a code is a revenue action in both directions — one
                way a discount stops being redeemable mid-campaign, the other
                way it becomes redeemable by anyone holding it — so it is
                confirmed rather than fired straight off the row. */}
            <Dialog
              open={Boolean(pendingToggle)}
              onClose={() => setPendingToggle(null)}
              maxWidth="xs"
              fullWidth
            >
              <DialogTitle>
                {`${pendingToggle?.activate ? 'Activate' : 'Deactivate'} ${
                  pendingToggle?.code ?? ''
                }`}
              </DialogTitle>
              <DialogContent>
                <DialogContentText variant="body2">
                  {pendingToggle?.activate
                    ? 'Customers will be able to redeem this code at checkout again.'
                    : 'Customers typing this code at checkout will be told it is not recognized. Existing discounts already applied to a subscription are unaffected.'}
                </DialogContentText>
                {toggleFullUse ? (
                  <Alert
                    severity={toggleFullUse.ok ? 'success' : 'warning'}
                    sx={{ mt: 1 }}
                  >
                    {toggleFullUse.warning ??
                      'Covers full-use cost on every paid plan. Worst case ' +
                        describeDiscountFullUse(
                          toggleFullUse.worst,
                          couponCaseLabel(toggleFullUse.worst),
                        )}
                  </Alert>
                ) : null}
                {toggleNeedsApproval ? (
                  <FormControlLabel
                    sx={{ mt: 1 }}
                    control={
                      <Checkbox
                        checked={toggleConfirmed}
                        onChange={(event) =>
                          setToggleConfirmed(event.target.checked)
                        }
                      />
                    }
                    label={
                      `I confirm this ${pendingToggle?.percentOff}% code (≥` +
                      `${DISCOUNT_APPROVAL_THRESHOLD_PCT}% needs sign-off)`
                    }
                  />
                ) : null}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setPendingToggle(null)}>
                  {'Cancel'}
                </Button>
                <Button
                  variant="contained"
                  color={pendingToggle?.activate ? 'primary' : 'error'}
                  disabled={busy || (toggleNeedsApproval && !toggleConfirmed)}
                  onClick={() => void toggleCode()}
                >
                  {busy
                    ? 'Saving…'
                    : pendingToggle?.activate
                      ? 'Activate'
                      : 'Deactivate'}
                </Button>
              </DialogActions>
            </Dialog>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminCoupons.displayName = 'Page:AdminCoupons'

export default AdminCoupons
