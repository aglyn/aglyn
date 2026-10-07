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
 *
 * @jest-environment node
 */

import {
  buildDefaultEmailNodeMap,
  EMAIL_NODE_ROOT_ID,
  renderEmailHtml,
} from '@aglyn/shared-util-email'
import { commerceTenantEmails } from './tenant-emails'

/**
 * What a shopper reads when the site published no design of its own: the
 * built-in copy, rendered (AGL-3432). Each body says which store wrote, and
 * says nothing that is not so.
 */
const SITE = {
  'host.businessName': 'Northwind Coffee',
  'host.url': 'https://northwind.example',
}

function render(key: string, merge: Record<string, string>): string {
  const entry = commerceTenantEmails().find((email) => email.key === key)
  if (!entry) throw new Error(`no ${key} entry`)
  return renderEmailHtml({
    nodes: buildDefaultEmailNodeMap(entry) as never,
    rootId: EMAIL_NODE_ROOT_ID,
    merge: { ...SITE, ...merge },
    sanitize: (html) => html,
  }).text
}

describe('commerce site emails name the store and say only what is true (AGL-3432)', () => {
  it('back in stock: names the store, claims no scarcity, links absolutely', () => {
    const text = render('back-in-stock', {
      'product.name': 'House Blend',
      'product.url': 'https://northwind.example/products/house-blend',
    })
    expect(text).toContain('House Blend is back in stock at Northwind Coffee.')
    expect(text).toContain(
      'View product: https://northwind.example/products/house-blend',
    )
    expect(text).not.toMatch(/sells? out/)
  })

  it('abandoned cart: names the store and never says the items are held', () => {
    const text = render('abandoned-cart', {
      'cart.url': 'https://northwind.example/cart',
    })
    expect(text).toContain('You left items in your cart at Northwind Coffee.')
    expect(text).toContain('Nothing in your cart is held for you.')
    expect(text).not.toMatch(/\bheld but\b|\breserved\b/)
  })

  it('reservation: names the property, and states the balance only when one is owed', () => {
    const merge = {
      'reservation.checkIn': 'Mon, 01 Jun 2026',
      'reservation.nights': '3',
      'reservation.paid': '$120.00',
      'reservation.ref': 'res-1',
    }
    const owing = render('reservation-confirmed', {
      ...merge,
      'reservation.balance':
        'Still to pay: $240.00, at the property. It has not been charged.',
    })
    expect(owing).toContain('Your stay at Northwind Coffee is confirmed.')
    expect(owing).toContain('Still to pay: $240.00')

    const paidInFull = render('reservation-confirmed', {
      ...merge,
      'reservation.balance': '',
    })
    expect(paidInFull).not.toContain('Still to pay')
    expect(paidInFull).not.toMatch(/\n\s*\n\s*\n/)
  })

  it('receipt: names the store, and carries the Receipt footer when one is set', () => {
    const merge = {
      'order.summary': '2× House Blend — $24.00',
      'order.total': '$24.00',
      'order.ref': 'cs_1',
    }
    const withFooter = render('order-receipt', {
      ...merge,
      'store.receiptFooter': 'Returns are accepted within 30 days.',
    })
    expect(withFooter).toContain(
      'Here is the receipt for your order from Northwind Coffee.',
    )
    expect(withFooter).toContain('Returns are accepted within 30 days.')
    expect(render('order-receipt', { ...merge, 'store.receiptFooter': '' })).not.toContain(
      'Returns',
    )
  })

  it('gift card: names the store and its address; a bought card has no note line', () => {
    const text = render('gift-card', {
      'giftcard.code': 'GC-ABC123DEF456',
      'giftcard.value': '$25.00',
      'giftcard.note': '',
    })
    expect(text).toContain('You have a $25.00 gift card for Northwind Coffee.')
    expect(text).toContain('Gift card code: GC-ABC123DEF456')
    expect(text).toContain(
      'Enter the code at checkout on https://northwind.example to use its balance.',
    )
    expect(text).toContain('Visit Northwind Coffee: https://northwind.example')
    expect(text).not.toMatch(/\n\s*\n\s*\n/)
  })

  it('member password changed: says how to get back in', () => {
    const text = render('member-password-changed', {
      'site.name': 'Northwind Coffee',
      signInUrl: 'https://northwind.example',
    })
    expect(text).toContain(
      'get the new password from them, or choose "Forgot password?"',
    )
  })

  it('newsletter confirmation: names whose emails they would get', () => {
    const text = render('newsletter-confirmation', {
      'stream.name': 'Newsletter',
      confirmUrl: 'https://northwind.example/subscribe/confirm?token=t',
    })
    expect(text).toContain(
      'Please confirm that you want to get Newsletter emails from Northwind ' +
        'Coffee at this address.',
    )
  })

  it('shipped: names the store and the order, and drops the tracking line when there is none (AGL-3610)', () => {
    const merge = {
      'order.number': '#1042',
      'shipment.summary': '2× House Blend',
      'shipment.carrier': 'UPS',
      'shipment.trackingNumber': '1Z1',
      'shipment.remaining': '',
      'order.statusUrl': 'https://northwind.example/order-status?o=o&t=t',
    }
    const tracked = render('order-shipped', {
      ...merge,
      'shipment.tracking': 'Tracking: UPS 1Z1 — https://www.ups.com/track?tracknum=1Z1',
    })
    expect(tracked).toContain('Northwind Coffee shipped items from order #1042.')
    expect(tracked).toContain('Tracking: UPS 1Z1')
    expect(tracked).toContain(
      'Track your order: https://northwind.example/order-status?o=o&t=t',
    )
    const untracked = render('order-shipped', { ...merge, 'shipment.tracking': '' })
    expect(untracked).not.toContain('Tracking')
    expect(untracked).not.toMatch(/\n\s*\n\s*\n/)
  })

  it('refunded, delivered and canceled each name the store and the order (AGL-3610)', () => {
    const link = { 'order.number': '#7', 'order.statusUrl': 'https://northwind.example/s' }
    expect(
      render('order-refunded', {
        ...link,
        'refund.amount': '$12.00',
        'refund.summary': '',
        'refund.note': 'The rest of your order is unchanged.',
      }),
    ).toContain('Northwind Coffee refunded $12.00 on order #7.')
    expect(render('order-delivered', { ...link, 'order.summary': '1× Mug' })).toContain(
      'Northwind Coffee marked order #7 as delivered.',
    )
    const canceled = render('order-cancelled', {
      ...link,
      'order.summary': '1× Mug',
      'cancel.note': '',
    })
    expect(canceled).toContain('Northwind Coffee canceled order #7.')
    expect(canceled).not.toMatch(/refunded|will be refunded/)
  })

  it('receipt: links the order status page (AGL-3610)', () => {
    expect(
      render('order-receipt', {
        'order.summary': '1× Mug — $10.00',
        'order.total': '$10.00',
        'order.ref': 'cs_1',
        'store.receiptFooter': '',
        'order.statusUrl': 'https://northwind.example/s',
      }),
    ).toContain('View your order: https://northwind.example/s')
  })
})
