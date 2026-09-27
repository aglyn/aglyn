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

import { emailSearchTokens } from '@aglyn/aglyn/app-utils/email-search'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ORDER_SEARCH_TOKEN_LIMIT,
  orderDisputeKey,
  orderListFields,
  withOrderListFields,
} from './order-list-fields'

/**
 * What the orders list's query reads, as every writer stamps it (AGL-3321).
 *
 * The worked examples are SHARED with
 * `tools/scripts/backfill-orders-list-fields.mjs`, whose `--self-test` runs
 * the same file: the backfill restates this derivation for the orders written
 * before it, and the two must stamp the same tokens or the older half of a
 * store answers no filter.
 */
const FIXTURES = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'order-list-fields.fixtures.json'),
    'utf8',
  ),
) as {
  orders: Array<{
    name: string
    docId: string
    order: Record<string, unknown>
    options?: { legacyProductName?: string }
    expected: unknown
  }>
  emails: Array<{ email: string | null; expected: string[] }>
}

describe('orderListFields', () => {
  it.each(FIXTURES.orders.map((one) => [one.name, one] as const))(
    'answers the shared worked example: %s',
    (_name, one) => {
      expect(orderListFields(one.order, one.docId, one.options)).toEqual(one.expected)
    },
  )

  it.each(FIXTURES.emails.map((one) => [String(one.email), one] as const))(
    'tokenizes an address as the shared fixtures do: %s',
    (_name, one) => {
      expect(emailSearchTokens(one.email)).toEqual(one.expected)
    },
  )

  it('stamps what the list query asks with the SAME normalizers it asks with', () => {
    const fields = orderListFields(
      { number: 1042, customerEmail: 'Jane.Doe@Acme.com', lineItems: [{ productId: 'p1', name: 'Enamel Camp Mug' }] },
      'o1',
    )
    const { key, token } = nameSearchNormalizers
    // Customer is / contains: the CRM's link seeds the address or a domain.
    expect(fields.customerEmailLower).toBe(key('JANE.DOE@acme.com'))
    expect(fields.customerEmailTokens).toContain(token('acme.com'))
    expect(fields.customerEmailTokens).toContain(token('Jane.Doe@Acme.com'))
    expect(fields.customerEmailTokens).toContain(token('doe'))
    // Order contains, typed either way.
    expect(fields.orderLabelTokens).toContain(token('#1042'))
    expect(fields.orderLabelTokens).toContain(token('1042'))
    // The quick search reads all three.
    for (const word of ['1042', 'jane', 'acme', 'camp', 'mug']) {
      expect(fields.searchTokens).toContain(token(word))
    }
  })

  it('reads the dispute badge’s tone, never the raw status', () => {
    const open = { id: 'dp', status: 'needs_response', amountCents: 1, openedAtMs: 1 }
    expect(orderDisputeKey(open)).toBe('open')
    // A WON dispute also closes with an outcome: it is not a chargeback.
    expect(orderDisputeKey({ ...open, status: 'won', outcome: 'won', closedAtMs: 2 })).toBe('won')
    expect(orderDisputeKey({ ...open, status: 'lost', outcome: 'lost', closedAtMs: 2 })).toBe('lost')
    expect(orderDisputeKey(undefined)).toBeNull()
  })

  it('keeps a status and channel the order names, and lifts absent ones', () => {
    expect(orderListFields({ status: 'refunded', channel: 'pos' }, 'o1')).toMatchObject({
      status: 'refunded',
      channel: 'pos',
    })
    expect(orderListFields({}, 'o1')).toMatchObject({ status: 'paid', channel: 'online' })
  })

  it('caps the search array, cutting item names before the number and address', () => {
    const lineItems = Array.from({ length: 40 }, (_line, at) => ({
      productId: `p${at}`,
      // Words that share no prefix past their first character.
      name: `${at}qwertyuiop ${at}asdfghjkl ${at}zxcvbnm`,
    }))
    const fields = orderListFields({ number: 7, customerEmail: 'a@b.co', lineItems }, 'o1')
    expect(fields.searchTokens).toHaveLength(ORDER_SEARCH_TOKEN_LIMIT)
    expect(fields.searchTokens).toEqual(expect.arrayContaining(['#7', '7', 'a@b.co']))
    expect(fields.productIds).toHaveLength(40)
  })

  it('spreads over a document without changing what the document says', () => {
    const doc = { number: 3, status: 'pending' as const, channel: 'draft' as const, customerEmail: null }
    const stamped = withOrderListFields('o3', doc)
    expect(stamped).toMatchObject(doc)
    expect(stamped.customerEmailLower).toBeNull()
    expect(stamped.customerEmailTokens).toEqual([])
  })
})
