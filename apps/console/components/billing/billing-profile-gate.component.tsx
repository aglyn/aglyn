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

import { Alert, Button, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import type {
  BillingProfileLoadState,
  BillingProfileState,
} from './use-billing-profile'

export interface BillingProfileGateProps {
  loadState: BillingProfileLoadState
  state: BillingProfileState | null
  onRetry: () => void
  /** What this particular card calls itself in its own empty sentences. */
  subject: string
  children: (state: BillingProfileState) => ReactNode
}

/**
 * The four load outcomes every billing settings card shares, in one place.
 *
 * They are FOUR and not two, and the split that matters is between
 * `unconfigured` and `error`:
 *
 *  - `unconfigured` — the deployment answered 501. Billing genuinely is off
 *    here (a self-hosted instance with no Stripe keys, or ours before they
 *    were issued). A plain sentence, no alert: nothing is wrong.
 *  - `error` — we could not reach billing at all. Saying "not configured"
 *    here would be a claim about the customer's account that nobody checked,
 *    on a page where that claim reads as "you are not a customer".
 *
 * Written once because four cards getting this right independently is four
 * chances to get it wrong, and the wrong version is invisible in review.
 */
export default function BillingProfileGateComponent({
  loadState,
  state,
  onRetry,
  subject,
  children,
}: BillingProfileGateProps) {
  if (loadState === 'pending') {
    return (
      <Typography variant="body2" color="text.secondary">
        {`Loading your ${subject}…`}
      </Typography>
    )
  }
  if (loadState === 'unconfigured') {
    return (
      <Typography variant="body2" color="text.secondary">
        {`Your ${subject} appears here once billing is configured on this ` +
          'deployment.'}
      </Typography>
    )
  }
  if (loadState === 'error' || !state) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={onRetry}>
            {'Retry'}
          </Button>
        }
      >
        {`We couldn’t load your ${subject}. This says nothing about your ` +
          'billing — we could not reach it to find out. Nothing has changed.'}
      </Alert>
    )
  }
  return <>{children(state)}</>
}
