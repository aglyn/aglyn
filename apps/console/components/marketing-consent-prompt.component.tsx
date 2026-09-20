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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, AlertTitle, Button, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchMarketingConsentStatus,
  type MarketingConsentAnswer,
  postMarketingConsent,
} from '../utils/marketing-opt-in'

/**
 * The one-time ask for accounts that were never asked (AGL-3185).
 *
 * Every account created before the sign-up checkbox existed holds no
 * decision, and under the strict policy that is unsendable. This card asks
 * once. "Yes" records a grant and "No" records a refusal, and neither is
 * ever asked again; closing the card records only that it was closed, and it
 * stays away for ninety days. The server decides whether the card is due,
 * so the rule lives in one place and a refused status read shows nothing —
 * a card that cannot know whether somebody already answered must not ask.
 *
 * Mounted where a signed-in person lands rather than above every route: a
 * marketing ask on top of the designer canvas is not what somebody opening
 * the designer came for.
 */
export function MarketingConsentPrompt() {
  const { data: user } = useUser()
  // A bare context read, `null` outside its provider. The console shell
  // always mounts one; the page specs that render the workspace chooser and
  // the sites list do not, and a confirmation toast is not worth a crash on
  // the two pages every signed-in person lands on.
  const snackbar = useSnackbar()
  const [due, setDue] = useState(false)
  const [busy, setBusy] = useState<MarketingConsentAnswer | null>(null)

  useEffect(() => {
    let cancelled = false
    const tokenUser = user as { getIdToken?: () => Promise<string> } | null
    if (!tokenUser?.getIdToken) return undefined
    void (async () => {
      const status = await fetchMarketingConsentStatus(
        tokenUser as { getIdToken: () => Promise<string> },
      )
      if (!cancelled) setDue(status?.promptDue === true)
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const answer = useCallback(
    async (decision: MarketingConsentAnswer) => {
      setBusy(decision)
      const recorded = await postMarketingConsent(
        user as { getIdToken: () => Promise<string> },
        decision,
        'console-prompt',
      )
      setBusy(null)
      if (!recorded) {
        snackbar?.enqueueSnackbar('Your choice could not be saved. Please try again.', {
          variant: 'warning',
        })
        return
      }
      setDue(false)
      if (decision === 'granted') {
        snackbar?.enqueueSnackbar(
          `You will hear about product updates from ${PLATFORM_BRAND_NAME}.`,
          { variant: 'success' },
        )
      } else if (decision === 'declined') {
        snackbar?.enqueueSnackbar('Noted — no product updates.', { variant: 'info' })
      }
    },
    [snackbar, user],
  )

  if (!due) return null

  return (
    <Alert
      severity="info"
      sx={{ mb: 2 }}
      // The close control is the dismissal: no answer, asked again later.
      onClose={() => void answer('dismissed')}
      slotProps={{ closeButton: { 'aria-label': 'Not now', disabled: busy !== null } }}
    >
      <AlertTitle>{`Want product updates from ${PLATFORM_BRAND_NAME}?`}</AlertTitle>
      <Typography variant="body2">{PLATFORM_MARKETING_CONSENT_TEXT}</Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button
          size="small"
          variant="contained"
          disabled={busy !== null}
          onClick={() => void answer('granted')}
        >
          {busy === 'granted' ? 'Saving…' : 'Yes, send them'}
        </Button>
        <Button
          size="small"
          variant="text"
          color="inherit"
          disabled={busy !== null}
          onClick={() => void answer('declined')}
        >
          {busy === 'declined' ? 'Saving…' : 'No thanks'}
        </Button>
      </Stack>
    </Alert>
  )
}

MarketingConsentPrompt.displayName = 'MarketingConsentPrompt'
MarketingConsentPrompt.aglyn = true

export default MarketingConsentPrompt
