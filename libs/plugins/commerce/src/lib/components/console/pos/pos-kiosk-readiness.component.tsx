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

import { buildRoute, Route } from '@aglyn/aglyn'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import {
  useConsoleHostRoute,
  useHostOrgId,
  useMerchantPayments,
  useSitePluginConfig,
  useStoreSettingsHref,
} from '@aglyn/tenant-feature-instance'
import { Stack } from '@mui/material'
import { useEffect, useState } from 'react'
import { BUNDLE_ID } from '../../../constants/bundle-common'
import { posKioskSettings } from '../../../pos-kiosk-config'
import { posReadersCall } from './pos-api'

type User = Parameters<typeof posReadersCall>[0]

/** The element id the POS devices card carries, for a link that lands on its card readers. */
export const POS_DEVICES_ANCHOR = 'pos-devices'

/**
 * One thing that keeps a kiosk from taking payment, or narrows how:
 *
 * - `no-payment` — pay at the counter is off and no card path is ready, so
 *   the shopper is told "Payment is not set up on this kiosk yet";
 * - `stripe` — card payments wait on the workspace's Stripe account;
 * - `reader` — no card reader is assigned to the register;
 * - `reader-choice` — several are, and the kiosk sends cards to the one its
 *   staff menu picks.
 */
export type PosKioskGap = 'no-payment' | 'stripe' | 'reader' | 'reader-choice'

export interface PosKioskReadinessFacts {
  /**
   * The deployment takes card payments at a register at all (the readers
   * route's `available`). Where it does not, nothing about readers or Stripe
   * is the merchant's to fix, and only pay at the counter is left.
   */
  cardsOffered: boolean
  /** Card readers assigned to this register. A reader on "Any register" is not one the kiosk uses. */
  registerReaders: number
  /** "Kiosk: let customers pay at the counter", as the site resolves it. */
  payAtCounter: boolean
  /** The workspace's Stripe account can not take card payments yet (settled, never while pending). */
  stripeBlocked: boolean
}

/**
 * What stands between a kiosk on this register and taking payment, most
 * serious first. It mirrors the kiosk's own answer (`server/pos-kiosk.ts`
 * `context`): a reader is offered only where the deployment takes card
 * payments and the register has one, and pay at the counter only where it is
 * switched on. Pure.
 */
export function posKioskGaps(facts: PosKioskReadinessFacts): PosKioskGap[] {
  const gaps: PosKioskGap[] = []
  const cardReady = facts.cardsOffered && facts.registerReaders > 0 && !facts.stripeBlocked
  if (!facts.payAtCounter && !cardReady) gaps.push('no-payment')
  if (!facts.cardsOffered) return gaps
  if (facts.stripeBlocked) gaps.push('stripe')
  if (facts.registerReaders === 0) gaps.push('reader')
  else if (facts.registerReaders > 1) gaps.push('reader-choice')
  return gaps
}

export interface PosKioskReadinessProps {
  user: User | null | undefined
  hostId: string
  registerId: string
  registerName?: string
}

/**
 * Says, while a kiosk is being paired, what it still needs to take payment
 * (AGL-3982). The shopper at a kiosk with no way to pay reads "Payment is not
 * set up on this kiosk yet"; this is where the merchant learns why, with a
 * link to each fix: Stripe on the Payments page, a reader on the POS devices
 * card, and pay at the counter in the store's Point of Sale settings.
 *
 * Nothing is said until every answer is in: a notice that flashes while the
 * readers or the settings load would tell a ready store to set up.
 */
export function PosKioskReadiness({ user, hostId, registerId, registerName }: PosKioskReadinessProps) {
  const payments = useMerchantPayments(hostId)
  const orgId = useHostOrgId(hostId)
  const { config, ready: configReady } = useSitePluginConfig(orgId, hostId, BUNDLE_ID)
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const posSettingsHref = useStoreSettingsHref(hostId, 'pos')
  // `error` when the readers could not be listed: then nothing is said, since
  // "no reader" would be a guess.
  const [readers, setReaders] = useState<{ available: boolean; count: number } | 'error' | null>(null)
  // The person, for the load's key: a signed-in session carries its uid.
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? ''

  useEffect(() => {
    if (!user || !registerId) return
    let active = true
    void posReadersCall<{ available?: boolean; readers?: Array<{ registerId: string | null }> }>(user, {
      action: 'list',
      hostId,
    })
      .then((answer) => {
        if (!active) return
        setReaders({
          available: Boolean(answer?.available),
          count: (answer?.readers ?? []).filter((reader) => reader.registerId === registerId).length,
        })
      })
      .catch(() => {
        if (active) setReaders('error')
      })
    return () => {
      active = false
    }
    // Keyed on the person, not the session object (see the register page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, hostId, registerId])

  if (!readers || readers === 'error' || !configReady || !payments.settled) return null
  const payAtCounter = posKioskSettings(config).payAtCounter
  const gaps = posKioskGaps({
    cardsOffered: readers.available,
    registerReaders: readers.count,
    payAtCounter,
    stripeBlocked: payments.blocked,
  })
  if (!gaps.length) return null

  const register = registerName || 'this register'
  const devicesHref = posSettingsHref ? `${posSettingsHref}#${POS_DEVICES_ANCHOR}` : undefined
  const kioskSettingsHref =
    orgSlug && subdomain
      ? buildRoute(Route.HOST_ADMIN_PLUGIN, { orgSlug, host: subdomain, pluginRef: BUNDLE_ID })
      : undefined
  return (
    <Stack spacing={1} data-testid="pos-kiosk-readiness">
      {gaps.map((gap) => {
        switch (gap) {
          case 'no-payment':
            return (
              <PrerequisiteNotice key={gap} severity="warning" href={kioskSettingsHref} actionLabel="Open store settings">
                {'This kiosk can’t take payment yet: customers will see “Payment is not set up on this kiosk yet.” ' +
                  'Turn on “Kiosk: let customers pay at the counter” in the store’s settings' +
                  (readers.available ? ', or finish card payments below.' : '.')}
              </PrerequisiteNotice>
            )
          case 'stripe':
            return (
              <PrerequisiteNotice key={gap} href={payments.href ?? undefined} actionLabel="Open Payments">
                {`${payments.reason ?? ''} Until then the kiosk can’t take cards` +
                  (payAtCounter ? '; customers pay at the counter.' : '.')}
              </PrerequisiteNotice>
            )
          case 'reader':
            return (
              <PrerequisiteNotice key={gap} href={devicesHref} actionLabel="Open POS devices">
                {`No card reader is assigned to ${register}. Assign one under POS devices so customers can pay by card at the kiosk.`}
              </PrerequisiteNotice>
            )
          case 'reader-choice':
            return (
              <PrerequisiteNotice key={gap}>
                {`${register === 'this register' ? 'This register' : register} has ${readers.count} card readers. ` +
                  'Once the kiosk is paired, choose the one it uses from its staff menu.'}
              </PrerequisiteNotice>
            )
          default:
            return null
        }
      })}
    </Stack>
  )
}
PosKioskReadiness.displayName = 'PosKioskReadiness'

export default PosKioskReadiness
