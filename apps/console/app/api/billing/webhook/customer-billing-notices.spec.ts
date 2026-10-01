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

import {
  billingNoticeWorkspace,
  dunningCancellationNotice,
  invoiceNotice,
  invoiceNoticeLink,
} from './customer-billing-notices'

const snapshot = (data: Record<string, unknown>) => ({
  get: (field: string) => data[field],
})

describe('billingNoticeWorkspace (AGL-3432)', () => {
  it('names the workspace, else its slug, never a blank', () => {
    expect(billingNoticeWorkspace(snapshot({ name: ' Northwind ', slug: 'nw' }))).toBe('Northwind')
    expect(billingNoticeWorkspace(snapshot({ name: '', slug: 'nw' }))).toBe('nw')
    expect(billingNoticeWorkspace(snapshot({}))).toBe('your workspace')
    expect(billingNoticeWorkspace(null)).toBe('your workspace')
  })
})

describe('the dunning cancellation notice (AGL-3432)', () => {
  it('names the workspace and the plan, and says what the cancellation means', () => {
    const notice = dunningCancellationNotice({ workspace: 'Northwind', previousPlan: 'pro' })
    expect(notice.title).toBe('Subscription for Northwind canceled after failed payments')
    expect(notice.body).toMatch(/^Stripe could not collect payment for Northwind/)
    expect(notice.body).toContain('its Pro subscription was canceled')
    expect(notice.body).toContain('now on the Free plan')
    expect(notice.body).toContain('Nothing was deleted')
    // The live dunning settings leave the last invoice past due.
    expect(notice.body).toContain('The unpaid invoice is still open in Billing')
  })

  it('names no plan on a redelivery, which reads the plan already mirrored to free', () => {
    const notice = dunningCancellationNotice({ workspace: 'Northwind', previousPlan: 'free' })
    expect(notice.body).toContain('so its subscription was canceled')
    expect(notice.body).not.toMatch(/Free subscription/)
  })

  it('says a staff comp keeps the workspace on its granted plan, not Free', () => {
    const notice = dunningCancellationNotice({
      workspace: 'Northwind',
      previousPlan: 'starter',
      org: { entitlements: { planComp: { plan: 'pro' } } },
    })
    expect(notice.body).toContain('now on the Pro plan it was granted')
    expect(notice.body).not.toContain('Free plan')
  })
})

describe('the invoice notices (AGL-3432)', () => {
  it('announces a paid invoice as paid, never as "available" (RB20)', () => {
    const issued = invoiceNotice({
      type: 'invoice.finalized',
      workspace: 'Northwind',
      invoice: { amount_due: 4200, collection_method: 'charge_automatically' },
    })
    const paid = invoiceNotice({
      type: 'invoice.paid',
      workspace: 'Northwind',
      invoice: { amount_due: 4200, amount_paid: 4200 },
    })
    expect(issued.title).toBe('New $42.00 invoice for Northwind')
    expect(issued.body).toBe(
      'A $42.00 invoice for Northwind is ready in Billing. ' +
        'It will be charged to the payment method on file automatically.',
    )
    expect(paid.title).toBe('Invoice paid: $42.00 for Northwind')
    expect(paid.body).toBe('The $42.00 invoice for Northwind was paid. Nothing more is due on it.')
    expect(`${paid.title} ${paid.body}`).not.toMatch(/available|ready/i)
    expect(paid.title).not.toBe(issued.title)
  })

  it('says a send-invoice bill waits to be paid, and a zero bill owes nothing', () => {
    expect(
      invoiceNotice({
        type: 'invoice.finalized',
        workspace: 'Northwind',
        invoice: { amount_due: 120000, collection_method: 'send_invoice' },
      }).body,
    ).toContain('It is not charged automatically: pay it from Billing.')
    expect(
      invoiceNotice({ type: 'invoice.finalized', workspace: 'Northwind', invoice: { amount_due: 0 } })
        .body,
    ).toContain('Nothing is due on it.')
  })

  it('says an invoice staff marked paid was marked paid, not charged', () => {
    expect(
      invoiceNotice({
        type: 'invoice.paid',
        workspace: 'Northwind',
        invoice: { amount_paid: 4200, paid_out_of_band: true },
      }).body,
    ).toBe('The $42.00 invoice for Northwind was marked paid. Nothing more is due on it.')
  })

  it('tells a failed subscription charge what to do and what happens if nobody does', () => {
    const notice = invoiceNotice({
      type: 'invoice.payment_failed',
      workspace: 'Northwind',
      invoice: { amount_due: 4200, subscription: 'sub_1', next_payment_attempt: 1_790_000_000 },
    })
    expect(notice.title).toBe('Payment failed: $42.00 for Northwind')
    expect(notice.body).toBe(
      "Stripe could not charge $42.00 for Northwind's subscription and will try again " +
        'automatically. Update the payment method or pay the invoice in Billing to keep ' +
        'your plan. If every retry fails, the subscription is canceled and Northwind ' +
        'moves to the Free plan.',
    )
  })

  it('reads the subscription off `parent` on newer API versions', () => {
    expect(
      invoiceNotice({
        type: 'invoice.payment_failed',
        workspace: 'Northwind',
        invoice: {
          amount_due: 4200,
          next_payment_attempt: 1_790_000_000,
          parent: { subscription_details: { subscription: 'sub_1' } },
        },
      }).body,
    ).toContain('If every retry fails, the subscription is canceled')
  })

  it('promises no retry, and no cancellation, where Stripe will not retry', () => {
    const last = invoiceNotice({
      type: 'invoice.payment_failed',
      workspace: 'Northwind',
      invoice: { amount_due: 4200, subscription: 'sub_1', next_payment_attempt: null },
    })
    expect(last.body).toContain('will not retry this invoice automatically')
    expect(last.body).toContain('It is still open in Billing')
    expect(last.body).not.toMatch(/try again|If every retry/)
    const oneOff = invoiceNotice({
      type: 'invoice.payment_failed',
      workspace: 'Northwind',
      invoice: { amount_due: 900, next_payment_attempt: 1_790_000_000 },
    })
    expect(oneOff.body).toBe(
      'Stripe could not charge $9.00 for Northwind and will try again automatically. ' +
        'Update the payment method or pay the invoice in Billing.',
    )
  })
})

describe('where an invoice notice links (AGL-3442)', () => {
  it('a failed payment lands on the Update payment method button its body names', () => {
    expect(invoiceNoticeLink('invoice.payment_failed', 'northwind')).toBe(
      '/northwind/billing#update-payment-method',
    )
    // Without a slug, the stored form the console and the email rewrite onto
    // the reader's workspace, hash intact.
    expect(invoiceNoticeLink('invoice.payment_failed', undefined)).toBe(
      '/org/billing#update-payment-method',
    )
  })

  it('an issued or paid invoice has nothing to change, so it opens Billing itself', () => {
    expect(invoiceNoticeLink('invoice.finalized', 'northwind')).toBe('/northwind/billing')
    expect(invoiceNoticeLink('invoice.paid', 'northwind')).toBe('/northwind/billing')
    expect(invoiceNoticeLink('invoice.paid', null)).toBe('/org/billing')
  })
})
