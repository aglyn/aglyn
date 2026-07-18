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
  IconButton,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

/**
 * Human labels for `org.seatAddons` kinds — shared with the current-plan
 * card's add-on caption.
 */
export const ADDON_LABELS: Record<string, string> = {
  managers: 'manager seats',
  members: 'member seats',
  datasets: 'extra datasets',
  hosts: 'extra sites',
  posRegisters: 'POS registers',
  eventCalendar: 'Event Calendar',
}

interface AddonRow {
  kind: string
  label: string
  description: string
  /** Quantity toggle (0/1) rendered as a switch instead of a stepper. */
  toggle?: boolean
}

const ADDON_ROWS: readonly AddonRow[] = [
  {
    kind: 'managers',
    label: 'Manager seats',
    description: 'Workspace manager seats beyond the ones your plan includes.',
  },
  {
    kind: 'members',
    label: 'Member seats',
    description: 'Site member seats beyond the included count, per site.',
  },
  {
    kind: 'datasets',
    label: 'Extra datasets',
    description: 'Additional shared datasets across your workspace.',
  },
  {
    kind: 'hosts',
    label: 'Extra sites',
    description: 'Publish more sites than your plan includes.',
  },
  {
    kind: 'posRegisters',
    label: 'POS registers',
    description: 'Additional point-of-sale registers/locations.',
  },
  {
    kind: 'eventCalendar',
    label: 'Event Calendar',
    description:
      'The Event Calendar add-on for your whole workspace, supported ' +
      'directly by Aglyn.',
    toggle: true,
  },
]

interface AddonsCatalogEntry {
  unitUsd: number | null
  max: number
  configured: boolean
  upgradeRequired: boolean
}

interface AddonsState {
  hasSubscription: boolean
  plan: string
  interval: 'month' | 'year'
  quantities: Record<string, number>
  catalog: Record<string, AddonsCatalogEntry>
}

export interface BillingAddonsCardProps {
  orgId?: string | null
  /** billing.manage: steppers enabled; view-only otherwise. */
  canManage: boolean
}

/**
 * Self-serve add-on management (AGL-529): quantities per add-on kind on
 * the org's subscription, applied through /api/billing/addons with a
 * proration preview + confirm before every change. Renders an upgrade
 * prompt for orgs without a live subscription — add-ons bill on it.
 */
export default function BillingAddonsCardComponent({
  orgId,
  canManage,
}: BillingAddonsCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<AddonsState | null>(null)
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const addonsRequest = useCallback(
    async (body: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/addons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 501) {
        enqueueSnackbar(
          'Billing is not configured yet — Stripe keys are pending.',
          { variant: 'info', persist: false },
        )
        return null
      }
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Add-on request failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    },
    [user, orgId, enqueueSnackbar],
  )

  useEffect(() => {
    if (!orgId || !user) return
    let cancelled = false
    void addonsRequest({ action: 'get' }).then((payload) => {
      if (!cancelled && payload) {
        setState(payload as AddonsState)
        setDrafts({})
      }
    })
    return () => {
      cancelled = true
    }
  }, [orgId, user, addonsRequest])

  const applyChange = useCallback(
    async (row: AddonRow, quantity: number) => {
      if (!state) return
      setBusy(true)
      try {
        // The loading overlay must drop BEFORE the confirm dialog opens —
        // it sits above the dialog and swallows the Confirm click
        // (AGL-535); handleUpgrade on the page dequeues the same way.
        const dequeuePreview = queueLoading()
        let preview: any
        try {
          preview = await addonsRequest({
            action: 'preview',
            kind: row.kind,
            quantity,
          })
        } finally {
          dequeuePreview()
        }
        if (!preview) return
        const unitUsd = state.catalog[row.kind]?.unitUsd ?? 0
        const monthlyUsd = quantity * (unitUsd ?? 0)
        // The true cost of this change: proration lines only (AGL-535) —
        // upcoming.amount_due is the whole next invoice, and nothing is
        // charged today with create_prorations.
        const prorationCents = Number(
          preview.prorationCents ?? preview.amountDueCents ?? 0,
        )
        const currency = String(preview.currency ?? 'usd').toUpperCase()
        const prorationUsd = (Math.abs(prorationCents) / 100).toFixed(2)
        const accepted = await confirm({
          title: `${row.label}: ${quantity}?`,
          description:
            (prorationCents >= 0
              ? `Prorated for the rest of this period: $${prorationUsd} ` +
                `${currency}, billed on your next invoice. Ongoing: `
              : `Unused time credits $${prorationUsd} ${currency} back ` +
                'on your next invoice. Ongoing: ') +
            (quantity === 0
              ? 'nothing — this add-on is removed.'
              : `$${monthlyUsd}/mo` +
                (state.interval === 'year'
                  ? ` (billed yearly with your plan)`
                  : '') +
                '.'),
          confirmationText: 'Confirm change',
        })
          .then(() => true)
          .catch(() => false)
        if (!accepted) return
        const dequeueSet = queueLoading()
        try {
          const applied = await addonsRequest({
            action: 'set',
            kind: row.kind,
            quantity,
          })
          if (applied?.quantities) {
            setState((previous) =>
              previous
                ? { ...previous, quantities: applied.quantities }
                : previous)
            setDrafts((previous) => {
              const next = { ...previous }
              delete next[row.kind]
              return next
            })
            enqueueSnackbar(`${row.label} updated`, {
              variant: 'success',
              persist: false,
            })
          }
        } finally {
          dequeueSet()
        }
      } finally {
        setBusy(false)
      }
    },
    [state, addonsRequest, confirm, queueLoading, enqueueSnackbar],
  )

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Add-ons appear here once billing is configured.'}
      </Typography>
    )
  }

  if (!state.hasSubscription) {
    return (
      <Alert severity="info">
        {'Add-ons bill on your plan subscription — pick a plan below ' +
          'first, then add seats, sites, datasets and more here.'}
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      {ADDON_ROWS.map((row) => {
        const entry = state.catalog[row.kind]
        const current = state.quantities[row.kind] ?? 0
        const draft = drafts[row.kind] ?? current
        const purchasable = Boolean(entry) &&
          !entry.upgradeRequired &&
          entry.configured
        const changed = draft !== current
        return (
          <Stack
            key={row.kind}
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
          >
            <Box sx={{ flex: 1, minWidth: 220 }}>
              <Typography variant="subtitle2">
                {row.label}
                {entry?.unitUsd != null
                  ? ` — $${entry.unitUsd}/mo${row.toggle ? '' : ' each'}`
                  : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.description}
              </Typography>
            </Box>
            {!purchasable ? (
              <Typography variant="caption" color="text.secondary">
                {entry?.upgradeRequired
                  ? 'Upgrade your plan to add these'
                  : 'Not configured'}
              </Typography>
            ) : row.toggle ? (
              <Switch
                checked={draft >= 1}
                disabled={!canManage || busy}
                onChange={(event) =>
                  void applyChange(row, event.target.checked ? 1 : 0)}
              />
            ) : (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <IconButton
                  size="small"
                  aria-label={`Remove one ${row.label}`}
                  disabled={!canManage || busy || draft <= 0}
                  onClick={() =>
                    setDrafts((previous) => ({
                      ...previous,
                      [row.kind]: Math.max(0, draft - 1),
                    }))}
                >
                  <RemoveRoundedIcon fontSize="inherit" />
                </IconButton>
                <Typography
                  variant="subtitle2"
                  sx={{ minWidth: 24, textAlign: 'center' }}
                >
                  {draft}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={`Add one ${row.label}`}
                  disabled={!canManage || busy || draft >= entry.max}
                  onClick={() =>
                    setDrafts((previous) => ({
                      ...previous,
                      [row.kind]: Math.min(entry.max, draft + 1),
                    }))}
                >
                  <AddRoundedIcon fontSize="inherit" />
                </IconButton>
                {changed ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    disabled={!canManage || busy}
                    onClick={() => void applyChange(row, draft)}
                  >
                    {draft === 0 ? 'Remove' : 'Apply'}
                  </Button>
                ) : null}
              </Stack>
            )}
          </Stack>
        )
      })}
      <Typography variant="caption" color="text.secondary">
        {'Changes prorate onto your current billing period. Seat and ' +
          'dataset add-ons stop at your plan\'s hard cap — beyond it, ' +
          'upgrade the plan instead.'}
      </Typography>
    </Stack>
  )
}
