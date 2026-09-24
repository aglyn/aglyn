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
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { inMemoryListField } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
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
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import StaffOnly from '../../../../components/staff-only.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import {
  CONTENT_MAX_WIDTH,
  TABLE_PAGE_SIZE_DEFAULT,
} from '../../../../constants/shared'
import { useIsStaff } from '../../../../hooks/use-is-staff'

interface CouponRow {
  id: string
  name: string | null
  percentOff: number | null
  amountOffUsd: number | null
  duration: string | null
  durationInMonths: number | null
  maxRedemptions: number | null
  timesRedeemed: number
  redeemBy: string | null
  valid: boolean
  codes: Array<{ id: string; code: string; active: boolean; timesRedeemed: number }>
}

/** A Stripe coupon's durations, as the create form offers them. */
const COUPON_DURATIONS = [
  { value: 'once', label: 'Once' },
  { value: 'repeating', label: 'Repeating' },
  { value: 'forever', label: 'Forever' },
] as const

/** A coupon row as the list matches it: the fields the panel reads, derived. */
type CouponListRow = CouponRow & {
  $id: string
  status: 'valid' | 'expired'
  codeText: string[]
}

/*
 * What the coupons grid filters and searches by. The list holds every coupon
 * one `/api/admin/coupons` read returned and pages them itself, so both
 * answer over all of them before a page is sliced.
 */
const COUPON_FILTER_FIELDS = [
  inMemoryListField('name', 'text'),
  inMemoryListField('duration', 'select'),
  inMemoryListField('status', 'select'),
  inMemoryListField('timesRedeemed', 'number'),
]
const COUPON_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Coupon',
  duration: 'Duration',
  status: 'Status',
  timesRedeemed: 'Redeemed',
}
const COUPON_FILTER_OPTIONS = {
  duration: COUPON_DURATIONS.map(({ value, label }) => ({ value, label })),
  status: [
    { value: 'valid', label: 'Valid' },
    { value: 'expired', label: 'Expired' },
  ],
}
const COUPON_SEARCH_PATHS = ['name', 'id', 'codeText']

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

  const [coupons, setCoupons] = useState<CouponRow[]>([])
  /*
   * The list PAGES (AGL-2501). Every Stripe coupon the platform has ever
   * created rendered in one wall, and a coupon row is tall — a name, an id, a
   * chip per promotion code — so a few dozen of them is a page a reader
   * scrolls past rather than reads.
   *
   * The rows are already in memory (one `/api/admin/coupons` fetch), so the
   * footer is handed a real total rather than the "more than 10" a cursor
   * feed has to settle for.
   */
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [loading, setLoading] = useState(true)
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authorizedFetch(user, '/api/admin/coupons')
      if (response.status === 501) {
        setCoupons([])
        return
      }
      if (!response.ok) throw new Error(`Load failed (${response.status})`)
      const payload = await response.json()
      setCoupons(payload.coupons ?? [])
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Loading coupons failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [user, enqueueSnackbar])

  useEffect(() => {
    if (isStaff) void refresh()
  }, [isStaff, refresh])

  // Live rating (AGL-1105): rate the proposed discount against a typical
  // Business subscription so staff see the margin impact as they type.
  const rating = useMemo(() => {
    const discount =
      form.kind === 'percent'
        ? { percentOff: Number(form.percentOff) || 0 }
        : { amountOffUsd: Number(form.amountOffUsd) || 0 }
    return checkDiscountMargin(REFERENCE_ORG as any, discount)
  }, [form.kind, form.percentOff, form.amountOffUsd])

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
      update({ code: '', name: '', confirmHighDiscount: false })
      await refresh()
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
      setPendingToggle(null)
      await refresh()
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Updating the code failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const couponRows = useMemo<CouponListRow[]>(
    () =>
      coupons.map((row) => ({
        ...row,
        $id: row.id,
        status: row.valid ? 'valid' : 'expired',
        codeText: row.codes.map((code) => code.code),
      })),
    [coupons],
  )
  const couponFilter = useListRowsFilter({
    rows: couponRows,
    fields: COUPON_FILTER_FIELDS,
    options: COUPON_FILTER_OPTIONS,
    headers: COUPON_FILTER_HEADERS,
    search: COUPON_SEARCH_PATHS,
  })
  const filteredCoupons = couponFilter.rows
  const pagedCoupons = useMemo(
    () => filteredCoupons.slice(page * pageSize, page * pageSize + pageSize),
    [filteredCoupons, page, pageSize],
  )
  // A refresh that returns fewer coupons, or a filter that narrows them, can
  // strand a reader past the last page, which MUI renders as an empty table
  // with no explanation.
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(filteredCoupons.length / pageSize) - 1)
    if (page > lastPage) setPage(lastPage)
  }, [filteredCoupons.length, page, pageSize])

  const discountLabel = (row: Pick<CouponRow, 'percentOff' | 'amountOffUsd'>) =>
    row.percentOff != null
      ? `${row.percentOff}% off`
      : row.amountOffUsd != null
        ? `$${row.amountOffUsd} off`
        : '—'

  const couponColumns = useMemo(() => couponFilter.filterColumns([
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
  ] as GridColDef<CouponListRow>[] as GridColDef[]),
  // `discountLabel` reads nothing from the component's state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [couponFilter.filterColumns, busy, openToggle])

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
                    sx={{ width: 160 }}
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
                <Stack direction="row" spacing={2}>
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
              header={`Existing coupons (${coupons.length})`}
              help={docsHelp('staffConsole', {
                anchor: '#existing-coupons',
                excerpt:
                  'Every Stripe coupon and its promotion codes, with redemption counts and validity.',
              })}
              contentGutterX
              contentGutterY
            >
              {loading && coupons.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'Loading coupons…'}
                </Typography>
              ) : coupons.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'No coupons yet.'}
                </Typography>
              ) : (
                <>
                <Stack spacing={1}>
                <ListFilterChips {...couponFilter.chipsProps} />
                <ListTable
                  aria-label="Existing coupons"
                  rows={pagedCoupons}
                  columns={couponColumns}
                  {...couponFilter.gridProps}
                  // A coupon lists one line per promotion code, so a row is
                  // as tall as its codes.
                  getRowHeight={() => 'auto'}
                  // Every coupon is held and paged by the footer below, so
                  // the grid draws the page it is handed and slices nothing.
                  hideFooter
                  noRowsLabel="No coupons match these filters"
                />
                </Stack>
                <ListPagination
                  page={page}
                  pageSize={pageSize}
                  rowCount={pagedCoupons.length}
                  count={filteredCoupons.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
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
