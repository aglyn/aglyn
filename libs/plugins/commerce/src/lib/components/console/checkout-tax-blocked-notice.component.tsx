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

import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { useStoreSettingsHref } from '@aglyn/tenant-feature-instance'
import { AlertTitle } from '@mui/material'
import type { CheckoutTaxBlock } from '../../model/commerce-tax-readiness'
import { refusedOnText, useStoreTaxReadiness } from './stripe-tax-readiness.component'

export interface CheckoutTaxBlockedNoticeProps {
  hostId: string
}

/** What the Payments card says about one tax block. */
export function checkoutTaxBlockedText(reason: CheckoutTaxBlock): string {
  return reason === 'tax-undecided'
    ? 'This store hasn’t chosen how it handles sales tax yet. Choose an option in Taxes and save.'
    : 'This store uses Stripe Tax, and Stripe Tax isn’t on in your Stripe account yet. Taxes shows what’s left, or lets you pick another option.'
}

/**
 * "Shoppers can't check out right now" on the Payments card (AGL-4245): a
 * payment account can be ready while checkout still refuses every shopper
 * because of sales tax, and nothing on this page said so. Drawn only while
 * the store's readiness read says checkout is blocked by tax, with a link to
 * Products → Taxes.
 */
export function CheckoutTaxBlockedNotice(props: CheckoutTaxBlockedNoticeProps) {
  const { hostId } = props
  const readiness = useStoreTaxReadiness(hostId)
  const blocked = readiness.data?.blocked
  if (blocked !== 'tax-undecided' && blocked !== 'stripe-tax-not-active') return null
  return (
    <BlockedNotice
      hostId={hostId}
      reason={blocked}
      refused={refusedOnText(readiness.data?.refusedAtMs)}
    />
  )
}
CheckoutTaxBlockedNotice.displayName = 'CheckoutTaxBlockedNotice'

/**
 * Mounted only once checkout reads as blocked, so the Taxes page's address is
 * looked up only for a store that needs the link.
 */
function BlockedNotice(props: { hostId: string; reason: CheckoutTaxBlock; refused: string | null }) {
  const taxesHref = useStoreSettingsHref(props.hostId, 'taxes')
  return (
    <PrerequisiteNotice severity="warning" {...(taxesHref ? { href: taxesHref } : {})} actionLabel="Open Taxes">
      <AlertTitle>{'Shoppers can’t check out right now'}</AlertTitle>
      {checkoutTaxBlockedText(props.reason)}
      {props.refused ? ` ${props.refused}` : null}
    </PrerequisiteNotice>
  )
}

export default CheckoutTaxBlockedNotice
