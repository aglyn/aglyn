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
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
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
import {
  formatQuotaLimit,
  isUnlimitedQuota,
  restoreQuotaLimit,
} from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/** One site's row, as `/api/billing/collaborator-allocations` reports it. */
interface AllocationSite {
  hostId: string
  displayName: string | null
  /** Seats in use, through the counter the cap is ENFORCED with. */
  collaborators: number
  allocatedSeats: number
  /**
   * Plan cap + this site's allocated seats, clamped to the plan's band —
   * already rehydrated, so an uncapped plan is `UNLIMITED` here and not the
   * `null` the wire carried.
   */
  cap: number
  /** The route's explicit flag; `cap` is a placeholder `0` when true. */
  capUnlimited?: boolean
}

interface AllocationState {
  pool: {
    purchased: number
    allocated: number
    available: number
    byHost: Record<string, number>
  }
  /** The collaborator cap every site gets from the PLAN alone (AGL-2439). */
  planCapPerSite: number
  /** The route's explicit flag; `planCapPerSite` is `0` when true. */
  planCapPerSiteUnlimited?: boolean
  /** The plan's hard band; assigning past it cannot raise a site's cap. */
  maxCapPerSite: number
  /** The route's explicit flag; `maxCapPerSite` is `0` when true. */
  maxCapPerSiteUnlimited?: boolean
  sites: AllocationSite[]
}

/**
 * Put the `UNLIMITED` sentinel back where `JSON.stringify` flattened it.
 *
 * `UNLIMITED` is `Number.POSITIVE_INFINITY` and `JSON.stringify(Infinity)` is
 * `null`, so an Enterprise payload arrived with every cap nulled. The display
 * was the visible half; the COMPARISONS were the damaging half, because they
 * do not fail loudly — `1 > null` is TRUE, so a site with one collaborator on
 * an uncapped plan raised the grandfather notice ("1 over the limit and
 * kept") beneath a readout of "1/∞ collaborators", and `null >= null` is TRUE,
 * so the same row said it had hit "your plan's maximum of null per site —
 * upgrade instead" on the top plan.
 *
 * Rehydrating HERE, once, means every comparison below is ordinary arithmetic
 * that is simply correct (AGL-2482; AGL-2223 is the same class).
 */
function hydrate(payload: AllocationState): AllocationState {
  return {
    ...payload,
    planCapPerSite: restoreQuotaLimit(
      payload?.planCapPerSite,
      payload?.planCapPerSiteUnlimited,
    ),
    maxCapPerSite: restoreQuotaLimit(
      payload?.maxCapPerSite,
      payload?.maxCapPerSiteUnlimited,
    ),
    sites: (payload?.sites ?? []).map((site) => ({
      ...site,
      cap: restoreQuotaLimit(site?.cap, site?.capUnlimited),
    })),
  }
}

export interface BillingCollaboratorAllocationsCardProps {
  orgId?: string | null
  /** billing.manage: steppers enabled; view-only otherwise. */
  canManage: boolean
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Assign purchased COLLABORATOR seats to sites (AGL-2439).
 *
 * `seatAddons.members` is an org-level POOL since the 2026-08-19 decision:
 * one extra collaborator seat buys one site's worth of capacity, not one per
 * site. `/api/billing/collaborator-allocations` is the only writer of
 * `org.collaboratorAllocations`, and this card is its only caller — shipped in
 * the same pass on purpose. AGL-1947 is the counter-example: the register pool
 * shipped with a route nothing called, so a merchant could BUY seats and had
 * nowhere to deploy them, which is money taken for capacity the product gave
 * no way to use. A pool without an allocation surface is worse than the bug it
 * replaced.
 *
 * ## THE GRANDFATHER, stated where the customer can read it
 *
 * The corrected cap binds NEW collaborators only. A site already above its cap
 * keeps everyone on it — nothing in this product removes a collaborator for
 * being over a cap — and is merely refused the next add. That is the whole of
 * the migration posture, and this card says it in words rather than leaving
 * an admin to infer it from a site row that reads "3 over the limit".
 *
 * ## Why the server decides over-allocation
 *
 * The pool arithmetic is `purchased - sum(allocations)` and the route enforces
 * it on the write. This card deliberately does NOT disable the "+" at the last
 * seat and call that enforcement: a client-side guess off a payload that is
 * already seconds old would either block a legal assignment or permit an
 * illegal one, and the second shows the customer capacity enforcement then
 * refuses. The button stays live and the route's 409 — which names the
 * purchased count and what remains — is what the merchant reads.
 */
export default function BillingCollaboratorAllocationsCardComponent({
  orgId,
  canManage,
}: BillingCollaboratorAllocationsCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<AllocationState | null>(null)
  const [busyHostId, setBusyHostId] = useState<string | null>(null)
  /**
   * Three outcomes, not two (the AGL-1380 rule). "No collaborator seats
   * purchased" is a claim about this org's billing, and rendering it because
   * a request FAILED would tell a paying customer they own nothing.
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
      const response = await authorizedFetch(
        user,
        '/api/billing/collaborator-allocations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, ...body }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        // The route's own answer, verbatim. Its 409 already names the
        // purchased count and what is unassigned, and its 403/404 are more
        // specific than anything this card could invent.
        enqueueSnackbar(payload?.error ?? 'Collaborator seat request failed', {
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
        setState(hydrate(outcome.payload as AllocationState))
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
      // Predicted from the counts the `get` returned: collaborators on this
      // site, against the cap it would have after the move. The band clamp is
      // applied here too, or the prediction would promise headroom the plan
      // does not sell.
      const nextCap = Math.min(
        state.planCapPerSite + seats,
        state.maxCapPerSite,
      )
      const strandPrediction = Math.max(0, site.collaborators - nextCap)
      if (strandPrediction > 0) {
        // The loading overlay must drop BEFORE the confirm dialog opens — it
        // sits above the dialog and swallows the Confirm click (AGL-535).
        const accepted = await confirm({
          title: `Leave ${plural(strandPrediction, 'collaborator', 'collaborators')} over the limit?`,
          description:
            `${site.displayName ?? site.hostId} has ` +
            `${plural(site.collaborators, 'collaborator', 'collaborators')}. ` +
            `With ${plural(seats, 'seat', 'seats')} assigned its limit is ` +
            `${nextCap}. Everyone keeps their access — nobody is removed and ` +
            'nobody is signed out. The site just cannot take on another ' +
            'collaborator until it is back under the limit.',
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
        const stranded = Number(outcome.payload?.strandedCollaborators ?? 0)
        enqueueSnackbar(
          stranded > 0
            ? `Saved — ${site.displayName ?? site.hostId} is ` +
              `${plural(stranded, 'collaborator', 'collaborators')} over its ` +
              'limit. Everyone keeps access; no new ones can be added.'
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
        enqueueSnackbar('Could not update collaborator seats', {
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
        Loading collaborator seats…
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
        We couldn’t load your collaborator seats. Nothing has changed.
      </Alert>
    )
  }

  const { pool, planCapPerSite, maxCapPerSite, sites } = state
  // `site.cap` is rehydrated, so an uncapped site compares as
  // `collaborators > Infinity` — false. Against the raw wire value it was
  // `collaborators > null`, which is TRUE for any count above zero: the
  // grandfather notice fired on Enterprise sites that were not over anything.
  const overCapSites = sites.filter((site) => site.collaborators > site.cap)

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

      {/*
        THE GRANDFATHER NOTICE. Only shown when it applies to a real site, so
        it is never an abstract warning — and worded as retention, because the
        one thing an admin must not conclude from "over the limit" is that
        somebody lost access.
      */}
      {overCapSites.length > 0 ? (
        <Alert severity="info">
          {overCapSites.length === 1
            ? `${overCapSites[0].displayName ?? overCapSites[0].hostId} has more collaborators than its limit.`
            : `${overCapSites.length} of your sites have more collaborators than their limit.`}{' '}
          <strong>Everyone keeps their access.</strong> Nobody is removed and
          nobody is signed out. A site over its limit just can’t take on
          another collaborator until it’s back under — assign it a seat below,
          or remove a collaborator you no longer need.
        </Alert>
      ) : null}

      {pool.purchased === 0 ? (
        <Alert severity="info">
          You haven’t bought any extra collaborator seats yet. Every site can
          have{' '}
          {isUnlimitedQuota(planCapPerSite)
            ? 'as many collaborators as it needs'
            : plural(planCapPerSite, 'collaborator', 'collaborators')}{' '}
          on your current plan. Add collaborator seats under{' '}
          <strong>Plan add-ons</strong> above, then assign them to a site here.
        </Alert>
      ) : pool.available === 0 ? (
        <Alert severity="info">
          Every purchased seat is assigned. To give a site another
          collaborator, move a seat off another site below, or buy another
          under <strong>Plan add-ons</strong> above.
        </Alert>
      ) : null}

      {sites.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          You don’t have any sites yet. Collaborator seats can be assigned once
          you create one — they stay in the pool until then.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {sites.map((site) => {
            const busy = busyHostId === site.hostId
            // An uncapped site is never "at the band": `Infinity >= Infinity`
            // is true and so was `null >= null` before rehydration, which put
            // "At your plan's maximum — upgrade instead" on the plan there is
            // nothing above. A band only binds when there is a number to hit.
            const atBand =
              !isUnlimitedQuota(site.cap) &&
              !isUnlimitedQuota(maxCapPerSite) &&
              site.cap >= maxCapPerSite
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
                  {/*
                    The shared readout, so this row and every per-site quota
                    line in the console say the number the same way. `ready` is
                    true because the payload IS the resolved plan — this card
                    renders nothing until the route has answered.
                  */}
                  <QuotaReadoutComponent
                    ready
                    used={site.collaborators}
                    limit={site.cap}
                    noun="collaborator"
                    period="on this site"
                  />
                  {site.collaborators > site.cap ? (
                    <Typography variant="caption" color="text.secondary">
                      {`${site.collaborators - site.cap} over the limit and kept — no new ones until it’s back under`}
                    </Typography>
                  ) : atBand ? (
                    <Typography variant="caption" color="text.secondary">
                      {`At your plan’s maximum of ${formatQuotaLimit(maxCapPerSite)} per site — more seats can’t raise it, upgrade instead`}
                    </Typography>
                  ) : null}
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <IconButton
                    size="small"
                    aria-label={`Remove a collaborator seat from ${
                      site.displayName ?? site.hostId
                    }`}
                    disabled={!canManage || busy || site.allocatedSeats === 0}
                    onClick={() => applySeats(site, site.allocatedSeats - 1)}
                  >
                    <RemoveRoundedIcon fontSize="small" />
                  </IconButton>
                  <Typography
                    variant="body2"
                    sx={{ minWidth: '1.5rem', textAlign: 'center' }}
                  >
                    {site.allocatedSeats}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={`Assign a collaborator seat to ${
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
          You need the Manage billing permission to move collaborator seats.
        </Typography>
      ) : null}
    </Stack>
  )
}
