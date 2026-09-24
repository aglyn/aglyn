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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { PLATFORM_MARKETING_CONSENT_TEXT } from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import type { PlatformMarketingHold } from '@aglyn/tenant-data-admin/server/platform-marketing-consent'
import { Alert, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import {
  fetchMarketingConsentStatus,
  type MarketingConsentStatus,
  postMarketingConsent,
} from '../../utils/marketing-opt-in'

/**
 * The day a decision was recorded, in the reader's locale, or null.
 *
 * Null for an absent timestamp and for an unparseable one: `new Date(null)`
 * is the epoch and would print a confident 1970 to a customer.
 */
function formatDecidedOn(atMs: number | null): string | null {
  if (!atMs) return null
  const parsed = new Date(atMs)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * What the record says, in one sentence under the switch — including where it
 * was said, when that was a link in one of the emails rather than this card
 * (AGL-3305), so a switch the person never touched does not read as a
 * mistake.
 */
export function describe(status: MarketingConsentStatus): string {
  const day = formatDecidedOn(status.atMs)
  const on = (sentence: string) => (day ? `${sentence} on ${day}.` : `${sentence}.`)
  if (status.decision === 'granted') {
    if (status.sourceKind === 'email-resubscribe') return on('You resubscribed from an email')
    if (status.sourceKind === 'email-preferences') {
      return on('You chose product updates again from an email')
    }
    return on('You opted in')
  }
  if (status.decision === 'declined') {
    if (status.sourceKind === 'email-unsubscribe') {
      return on(`You unsubscribed from ${PLATFORM_BRAND_NAME}’s emails`)
    }
    if (status.sourceKind === 'email-preferences') {
      return on('You left product updates from an email')
    }
    return on('You opted out')
  }
  return 'No preference on record. Nothing is sent until you turn this on.'
}

/** Why a bounce-class hold is in place, as the person would say it. */
const PAUSED_BECAUSE: Record<string, string> = {
  bounce: 'an earlier email to this address could not be delivered',
  complaint: 'an earlier email was reported as spam',
  erasure: 'you asked for this address to be erased from the mailing list',
}

/**
 * Why a Yes is not arriving (AGL-3305), or null. Worded for what the person
 * can do: only an unsubscribe is theirs to undo here.
 */
export function describeHold(
  hold: PlatformMarketingHold,
  mailboxVerified: boolean,
): { text: string; resumable: boolean } {
  if (hold.kind === 'unsubscribed') {
    return mailboxVerified
      ? {
          text: 'You unsubscribed using a link in one of these emails, so none are being sent.',
          resumable: true,
        }
      : {
          text:
            'You unsubscribed using a link in one of these emails, so none are being sent. ' +
            'Verify your email address, then resume them here.',
          resumable: false,
        }
  }
  if (hold.kind === 'unconfirmed') {
    return {
      text: 'You haven’t confirmed this subscription yet. Use the link in the confirmation email to start receiving them.',
      resumable: false,
    }
  }
  const because = PAUSED_BECAUSE[hold.reason]
  return {
    text: because
      ? `Emails to this address are paused because ${because}.`
      : 'Emails to this address are paused.',
    resumable: false,
  }
}

/**
 * The account-level product-updates switch (AGL-3185).
 *
 * On records a grant and off records a refusal, both through the server,
 * both with the person's own provenance; nothing here writes the account
 * document directly, because the same decision also has to reach the
 * operator's marketing contact and only the server can write there. A
 * refusal is a stored "no" rather than a cleared field, so the one-time
 * prompt never asks somebody who turned this off.
 *
 * A campaign's unsubscribe link lands on the sending site's own unsubscribe
 * route, not here; this card is where a signed-in person changes their mind
 * in either direction. Since AGL-3305 the two meet: leaving product updates
 * from an email turns this switch off, and turning it back on here — from a
 * verified address — reopens that one list and no other.
 */
export function ProductUpdatesCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [status, setStatus] = useState<MarketingConsentStatus | null | undefined>(
    undefined,
  )
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<MarketingConsentStatus | null> => {
    const tokenUser = user as { getIdToken?: () => Promise<string> } | null
    if (!tokenUser?.getIdToken) return null
    const next = await fetchMarketingConsentStatus(
      tokenUser as { getIdToken: () => Promise<string> },
      { detail: 'hold' },
    )
    setStatus(next)
    return next
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = useCallback(
    async (next: boolean) => {
      setBusy(true)
      const recorded = await postMarketingConsent(
        user as { getIdToken: () => Promise<string> },
        next ? 'granted' : 'declined',
        'console-preferences',
      )
      if (!recorded) {
        setBusy(false)
        enqueueSnackbar('Your preference could not be saved. Please try again.', {
          variant: 'warning',
        })
        return
      }
      const updated = await refresh()
      setBusy(false)
      // A Yes that something on the mailing list still blocks says so: the
      // card below it explains, and a success toast would contradict it.
      const held = next && updated?.hold
      enqueueSnackbar(
        held
          ? 'Saved, but product updates are still on hold.'
          : next
            ? `You will hear about product updates from ${PLATFORM_BRAND_NAME}.`
            : 'You will not receive product updates.',
        { variant: held ? 'warning' : 'success' },
      )
    },
    [enqueueSnackbar, refresh, user],
  )

  return (
    <CardDisplay
      header="Product updates"
      help={docsHelp('account', {
        excerpt:
          `Whether ${PLATFORM_BRAND_NAME} may email you about product ` +
          'updates. Your choice is recorded with the date and the wording ' +
          'you agreed to, and you can change it here at any time.',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1}>
        {status === null ? (
          <Alert severity="warning">
            {'Your preference could not be loaded. Reload the page to try again.'}
          </Alert>
        ) : null}
        <FormControlLabel
          control={
            <Switch
              checked={status?.decision === 'granted'}
              onChange={(event) => void toggle(event.target.checked)}
              disabled={busy || !status}
              slotProps={{ input: { 'aria-label': 'Product updates' } }}
            />
          }
          label={`Product updates from ${PLATFORM_BRAND_NAME}`}
        />
        <Typography variant="body2" color="text.secondary">
          {status ? describe(status) : 'Loading your preference…'}
        </Typography>
        {status?.decision === 'granted' && status.hold ? (
          <HoldNotice
            hold={status.hold}
            mailboxVerified={status.mailboxVerified === true}
            busy={busy}
            onResume={() => void toggle(true)}
          />
        ) : null}
        <Typography variant="caption" color="text.secondary">
          {PLATFORM_MARKETING_CONSENT_TEXT}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}

ProductUpdatesCard.displayName = 'ProductUpdatesCard'

/**
 * Why the Yes above is not arriving, with the one action the person has when
 * there is one: recording the Yes again reopens the list they left.
 */
function HoldNotice({
  hold,
  mailboxVerified,
  busy,
  onResume,
}: {
  hold: PlatformMarketingHold
  mailboxVerified: boolean
  busy: boolean
  onResume: () => void
}) {
  const { text, resumable } = describeHold(hold, mailboxVerified)
  return (
    <Alert
      severity="warning"
      action={
        resumable ? (
          <Button color="inherit" size="small" disabled={busy} onClick={onResume}>
            {'Resume'}
          </Button>
        ) : undefined
      }
    >
      {text}
    </Alert>
  )
}

export default ProductUpdatesCard
