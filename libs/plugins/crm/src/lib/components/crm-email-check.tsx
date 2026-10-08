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

import { type EmailState } from '@aglyn/aglyn'
import { Alert, Chip, type ChipProps, Tooltip } from '@mui/material'
import { useEffect, useState } from 'react'
import { useCrmApi } from './use-crm-api'

/*==========================================
 * WHAT THE PLATFORM KNOWS ABOUT ONE ADDRESS (AGL-3328).
 *
 * `crm/email-check` answers it from the server — the domain's MX from the
 * platform cache, and the ledger of what that domain's mail gateway did
 * with this site's sending domain. The browser does no DNS. Two surfaces
 * read it: the gateway chip beside a record's address, and the composer's
 * warning before a one-to-one send.
 *==========================================*/

/** The chip's tone, as the server's `mailGatewayChip` names it. */
type ChipTone = 'refused' | 'delivered' | 'neutral' | 'blocked'

/** What `crm/email-check` answers. */
export interface CrmEmailCheck {
  checked: boolean
  code: 'no_mx' | 'null_mx' | 'gateway_held' | null
  message: string | null
  gateway: string | null
  chip: { label: string; tone: ChipTone } | null
  /**
   * The address belongs to a locked or banned Aglyn account (AGL-3686).
   * Answered on the house workspace's sites only; `null` everywhere else.
   */
  accountLock: 'banned' | 'locked' | null
}

/**
 * Answers already fetched, by site and address, for a minute: a record page
 * draws the chip and then opens the composer, and both ask about the same
 * address.
 */
const remembered = new Map<string, { atMs: number; answer: Promise<CrmEmailCheck | null> }>()
const REMEMBER_MS = 60_000

function readAnswer(payload: Record<string, unknown>): CrmEmailCheck {
  const chip = payload['chip'] as { label?: unknown; tone?: unknown } | null
  const code = payload['code']
  const accountLock = payload['accountLock']
  return {
    checked: payload['checked'] === true,
    code: code === 'no_mx' || code === 'null_mx' || code === 'gateway_held' ? code : null,
    message: typeof payload['message'] === 'string' ? payload['message'] : null,
    gateway: typeof payload['gateway'] === 'string' ? payload['gateway'] : null,
    chip:
      chip && typeof chip.label === 'string' && typeof chip.tone === 'string'
        ? { label: chip.label, tone: chip.tone as ChipTone }
        : null,
    accountLock: accountLock === 'banned' || accountLock === 'locked' ? accountLock : null,
  }
}

/**
 * The server's answer for `email`, sent from `hostId` — `null` until it
 * arrives, and `null` when it could not be had: a check that fails says
 * nothing rather than something wrong.
 */
export function useCrmEmailCheck(
  hostId: string | null,
  email: string | null | undefined,
  options: { enabled?: boolean } = {},
): CrmEmailCheck | null {
  const enabled = options.enabled !== false
  const address = String(email ?? '')
    .trim()
    .toLowerCase()
  const api = useCrmApi(hostId)
  const [answer, setAnswer] = useState<CrmEmailCheck | null>(null)
  useEffect(() => {
    setAnswer(null)
    if (!enabled || !address) return undefined
    let cancelled = false
    const key = `${hostId ?? ''}|${address}`
    const now = Date.now()
    let entry = remembered.get(key)
    if (!entry || entry.atMs + REMEMBER_MS < now) {
      entry = {
        atMs: now,
        answer: api('email-check', { email: address })
          .then(({ response, payload }) => (response.ok ? readAnswer(payload) : null))
          .catch(() => null),
      }
      remembered.set(key, entry)
    }
    void entry.answer.then((value) => {
      if (!cancelled) setAnswer(value)
    })
    return () => {
      cancelled = true
    }
  }, [api, hostId, address, enabled])
  return answer
}

const TONE_COLOR: Record<ChipTone, ChipProps['color']> = {
  refused: 'error',
  blocked: 'error',
  delivered: 'success',
  neutral: 'default',
}

export interface CrmEmailGatewayChipProps {
  hostId: string | null
  email: string | null | undefined
  /** The record's email state: a "Would bounce" already says what a no-MX chip would. */
  emailState?: EmailState | null
  /** Off where the page cannot ask — a plan without the CRM. */
  enabled?: boolean
  size?: ChipProps['size']
}

/**
 * The mail gateway in front of a record's address, and what it did with
 * this site's mail this week (AGL-3328): "Barracuda · 2 of 2 sends refused
 * this week", "Microsoft 365 · 5 of 5 delivered this week", or just the
 * gateway's name. Nothing for an unrecognized exchange with no verdict, a
 * public mailbox provider, or an address nothing could be read about.
 */
export function CrmEmailGatewayChip(props: CrmEmailGatewayChipProps) {
  const { hostId, email, emailState, enabled = true, size = 'small' } = props
  const check = useCrmEmailCheck(hostId, email, { enabled })
  const chip = check?.chip
  if (!chip) return null
  if (chip.tone === 'blocked' && emailState?.status === 'undeliverable') return null
  return (
    <Tooltip title={check?.message ?? 'The mail gateway in front of this address'}>
      <Chip
        size={size}
        variant="outlined"
        label={chip.label}
        color={TONE_COLOR[chip.tone]}
        data-testid="crm-email-gateway"
      />
    </Tooltip>
  )
}
CrmEmailGatewayChip.displayName = 'CrmEmailGatewayChip'

const ACCOUNT_LOCK_CHIP: Record<'banned' | 'locked', { label: string; title: string }> = {
  banned: {
    label: 'Account banned',
    title:
      'This address belongs to an Aglyn account banned for abuse. Nothing is sent to it — no campaign, sequence or one-to-one email — whatever its consent says. Lifting the ban restores it.',
  },
  locked: {
    label: 'Account locked',
    title:
      'This address belongs to a locked Aglyn account. Our campaigns and sequences skip it until the lock is lifted; its consent is unchanged.',
  },
}

/**
 * Why a record whose consent reads as given is skipped by every send
 * (AGL-3686): its address belongs to a locked or banned Aglyn account.
 * Only the house workspace is told, so it draws nothing anywhere else.
 */
export function CrmAccountLockChip(props: Omit<CrmEmailGatewayChipProps, 'emailState'>) {
  const { hostId, email, enabled = true, size = 'small' } = props
  const lock = useCrmEmailCheck(hostId, email, { enabled })?.accountLock
  if (!lock) return null
  const { label, title } = ACCOUNT_LOCK_CHIP[lock]
  return (
    <Tooltip title={title}>
      <Chip
        size={size}
        variant="filled"
        color={lock === 'banned' ? 'error' : 'warning'}
        label={label}
        data-testid="crm-account-lock"
      />
    </Tooltip>
  )
}
CrmAccountLockChip.displayName = 'CrmAccountLockChip'

/**
 * The composer's warning before a one-to-one send (AGL-3328): the address's
 * domain has no mail server, or its mail gateway refused this site's
 * sending domain twice this month and delivered nothing. The send itself
 * decides what leaves; this says what is likely to happen before it does.
 */
export function crmEmailCheckWarning(check: CrmEmailCheck | null): string | null {
  if (!check?.code || !check.message) return null
  if (check.code === 'gateway_held') {
    return `${check.message} A one-to-one email still goes, but it is likely to be refused too.`
  }
  return `${check.message} Sending will not reach them.`
}

export function CrmEmailCheckAlert(props: { check: CrmEmailCheck | null }) {
  const warning = crmEmailCheckWarning(props.check)
  if (!warning) return null
  return (
    <Alert severity="warning" data-testid="crm-email-check-warning">
      {warning}
    </Alert>
  )
}
