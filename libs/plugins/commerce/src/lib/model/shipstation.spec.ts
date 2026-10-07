/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
  formatShipStationDate,
  parseShipStationDate,
  readShipNotice,
  shipNoticeLines,
  shipStationCanImport,
  shipStationCarrierName,
  shipStationOrderStatus,
  shipStationOrderXml,
  shipStationOrdersXml,
  xmlCdata,
  type ShipStationOrderSource,
} from './shipstation'

/**
 * The Custom Store feed and notice as pure data (AGL-3613), against the
 * Custom Store Development Guide (help.shipstation.com, read 2026-10-06).
 * The feed's shape is pinned by a snapshot of one order that exercises every
 * branch: a partial shipment, a variant with options, a weight, an image, a
 * discount, CDATA-hostile text, and an address without a second line.
 */

const ORDER: ShipStationOrderSource = {
  docId: 'ord_abc',
  order: {
    number: 1042,
    status: 'partially_fulfilled',
    channel: 'online',
    createdAtMs: Date.UTC(2026, 9, 5, 14, 30),
    updatedAtMs: Date.UTC(2026, 9, 6, 9, 5),
    customerEmail: 'ada@example.com',
    customerName: 'Ada Buyer',
    note: 'Gift wrap ]]> please & thanks',
    couponCode: 'FALL10',
    shippingAddress: {
      name: 'Ada Buyer',
      line1: '1 Main St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'us',
      phone: '512-555-0100',
    },
    totals: { itemsCents: 4200, shippingCents: 500, taxCents: 312, discountCents: 420, totalCents: 4592, feeCents: 0 },
    lineItems: [
      { productId: 'tee', variantId: 'm', name: 'Tee <Classic>', variantLabel: 'M / Blue', sku: 'TEE-M', quantity: 3, unitAmountCents: 1000, productType: 'physical' },
      { productId: 'ebook', name: 'Ebook', quantity: 1, unitAmountCents: 1200, productType: 'digital' },
    ],
    fulfillments: [{ id: 'f1', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], trackingNumber: 'EARLY', atMs: 3 }],
  },
}

const PRODUCTS = {
  tee: {
    '': { imageUrl: 'https://cdn.aglyn.test/tee.jpg' },
    m: { grams: 200, imageUrl: 'https://cdn.aglyn.test/tee-m.jpg', options: { Size: 'M', Color: 'Blue' } },
  },
}

describe('the orders feed', () => {
  it('writes one order exactly as ShipStation reads it', () => {
    expect(shipStationOrdersXml([shipStationOrderXml(ORDER, PRODUCTS)], 2)).toMatchSnapshot()
  })

  it('sends a part-shipped order only what is left, and never a download', () => {
    const xml = shipStationOrderXml(ORDER, PRODUCTS)
    expect(xml).toContain('<Quantity>2</Quantity>')
    expect(xml).not.toContain('Ebook')
    expect(xml).toContain('<Weight>7.05</Weight><WeightUnits>Ounces</WeightUnits>')
  })

  it('keeps CDATA closed when the text holds its terminator, and escapes plain values', () => {
    expect(xmlCdata('a]]>b', 100)).toBe('<![CDATA[a]]]]><![CDATA[>b]]>')
    expect(xmlCdata('', 100)).toBe('')
    expect(xmlCdata('x'.repeat(300), 50)).toBe(`<![CDATA[${'x'.repeat(50)}]]>`)
    expect(xmlCdata('bell\u0007', 10)).toBe('<![CDATA[bell]]>')
  })

  it('maps every Aglyn status to a name ShipStation is told to expect', () => {
    expect(shipStationOrderStatus('pending')).toBe('unpaid')
    expect(shipStationOrderStatus('paid')).toBe('paid')
    expect(shipStationOrderStatus('partially_fulfilled')).toBe('paid')
    expect(shipStationOrderStatus('fulfilled')).toBe('shipped')
    expect(shipStationOrderStatus('delivered')).toBe('shipped')
    expect(shipStationOrderStatus('cancelled')).toBe('canceled')
    expect(shipStationOrderStatus('refunded')).toBe('canceled')
  })

  it('sends a shipped order its shippable lines whole', () => {
    const xml = shipStationOrderXml({ ...ORDER, order: { ...ORDER.order, status: 'fulfilled' } }, PRODUCTS)
    expect(xml).toContain('<OrderStatus><![CDATA[shipped]]></OrderStatus>')
    expect(xml).toContain('<Quantity>3</Quantity>')
  })

  it('leaves out an order with no street, city, postal code or two-letter country', () => {
    expect(shipStationCanImport(ORDER.order)).toBe(true)
    expect(shipStationCanImport({ ...ORDER.order, shippingAddress: { ...ORDER.order.shippingAddress, country: 'USA' } })).toBe(false)
    expect(shipStationCanImport({ ...ORDER.order, shippingAddress: undefined })).toBe(false)
    expect(shipStationCanImport({ ...ORDER.order, shippingAddress: { ...ORDER.order.shippingAddress, postalCode: '' } })).toBe(false)
  })
})

describe('dates', () => {
  it('reads ShipStation’s MM/dd/yyyy HH:mm in UTC, with seconds or AM/PM', () => {
    expect(parseShipStationDate('03/23/2012 21:09')).toBe(Date.UTC(2012, 2, 23, 21, 9))
    expect(parseShipStationDate('3/5/2012 9:09 PM')).toBe(Date.UTC(2012, 2, 5, 21, 9))
    expect(parseShipStationDate('3/5/2012 12:00 AM')).toBe(Date.UTC(2012, 2, 5, 0, 0))
    expect(parseShipStationDate('01/23/2012 17:28:30')).toBe(Date.UTC(2012, 0, 23, 17, 28, 30))
    expect(parseShipStationDate('2026-10-06T12:00:00Z')).toBe(Date.UTC(2026, 9, 6, 12))
  })

  it('refuses what is not a date', () => {
    expect(parseShipStationDate('02/30/2026 10:00')).toBeNull()
    expect(parseShipStationDate('yesterday')).toBeNull()
    expect(parseShipStationDate('')).toBeNull()
    expect(parseShipStationDate('13/01/2026 10:00')).toBeNull()
  })

  it('writes the same format back', () => {
    expect(formatShipStationDate(Date.UTC(2026, 0, 2, 3, 4))).toBe('01/02/2026 03:04')
  })
})

describe('the ship notice', () => {
  const GUIDE_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<ShipNotice>
  <OrderNumber>ABC123</OrderNumber>
  <OrderID>123456</OrderID>
  <CustomerCode>customer@mystore.com</CustomerCode>
  <LabelCreateDate>10/19/2019 12:56</LabelCreateDate>
  <ShipDate>10/19/2019</ShipDate>
  <Carrier>USPS</Carrier>
  <Service>Priority Mail</Service>
  <TrackingNumber>1Z909084330298430820</TrackingNumber>
  <ShippingCost>4.95</ShippingCost>
  <Recipient>
    <Name>The President</Name>
    <Company>US Govt</Company>
    <Address1>1600 Pennsylvania Ave</Address1>
    <City>Washington</City>
    <State>DC</State>
    <PostalCode>20500</PostalCode>
    <Country>US</Country>
  </Recipient>
  <Items>
    <Item>
      <SKU>FD88821</SKU>
      <Name>My Product Name</Name>
      <Quantity>2</Quantity>
      <LineItemID>25590</LineItemID>
      <UPC><![CDATA[UPC_VALUE]]></UPC>
    </Item>
  </Items>
</ShipNotice>`

  it('reads the guide’s own example', () => {
    expect(readShipNotice(GUIDE_SAMPLE, {})).toEqual({
      orderNumber: 'ABC123',
      orderId: '123456',
      carrier: 'USPS',
      service: 'Priority Mail',
      trackingNumber: '1Z909084330298430820',
      items: [{ lineItemId: '25590', sku: 'FD88821', name: 'My Product Name', quantity: 2 }],
    })
  })

  it('lets the query string win, as the guide names it first', () => {
    const notice = readShipNotice(GUIDE_SAMPLE, { order_number: '1042', carrier: 'ups', tracking_number: 'T-1' })
    expect(notice).toMatchObject({ orderNumber: '1042', carrier: 'ups', trackingNumber: 'T-1', service: 'Priority Mail' })
  })

  it('decodes entities and CDATA, and expands nothing else', () => {
    const notice = readShipNotice(
      '<ShipNotice><OrderNumber>A&amp;B</OrderNumber><Carrier><![CDATA[Fed & Ex]]></Carrier><TrackingNumber>&#x31;&#50;</TrackingNumber><Items/></ShipNotice>',
      {},
    )
    expect(notice).toMatchObject({ orderNumber: 'A&B', carrier: 'Fed & Ex', trackingNumber: '12', items: [] })
  })

  it('refuses a document type, so no entity can be defined', () => {
    expect(readShipNotice('<!DOCTYPE x [<!ENTITY e "boom">]><ShipNotice><OrderNumber>&e;</OrderNumber></ShipNotice>', {})).toEqual({
      problem: expect.stringMatching(/document type/),
    })
  })

  it('refuses a body that is not a ShipNotice', () => {
    expect(readShipNotice('<Orders/>', {})).toEqual({ problem: expect.any(String) })
  })

  it('finds lines by the id the feed sent, then by SKU, and reports the rest', () => {
    const lines = shipNoticeLines(ORDER.order as never, [
      { lineItemId: '0', sku: null, name: null, quantity: 1 },
      { lineItemId: '77', sku: 'tee-m', name: null, quantity: 1 },
      { lineItemId: null, sku: 'NOPE', name: 'Other', quantity: 1 },
    ])
    expect(lines).toEqual({ lines: [{ lineItemId: 0, quantity: 1 }, { lineItemId: 0, quantity: 1 }], unknown: ['NOPE'] })
    expect(shipNoticeLines(ORDER.order as never, [])).toEqual({ lines: null, unknown: [] })
  })

  it('names carriers as the tracking-link builder knows them', () => {
    expect(shipStationCarrierName('usps')).toBe('USPS')
    expect(shipStationCarrierName('stamps_com')).toBe('USPS')
    expect(shipStationCarrierName('fedex')).toBe('FedEx')
    expect(shipStationCarrierName('dhl_express')).toBe('DHL')
    expect(shipStationCarrierName('sendle')).toBe('Sendle')
    expect(shipStationCarrierName('')).toBe('')
  })
})
