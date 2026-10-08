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
/**
 * Recorded webhook payloads (AGL-3644), one per event each adapter reads,
 * in the shapes each service documents for its point-of-sale integrations.
 * Ids and names are invented; amounts are in cents, as each service sends.
 */

/** DoorDash Marketplace: a new order, two items, one with options. */
export const DOORDASH_ORDER_CREATE = {
  event: { type: 'OrderCreate', status: 'NEW' },
  order: {
    id: '3f1c8e2a-dd01-4b7e-9a51-6f0c2d9e8a10',
    store: { id: '24680', merchant_supplied_id: 'aglyn-store-7' },
    consumer: { first_name: 'Jamie', last_name: 'Rivera', phone: '+15555550123' },
    categories: [
      {
        name: 'Burgers',
        items: [
          {
            id: 'line-1',
            name: 'Classic Burger',
            merchant_supplied_id: 'aglyn:burger:default',
            quantity: 2,
            price: 1200,
            special_instructions: 'No onions',
            extras: [{ name: 'Add-ons', options: [{ name: 'Cheese', price: 100, quantity: 1 }] }],
          },
        ],
      },
      {
        name: 'Sides',
        items: [{ id: 'line-2', name: 'Fries', merchant_supplied_id: 'FRY-1', quantity: 1, price: 400, extras: [] }],
      },
    ],
    subtotal: 3000,
    tax: 240,
    merchant_funded_discount: 0,
    currency: 'USD',
    created_at: '2026-10-07T18:00:00Z',
    estimated_pickup_time: '2026-10-07T18:20:00Z',
    delivery_short_code: 'A1B2C3',
    is_pickup: false,
    special_instructions: 'Leave at the door',
  },
}

/** DoorDash: the same order, Fries taken off. */
export const DOORDASH_ORDER_ADJUST = {
  event: { type: 'OrderAdjust', id: 'adj-77' },
  order: {
    ...DOORDASH_ORDER_CREATE.order,
    categories: [DOORDASH_ORDER_CREATE.order.categories[0]],
    subtotal: 2600,
    tax: 208,
  },
}

/** DoorDash: the order canceled. */
export const DOORDASH_ORDER_CANCEL = {
  event: { type: 'OrderCancel' },
  order: { id: DOORDASH_ORDER_CREATE.order.id, store: DOORDASH_ORDER_CREATE.order.store, cancel_reason: 'Customer canceled' },
}

/** Uber Eats: the webhook only names the order. */
export const UBER_ORDER_NOTIFICATION = {
  event_id: 'c4f1a3c2-0b2e-4d8f-9a77-1f2e3d4c5b6a',
  event_type: 'orders.notification',
  event_time: 1791223200,
  meta: { resource_id: 'uber-order-9', status: 'pos', user_id: 'uber-store-1' },
  resource_href: 'https://api.uber.com/v2/eats/order/uber-order-9',
}

/** Uber Eats: the order read back from `GET /v2/eats/order/{id}`. */
export const UBER_ORDER = {
  id: 'uber-order-9',
  display_id: '9F2C1',
  current_state: 'CREATED',
  type: 'DELIVERY_BY_UBER',
  store: { id: 'uber-store-1', name: 'Corner Grill' },
  eater: { first_name: 'Sam', last_name: 'Lee', phone: '+15555550199' },
  cart: {
    items: [
      {
        id: 'item-burger',
        instance_id: 'inst-1',
        title: 'Classic Burger',
        external_data: 'aglyn:burger:default',
        quantity: 1,
        price: { unit_price: { amount: 1200, currency_code: 'USD' }, total_price: { amount: 1350, currency_code: 'USD' } },
        selected_modifier_groups: [
          { title: 'Extras', selected_items: [{ title: 'Bacon', quantity: 1, price: { unit_price: { amount: 150, currency_code: 'USD' } } }] },
        ],
      },
    ],
    special_instructions: 'Extra napkins',
  },
  payment: {
    charges: {
      total: { amount: 1458, currency_code: 'USD' },
      sub_total: { amount: 1350, currency_code: 'USD' },
      tax: { amount: 108, currency_code: 'USD' },
    },
  },
  placed_at: '2026-10-07T18:00:00Z',
  estimated_ready_for_pickup_at: '2026-10-07T18:15:00Z',
}

export const UBER_ORDER_CANCEL = {
  event_id: 'd7e8f9a0-1b2c-3d4e-5f6a-7b8c9d0e1f2a',
  event_type: 'orders.cancel',
  meta: { resource_id: 'uber-order-9', user_id: 'uber-store-1' },
}

/** Grubhub: a new order. */
export const GRUBHUB_ORDER_CREATED = {
  type: 'ORDER_CREATED',
  id: 'evt-1',
  order: {
    id: 'gh-555',
    merchant_id: '112233',
    order_number: '5551-2',
    time_placed: '2026-10-07T18:00:00Z',
    type: 'DELIVERY',
    currency: 'USD',
    diner: { name: 'Alex Morgan', phone: '+15555550142' },
    charges: {
      diner_subtotal: 1600,
      taxes: { total: 128 },
      lines: {
        line_items: [
          { id: 'gl-1', name: 'Classic Burger', external_id: 'aglyn:burger:default', quantity: 1, price: 1200, options: [] },
          { id: 'gl-2', name: 'Fries', external_id: 'FRY-1', quantity: 1, price: 400, options: [] },
        ],
      },
    },
    special_instructions: null,
    estimated_pickup_time: '2026-10-07T18:25:00Z',
  },
}

export const GRUBHUB_ORDER_REFUNDED = {
  type: 'ORDER_REFUNDED',
  id: 'evt-9',
  order: { id: 'gh-555', merchant_id: '112233' },
  refund: { id: 'gh-refund-1', amount: 400, reason: 'Missing fries' },
}
