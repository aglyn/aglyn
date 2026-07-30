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
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import StaffOnly from '../../../../components/staff-only.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
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

/**
 * A representative paying subscription for the live rating readout — a
 * typical Business customer on a single site. The rating on the creation page
 * is a "what would this do to a normal customer" preview; the real per-org
 * check runs when staff apply the coupon on an organization.
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

  const refresh = useCallback(async () => {
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken) return
    setLoading(true)
    try {
      const response = await fetch('/api/admin/coupons', {
        headers: { Authorization: `Bearer ${idToken}` },
      })
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
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken) return
    setBusy(true)
    try {
      const response = await fetch('/api/admin/coupons', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
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

  const discountLabel = (row: CouponRow) =>
    row.percentOff != null
      ? `${row.percentOff}% off`
      : row.amountOffUsd != null
        ? `$${row.amountOffUsd} off`
        : '—'

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_ORGS) },
        { children: 'Coupons', href: buildRoute(Route.ADMIN_COUPONS) },
      ]}
      help="billing"
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
                    <MenuItem value="once">{'Once'}</MenuItem>
                    <MenuItem value="repeating">{'Repeating'}</MenuItem>
                    <MenuItem value="forever">{'Forever'}</MenuItem>
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

                {/* Live net-margin rating readout (AGL-1105). */}
                <Alert severity={RATING_COLOR[rating.rating] as any}>
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Chip
                        size="small"
                        color={RATING_COLOR[rating.rating] as any}
                        label={`Rating: ${rating.rating.toUpperCase()}`}
                      />
                      <Typography variant="body2">
                        {`Net margin ${(rating.marginPct * 100).toFixed(1)}% vs a ${(
                          rating.floorPct * 100
                        ).toFixed(0)}% floor`}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {`On a typical Business subscription ($${rating.grossUsd}/mo, 1 site): ` +
                        `discounted to $${rating.discountedUsd}, keeps $${rating.netUsd} ` +
                        `net of processor fees, less $${rating.infraCogsUsd} infra.`}
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
              help={docsHelp('billing', {
                anchor: '#tiers--entitlements',
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
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Coupon'}</TableCell>
                      <TableCell>{'Discount'}</TableCell>
                      <TableCell>{'Duration'}</TableCell>
                      <TableCell>{'Codes'}</TableCell>
                      <TableCell align="right">{'Redeemed'}</TableCell>
                      <TableCell>{'Status'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {coupons.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Stack spacing={0.25}>
                            <Typography variant="body2">
                              {row.name ?? row.id}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontFamily: 'monospace' }}
                            >
                              {row.id}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{discountLabel(row)}</TableCell>
                        <TableCell>
                          {row.duration === 'repeating'
                            ? `${row.durationInMonths}mo`
                            : (row.duration ?? '—')}
                        </TableCell>
                        <TableCell>
                          {row.codes.length === 0 ? (
                            <Typography variant="caption" color="text.secondary">
                              {'—'}
                            </Typography>
                          ) : (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              sx={{ flexWrap: 'wrap' }}
                            >
                              {row.codes.map((code) => (
                                <Chip
                                  key={code.id}
                                  size="small"
                                  variant="outlined"
                                  label={code.code}
                                  color={code.active ? 'default' : 'error'}
                                />
                              ))}
                            </Stack>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {row.maxRedemptions
                            ? `${row.timesRedeemed}/${row.maxRedemptions}`
                            : row.timesRedeemed}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={row.valid ? 'valid' : 'expired'}
                            color={row.valid ? 'success' : 'default'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminCoupons.displayName = 'Page:AdminCoupons'

export default AdminCoupons
