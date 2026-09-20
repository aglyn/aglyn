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
import { Alert, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
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

/** What the record says, in one sentence under the switch. */
function describe(status: MarketingConsentStatus): string {
  const day = formatDecidedOn(status.atMs)
  if (status.decision === 'granted') {
    return day ? `You opted in on ${day}.` : 'You opted in.'
  }
  if (status.decision === 'declined') {
    return day ? `You opted out on ${day}.` : 'You opted out.'
  }
  return 'No preference on record. Nothing is sent until you turn this on.'
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
 * in either direction.
 */
export function ProductUpdatesCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [status, setStatus] = useState<MarketingConsentStatus | null | undefined>(
    undefined,
  )
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const tokenUser = user as { getIdToken?: () => Promise<string> } | null
    if (!tokenUser?.getIdToken) return
    setStatus(
      await fetchMarketingConsentStatus(
        tokenUser as { getIdToken: () => Promise<string> },
      ),
    )
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
      await refresh()
      setBusy(false)
      enqueueSnackbar(
        next
          ? `You will hear about product updates from ${PLATFORM_BRAND_NAME}.`
          : 'You will not receive product updates.',
        { variant: 'success' },
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
        <Typography variant="caption" color="text.secondary">
          {PLATFORM_MARKETING_CONSENT_TEXT}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}

ProductUpdatesCard.displayName = 'ProductUpdatesCard'

export default ProductUpdatesCard
