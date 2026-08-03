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
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import {
  timestampMs,
  VERIFICATION_DECLINE_COOLDOWN_DAYS,
  verificationRequestBlock,
  type VerifiableListing,
} from '@aglyn/aglyn/app-utils/marketplace-verification'
import { docsHelp } from '../../constants/docs-links'

export interface ListingVerificationRequestProps {
  listingId: string
  listing: VerifiableListing | null | undefined
  /** The org the viewer is acting as. */
  viewerOrgId: string | null | undefined
  user: unknown
  /** Verified is a plugin-listing claim; other artifact types never ask. */
  isPlugin: boolean
}

/** What the badge actually claims, said once, in the place someone asks for
 * it — so the request is informed rather than a guess at what it buys. */
const WHAT_VERIFIED_CLAIMS =
  'Verified says a human at Aglyn confirmed who you are, and that this ' +
  'listing describes what the code does. It is a claim about you as a ' +
  'publisher, so it survives a version bump. It is not a security ' +
  'guarantee, and it does not review the bytes of any particular release — ' +
  'that is what Reviewed means, and it is earned per version.'

/**
 * The publisher's door to the Verified badge (AGL-1217).
 *
 * Before this there was none: verification was reviewer-initiated only, so a
 * publisher who wanted the badge had no affordance and no way to learn that
 * asking was even possible.
 *
 * Eligibility comes from `verificationRequestBlock` — the same function the
 * server enforces. That sharing is deliberate: a rule the button knows and
 * the server does not is decoration, and a rule the server knows and the
 * button does not is a button that fails with no explanation.
 */
export function ListingVerificationRequest(
  props: ListingVerificationRequestProps,
) {
  const { listingId, listing, viewerOrgId, user, isPlugin } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Optimistically reflects the action just taken, so the card does not sit
  // unchanged while the listing snapshot catches up.
  const [justDid, setJustDid] = useState<'pending' | 'withdrawn' | null>(null)

  const request = listing?.verificationRequest
  const state = justDid ?? request?.state
  const block = verificationRequestBlock({
    listing,
    viewerOrgId,
    nowMs: Date.now(),
  })

  const post = async (action: 'request' | 'withdraw') => {
    setBusy(true)
    setError(null)
    try {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> }
      )?.getIdToken?.()
      if (!idToken) {
        setError('Please sign in again.')
        return
      }
      const response = await fetch('/api/marketplace/verification-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ listingId, action }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) {
        // The server's own words. It re-checks the same policy, so when it
        // refuses it knows something this component's snapshot did not.
        setError(data.error ?? 'That did not work. Try again.')
        return
      }
      setJustDid(action === 'request' ? 'pending' : 'withdrawn')
    } catch {
      setError('That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!isPlugin) return null
  // Not the publisher, or already carrying the badge: nothing to offer. The
  // badge itself is rendered on the listing body, so saying so here would be
  // repeating it in a card about asking.
  if (block === 'not-publisher' || block === 'already-verified') return null
  // A listing still in the queue has a review card above already explaining
  // where it stands. A second card saying "and you cannot ask for a badge
  // yet" adds noise to a publisher who has not asked for anything.
  if (block === 'not-listed' && state !== 'pending') return null

  const declinedAt = timestampMs(request?.decidedAt)
  const canAskAgain =
    declinedAt === null
      ? null
      : new Date(
          declinedAt + VERIFICATION_DECLINE_COOLDOWN_DAYS * 86_400_000,
        ).toLocaleDateString()

  return (
    <CardDisplay
      header={'Verified publisher'}
      help={docsHelp('publisherHandbook', {
        anchor: '#asking-to-be-verified',
        excerpt:
          'When you can ask, what happens while it waits, and what a decline ' +
          'does and does not mean.',
      })}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {WHAT_VERIFIED_CLAIMS}
        </Typography>

        {state === 'pending' ? (
          <>
            <Alert severity="info">
              {'Your request is with the review team. Your plugin stays ' +
                'listed and installable while they look.'}
            </Alert>
            <Stack direction="row">
              <Button
                variant="outlined"
                color="inherit"
                disabled={busy}
                onClick={() => void post('withdraw')}
              >
                {'Withdraw request'}
              </Button>
            </Stack>
          </>
        ) : block === 'cooling-down' ? (
          <Alert severity="warning">
            <Stack spacing={1}>
              <Typography variant="body2">
                {request?.declineReason
                  ? `Declined: ${request.declineReason}`
                  : 'A previous request was declined.'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {canAskAgain
                  ? `You can ask again from ${canAskAgain}.`
                  : `You can ask again ${VERIFICATION_DECLINE_COOLDOWN_DAYS} days after the decision.`}
              </Typography>
            </Stack>
          </Alert>
        ) : (
          <Stack direction="row">
            <Button
              variant="contained"
              color="primary"
              disabled={busy || block !== null}
              onClick={() => void post('request')}
            >
              {'Request verification'}
            </Button>
          </Stack>
        )}

        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </CardDisplay>
  )
}

export default ListingVerificationRequest
