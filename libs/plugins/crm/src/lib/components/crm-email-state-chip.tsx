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
  EMAIL_STATE_LABELS,
  emailStateForbidsEmail,
  emailStateWhen,
  type EmailState,
  type EmailStateStatus,
} from '@aglyn/aglyn'
import { Chip, type ChipProps, Tooltip } from '@mui/material'

/**
 * One palette key per state (AGL-3245): a bounce and a block are the
 * address failing, red; a person's own act — unsubscribed, do not contact —
 * is a fact, not a fault, and reads neutral; a complaint is the one that
 * scores the sender and reads as the warning it is. "Would bounce" is a
 * prediction from the domain's DNS (AGL-3328), not a failure yet, and reads
 * as a warning too.
 */
const STATE_COLOR: Record<EmailStateStatus, ChipProps['color']> = {
  ok: 'success',
  undeliverable: 'warning',
  bounced: 'error',
  blocked: 'error',
  unsubscribed: 'default',
  complained: 'warning',
  do_not_contact: 'default',
}

export interface CrmEmailStateChipProps {
  state: EmailState | null | undefined
  size?: ChipProps['size']
}

/**
 * The record's email state as a chip (AGL-3245): the verdict in a word,
 * with when and what the server said on hover. Nothing for a record with
 * no state — most records — so the chip row does not say "OK" on every
 * page.
 */
export function CrmEmailStateChip(props: CrmEmailStateChipProps) {
  const { state, size = 'small' } = props
  if (!state) return null
  const when = emailStateWhen(state)
  const title = [when, state.detail].filter(Boolean).join(' · ')
  const chip = (
    <Chip
      size={size}
      label={EMAIL_STATE_LABELS[state.status]}
      color={STATE_COLOR[state.status]}
      variant={emailStateForbidsEmail(state) ? 'filled' : 'outlined'}
      data-testid="crm-email-state"
    />
  )
  return title ? <Tooltip title={title}>{chip}</Tooltip> : chip
}
CrmEmailStateChip.displayName = 'CrmEmailStateChip'

export default CrmEmailStateChip
