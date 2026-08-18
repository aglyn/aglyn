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

import { useConfirmationContext, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

/** One site's row, as `/api/billing/register-allocations` reports it. */
interface AllocationSite {
  hostId: string
  displayName: string | null
  /** Live register count from a SERVER aggregate, not a listener. */
  registers: number
  allocatedSeats: number
  /** Plan cap + this site's allocated seats. */
  cap: number
}

interface AllocationState {
  pool: {
    purchased: number
    allocated: number
    available: number
    byHost: Record<string, number>
  }
  /** The register cap every site gets from the PLAN alone (AGL-1775). */
  planCapPerSite: number
  sites: AllocationSite[]
}

export interface BillingRegisterAllocationsCardProps {
  orgId?: string | null
  /** billing.manage: steppers enabled; view-only otherwise. */
  canManage: boolean
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Assign purchased POS register seats to sites (AGL-1947, for AGL-1775).
 *
 * `seatAddons.posRegisters` is an org-level POOL since Zach's 2026-08-17
 * decision: $89/mo buys one register's worth of entitlement, not one per
 * site. `/api/billing/register-allocations` is the only writer of
 * `org.registerAllocations`, and until this card existed it had no caller at
 * all — a merchant could BUY register seats and had nowhere to deploy them,
 * which is money taken for capacity the product gave no way to use.
 *
 * ## Why the server decides over-allocation
 *
 * The pool arithmetic is `purchased - sum(allocations)`, and the route
 * enforces it on the write. This card deliberately does NOT disable the "+"
 * at the last seat and call that enforcement: a client-side guess computed
 * off a payload that is already a few seconds old would either block a legal
 * assignment or permit an illegal one, and the second is the one that shows
 * the customer capacity the enforcement then refuses. So the button stays
 * live, the request goes, and the route's own 409 — which names the purchased
 * count and what remains — is what the merchant reads.
 *
 * ## Why stranding is a confirm and not a refusal
 *
 * Taking a seat off a site that is USING it leaves live registers over the
 * cap. They keep existing; `pos-order.ts` refuses to sell through them by
 * creation rank. That is recoverable and reversible, so the route treats it
 * as a warning — but the person moving the seat should hear it BEFORE the
 * move, not from a cashier with a customer standing in front of them. The
 * prediction is made here from the counts the `get` already returned, and the
 * route's own `strandedRegisters` is reported after the write as the
 * authoritative number.
 */
export default function BillingRegisterAllocationsCardComponent({
  orgId,
  canManage,
}: BillingRegisterAllocationsCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<AllocationState | null>(null)
  const [busyHostId, setBusyHostId] = useState<string | null>(null)
  /**
   * Three outcomes, not two (the AGL-1380 rule). "No register seats
   * purchased" is a claim about this org's billing, and rendering it because
   * a request FAILED would tell a paying merchant they own nothing.
   */
  const [loadState, setLoadState] = useState<'pending' | 'error' | 'loaded'>(
    'pending',
  )
  /** Bumped by Retry to re-run the load effect. */
  const [retryNonce, setRetryNonce] = useState(0)

  const sendRequest = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<{ ok: boolean; payload?: any }> => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/register-allocations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        // The route's own answer, verbatim. Its 409 already names the
        // purchased count and what is unassigned, and its 403/404 are more
        // specific than anything this card could invent.
        enqueueSnackbar(payload?.error ?? 'Register seat request failed', {
          variant: 'warning',
          persist: false,
        })
        return { ok: false, payload }
      }
      return { ok: true, payload }
    },
    [user, orgId, enqueueSnackbar],
  )

  useEffect(() => {
    if (!orgId || !user) return
    let cancelled = false
    setLoadState('pending')
    sendRequest({ action: 'get' })
      .then((outcome) => {
        if (cancelled) return
        if (!outcome.ok) return void setLoadState('error')
        setState(outcome.payload as AllocationState)
        setLoadState('loaded')
      })
      // A rejected fetch — offline, a wedged route — never reached the
      // snackbar inside the request, so this is the only place it can become
      // something the card renders.
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [orgId, user, sendRequest, retryNonce])

  const applySeats = useCallback(
    async (site: AllocationSite, seats: number) => {
      if (!state || seats < 0) return
      // Predicted from the counts the `get` returned: registers this site is
      // running, against the cap it would have after the move.
      const strandPrediction = Math.max(
        0,
        site.registers - (state.planCapPerSite + seats),
      )
      if (strandPrediction > 0) {
        // The loading overlay must drop BEFORE the confirm dialog opens — it
        // sits above the dialog and swallows the Confirm click (AGL-535).
        const accepted = await confirm({
          title: `Leave ${plural(strandPrediction, 'register', 'registers')} over the limit?`,
          description:
            `${site.displayName ?? site.hostId} is running ` +
            `${plural(site.registers, 'register', 'registers')}. With ` +
            `${plural(seats, 'seat', 'seats')} assigned it can run ` +
            `${state.planCapPerSite + seats}. The extra ` +
            `${strandPrediction === 1 ? 'register' : 'registers'} will stay ` +
            'set up but cannot take sales until you assign the seats back or ' +
            'remove them. Nothing is deleted.',
          confirmationText: 'Move the seat',
        })
          .then(() => true)
          .catch(() => false)
        if (!accepted) return
      }

      setBusyHostId(site.hostId)
      const dequeue = queueLoading()
      try {
        const outcome = await sendRequest({
          action: 'set',
          hostId: site.hostId,
          seats,
        })
        if (!outcome.ok) return
        const stranded = Number(outcome.payload?.strandedRegisters ?? 0)
        enqueueSnackbar(
          stranded > 0
            ? `Saved — ${plural(stranded, 'register', 'registers')} on ` +
              `${site.displayName ?? site.hostId} cannot take sales until ` +
              'seats are assigned back.'
            : seats > 0
              ? `${site.displayName ?? site.hostId}: ${plural(seats, 'seat', 'seats')} assigned.`
              : `${site.displayName ?? site.hostId}: seats returned to the pool.`,
          { variant: stranded > 0 ? 'warning' : 'success', persist: false },
        )
        // Re-read rather than patching local state: the route re-derives the
        // pool through the same clamping resolver enforcement uses, and a
        // locally-computed pool is exactly the second source of truth this
        // model exists to avoid.
        setRetryNonce((nonce) => nonce + 1)
      } catch {
        enqueueSnackbar('Could not update register seats', {
          variant: 'warning',
          persist: false,
        })
      } finally {
        dequeue()
        setBusyHostId(null)
      }
    },
    [state, confirm, queueLoading, sendRequest, enqueueSnackbar],
  )

  if (loadState === 'pending') {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading register seats…
      </Typography>
    )
  }

  if (loadState === 'error' || !state) {
    return (
      <Alert
        severity="warning"
        action={
          <Button
            size="small"
            color="inherit"
            onClick={() => setRetryNonce((nonce) => nonce + 1)}
          >
            Retry
          </Button>
        }
      >
        We couldn’t load your register seats. Nothing has changed.
      </Alert>
    )
  }

  const { pool, planCapPerSite, sites } = state

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip label={`${pool.purchased} purchased`} size="small" />
        <Chip label={`${pool.allocated} assigned`} size="small" />
        <Chip
          label={`${pool.available} unassigned`}
          size="small"
          color={pool.available > 0 ? 'primary' : 'default'}
        />
      </Stack>

      {pool.purchased === 0 ? (
        <Alert severity="info">
          You haven’t bought any POS register seats yet. Every site can run{' '}
          {plural(planCapPerSite, 'register', 'registers')} on your current
          plan. Add register seats under <strong>Plan add-ons</strong> above
          ($89/mo each), then assign them to a site here.
        </Alert>
      ) : pool.available === 0 ? (
        <Alert severity="info">
          Every purchased seat is assigned. To give a site another register,
          move a seat off another site below, or buy another under{' '}
          <strong>Plan add-ons</strong> above.
        </Alert>
      ) : null}

      {sites.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          You don’t have any sites yet. Register seats can be assigned once you
          publish one — they stay in the pool until then.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {sites.map((site) => {
            const busy = busyHostId === site.hostId
            return (
              <Stack
                key={site.hostId}
                direction="row"
                spacing={2}
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  rowGap: 1,
                }}
              >
                <Box sx={{ minWidth: 0, flex: '1 1 16rem' }}>
                  <Typography variant="body2" noWrap>
                    {site.displayName ?? site.hostId}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {plural(site.registers, 'register', 'registers')} running ·
                    can run {site.cap}
                    {site.registers > site.cap
                      ? ` · ${site.registers - site.cap} over the limit`
                      : ''}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <IconButton
                    size="small"
                    aria-label={`Remove a register seat from ${
                      site.displayName ?? site.hostId
                    }`}
                    disabled={!canManage || busy || site.allocatedSeats === 0}
                    onClick={() => applySeats(site, site.allocatedSeats - 1)}
                  >
                    <RemoveRoundedIcon fontSize="small" />
                  </IconButton>
                  <Typography variant="body2" sx={{ minWidth: '1.5rem', textAlign: 'center' }}>
                    {site.allocatedSeats}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={`Assign a register seat to ${
                      site.displayName ?? site.hostId
                    }`}
                    // Never disabled on the pool being empty: the route owns
                    // that refusal and answers with the real numbers.
                    disabled={!canManage || busy}
                    onClick={() => applySeats(site, site.allocatedSeats + 1)}
                  >
                    <AddRoundedIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
            )
          })}
        </Stack>
      )}

      {!canManage ? (
        <Typography variant="caption" color="text.secondary">
          You need the Manage billing permission to move register seats.
        </Typography>
      ) : null}
    </Stack>
  )
}
