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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { isLiveSubscriptionStatus } from '@aglyn/aglyn'
import { overLimitSummary } from '../../utils/over-limit-summary'
import { type OrgPlan } from '@aglyn/aglyn'
import DataExportCard from '../data-export-card.component'
import { RetentionFunnelDialog } from '../billing/retention-funnel.dialog'
import { docsHelp } from '../../constants/docs-links'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgScope } from '../../hooks/use-org-scope'

/**
 * Self-serve organization deletion — owner-only (AGL-485).
 *
 * Extracted from the settings page when its sections became routes (AGL-693).
 * Sets the erasure flag; the hard delete runs through the guarded staff
 * pipeline after a seven-day hold and is cancelable until then.
 *
 * The retention funnel (AGL-1863) rides in front of it because deletion and
 * subscription cancel are the same departure — a churn breakdown counting only
 * one would understate churn by exactly the orgs that deleted instead.
 */
export function OrgDeleteCard() {
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  /*
   * Name to type in the delete confirmation (AGL-485). The org-scope
   * projection's `orgName` isn't always populated, so fall back to the org
   * doc name, then the slug — always something real to type.
   *
   * Gated on `orgReady`, because this string is not decoration: the reader
   * types it and the button compares against it. Before the org doc resolves
   * the fallback can differ from the name they are looking at, so the
   * confirmation would refuse the right answer — or, worse, accept a shorter
   * one. Empty until it is knowable, which the button already treats as
   * "cannot delete".
   */
  const orgDisplayName = orgReady
    ? (org as any)?.name || currentOrg?.orgName || currentOrg?.slug || ''
    : ''
  // the actual hard-delete runs via the guarded staff pipeline after the
  // 7-day hold and is cancelable until then.
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  // Account deletion shares the retention funnel with subscription cancel
  // (AGL-1863) — it is the same departure, and a churn breakdown that only
  // counted one of them would understate churn by exactly the orgs that
  // deleted instead of canceling.
  const [deleteFunnelOpen, setDeleteFunnelOpen] = useState(false)
  const deleteRequest = async (
    action: 'request' | 'cancel',
    funnelId?: string | null,
  ) => {
    const idToken = await (user as any)?.getIdToken?.()
    const response = await fetch('/api/orgs/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        orgId: currentOrg?.$id,
        action,
        ...(funnelId ? { funnelId } : {}),
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error ?? 'Request failed')
    }
    return response.json()
  }
  /**
   * Opens the funnel rather than the old single confirm. The type-the-org-name
   * gate in the Danger Zone still stands in front of this, so deletion keeps
   * BOTH guards — the funnel is added friction on the way out, not a
   * replacement for the one that was already there.
   */
  const handleRequestDeletion = async () => {
    if (!currentOrg || busy) return
    setDeleteFunnelOpen(true)
  }
  /** The funnel ran to the end and they still want the org gone. */
  const handleDeleteLeave = async (funnelId: string | null) => {
    setBusy(true)
    try {
      await deleteRequest('request', funnelId)
      setDeleteConfirmText('')
      enqueueSnackbar(
        'Deletion requested — your data is erased after a 7-day hold. ' +
          'Cancel here to keep the organization.',
        { variant: 'success' },
      )
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not request deletion', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }
  /**
   * The downsell, from the deletion path. Interval is deliberately absent —
   * the subscription route keeps the subscription's CURRENT interval when the
   * request does not state one, and this page has no billing toggle to read.
   */
  const handleDeleteDownsell = async (targetPlan: OrgPlan) => {
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId: currentOrg?.$id,
          action: 'switch',
          plan: targetPlan,
        }),
      })
      if (!response.ok) {
        enqueueSnackbar('Could not switch plans — nothing has changed.', {
          variant: 'warning',
        })
        return false
      }
      const payload = await response.json().catch(() => ({}))
      enqueueSnackbar(
        payload?.scheduled && payload?.effectiveAt
          ? `Moving to ${targetPlan} on ${new Date(
              payload.effectiveAt,
            ).toLocaleDateString()} — your organization stays put.`
          : `Switched to ${targetPlan} — your organization stays put.`,
        { variant: 'success' },
      )
      return true
    } finally {
      setBusy(false)
    }
  }
  const handleCancelDeletion = async () => {
    if (!currentOrg || busy) return
    setBusy(true)
    try {
      await deleteRequest('cancel')
      enqueueSnackbar('Deletion canceled — your organization is safe.', {
        variant: 'success',
      })
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not cancel deletion', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
  <Stack spacing={3}>
    {/* AGL-1974. This tab has told owners to "export anything you want
        to keep first" since it existed, and there was nothing to export
        with — one of six surfaces giving that instruction. The answer
        now sits in the same panel as the instruction. */}
    <DataExportCard user={user as never} orgId={currentOrg?.$id} />
    <CardDisplay
      header={'Delete organization'}
      help={docsHelp('downgradingAndCanceling', {
        anchor: '#deleting-your-organization',
      })}
      contentGutterX
      contentGutterY
    >
      {org?.erasureRequestedAt ? (
        <Stack spacing={2} sx={{ maxWidth: 480 }}>
          <Alert severity="warning">
            {'This organization is scheduled for deletion. After a ' +
              '7-day hold, all of its sites, files, and data are ' +
              'permanently erased. Cancel now to keep it.'}
          </Alert>
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void handleCancelDeletion()}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Cancel deletion'}
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ maxWidth: 480 }}>
          <Typography variant="body2" color="text.secondary">
            {'Permanently delete this organization and everything in ' +
              'it — sites, files, datasets, and members. Nothing is ' +
              'removed for 7 days and you can cancel, then erasure is ' +
              'irreversible and we keep no copy of it. Export ' +
              'anything you want to keep first.'}
          </Typography>
          <TextField
            label={`Type "${orgDisplayName}" to confirm`}
            value={deleteConfirmText}
            disabled={busy}
            onChange={(event) => setDeleteConfirmText(event.target.value)}
            size="small"
          />
          <Button
            color="error"
            variant="contained"
            disabled={
              busy ||
              !orgDisplayName ||
              deleteConfirmText.trim() !== orgDisplayName
            }
            onClick={() => void handleRequestDeletion()}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Delete organization'}
          </Button>
        </Stack>
      )}
    </CardDisplay>
  </Stack>
        {/* The deletion half of the leave path (AGL-1863). `orgReady` gates
            the subscription read: `undefined` while loading would answer "no
            subscription" and silently drop the downsell and winback steps
            for a paying org. */}
        <RetentionFunnelDialog
          open={deleteFunnelOpen}
          surface="account_delete"
          orgId={currentOrg?.$id ?? ''}
          subscriptionActive={
            orgReady &&
            isLiveSubscriptionStatus((org as any)?.subscription?.status)
          }
          currentPlan={org?.plan as OrgPlan | undefined}
          // The deletion downsell is the same plan change the Billing grid
          // warns about (AGL-2154), and it said nothing here. No host list is
          // loaded on this page, so the shared helper counts the sites itself
          // rather than this page mounting a live host listener to warn once.
          downsellImpact={(targetPlan) =>
            overLimitSummary({
              firestore,
              user: user as never,
              orgId: currentOrg?.$id,
              targetPlan,
            })
          }
          onClose={() => setDeleteFunnelOpen(false)}
          onDownsell={handleDeleteDownsell}
          onLeave={handleDeleteLeave}
        />
    </>
  )
}
OrgDeleteCard.displayName = 'OrgDeleteCard'

export default OrgDeleteCard
