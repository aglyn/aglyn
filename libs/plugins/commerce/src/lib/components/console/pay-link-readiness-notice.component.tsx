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

import * as CommerceModel from '../../model'
import { AppLink } from '@aglyn/shared-ui-jsx/components/app-link'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import {
  firestoreDocPhase,
  useFirestore,
  useFirestoreDoc,
  useMerchantPayments,
  useStoreSettingsHref,
} from '@aglyn/tenant-feature-instance'
import { AlertTitle, Stack, type AlertProps } from '@mui/material'
import { doc } from 'firebase/firestore'

/** An order the pay link may charge: a quote or a draft order; null for a quote not saved yet. */
export type PayLinkNoticeOrder =
  | (Pick<CommerceModel.HostOrder, 'status' | 'channel'> & Partial<Pick<CommerceModel.HostOrder, 'quote' | 'lineItems'>>)
  | null

/** Where a pay link stands with the business's setup, as the console reads it. */
export interface PayLinkReadiness {
  /** What the notice names (`payLinkGaps`); null while anything is still being read. */
  gaps: CommerceModel.PayLinkGap[] | null
  /** The store's sales tax choice; undefined while it is read, or when it can't be. */
  store: CommerceModel.PayLinkStore | undefined
  /** The store's settings are still being read. */
  storeLoading: boolean
  /** Why the workspace can't take card payments, in `useMerchantPayments`'s words. */
  paymentsReason: string | null
  /** The site's Payments settings page. */
  paymentsHref: string | null
  /** The site's Taxes settings page. */
  taxesHref: string | null
}

/**
 * Whether customers can pay an order's pay link, for the console's notice
 * (AGL-4162): the workspace owner's payment account (`useMerchantPayments`,
 * the client's copy of the check the page and Pay make) and the store's
 * sales tax choice, read live. Without a site nothing is read and nothing is
 * answered, so a form can hold its reads until it opens.
 */
export function usePayLinkReadiness(hostId: string | undefined, order: PayLinkNoticeOrder): PayLinkReadiness {
  const firestore = useFirestore()
  const payments = useMerchantPayments(hostId)
  const taxesHref = useStoreSettingsHref(hostId, 'taxes')
  const read = useFirestoreDoc<{ tax?: unknown }>(
    () => (hostId ? doc(firestore, 'hosts', hostId, 'settings', 'store') : null),
    [firestore, hostId],
  )
  const phase = firestoreDocPhase(read)
  const store =
    phase === 'ready'
      ? CommerceModel.payLinkStoreOf(read.data)
      : phase === 'missing'
        ? CommerceModel.payLinkStoreOf(null)
        : undefined
  const gaps = hostId
    ? CommerceModel.payLinkGaps({ order, paymentsReady: payments.settled ? payments.ready : null, store })
    : null
  return {
    gaps,
    store,
    storeLoading: !hostId || phase === 'loading',
    paymentsReason: payments.reason,
    paymentsHref: payments.href,
    taxesHref,
  }
}

/** The notice's first line: `Customers can’t pay this quote online yet.` */
export function payLinkNoticeTitle(noun: 'quote' | 'invoice'): string {
  return `Customers can’t pay this ${noun} online yet.`
}

/** What the notice says about one gap, and the button that fixes it where a page does. */
export function payLinkGapLine(
  gap: CommerceModel.PayLinkGap,
  input: Pick<PayLinkReadiness, 'paymentsReason' | 'paymentsHref' | 'taxesHref'> & { noun: 'quote' | 'invoice' },
): { text: string; action: string | null; href: string | null } {
  switch (gap) {
    case 'payments':
      return {
        text: input.paymentsReason ?? 'Connect a payment account to take card payments.',
        action: 'Open Payments',
        href: input.paymentsHref,
      }
    case 'tax-undecided':
      return { text: 'Choose how this store handles sales tax.', action: 'Open Taxes', href: input.taxesHref }
    case 'tax-save':
      return {
        text: `${input.noun === 'quote' ? 'Save this quote' : 'Save the quote'} again to apply the store’s sales tax setting.`,
        action: null,
        href: null,
      }
  }
}

export interface PayLinkReadinessNoticeProps {
  readiness: PayLinkReadiness
  /** What the customer's page calls it: a quote, or an invoice in the Send invoice form. */
  noun: 'quote' | 'invoice'
  sx?: AlertProps['sx']
}

/**
 * "Customers can't pay this quote online yet." (AGL-4162), naming each setup
 * step a customer's Pay waits on, with a button to the page that fixes it.
 * Drawn only once both answers are in, and only when something is missing.
 * The notice holds nothing back itself: the quote can still be sent and its
 * link copied, for a business that takes the payment another way.
 */
export function PayLinkReadinessNotice(props: PayLinkReadinessNoticeProps) {
  const { readiness, noun, sx } = props
  if (!readiness.gaps?.length) return null
  return (
    <PrerequisiteNotice severity="warning" sx={sx}>
      <AlertTitle>{payLinkNoticeTitle(noun)}</AlertTitle>
      <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {readiness.gaps.map((gap) => {
          const line = payLinkGapLine(gap, { ...readiness, noun })
          return (
            <Stack
              key={gap}
              component="li"
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
            >
              <span>{line.text}</span>
              {line.action && line.href ? (
                <AppLink componentVariant="button" color="inherit" size="small" href={line.href} sx={{ flexShrink: 0 }}>
                  {line.action}
                </AppLink>
              ) : null}
            </Stack>
          )
        })}
      </Stack>
    </PrerequisiteNotice>
  )
}
PayLinkReadinessNotice.displayName = 'PayLinkReadinessNotice'

export interface PayLinkReadinessNoticeForProps extends Omit<PayLinkReadinessNoticeProps, 'readiness'> {
  hostId: string
  order: PayLinkNoticeOrder
}

/**
 * The notice with its own reads ({@link usePayLinkReadiness}), for a surface
 * that mounts it only while it is on screen: a form's body, or a section
 * drawn only for an unpaid quote.
 */
export function PayLinkReadinessNoticeFor(props: PayLinkReadinessNoticeForProps) {
  const { hostId, order, ...rest } = props
  const readiness = usePayLinkReadiness(hostId, order)
  return <PayLinkReadinessNotice readiness={readiness} {...rest} />
}
PayLinkReadinessNoticeFor.displayName = 'PayLinkReadinessNoticeFor'

export default PayLinkReadinessNotice
