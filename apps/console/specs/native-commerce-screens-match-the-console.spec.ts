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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUYER_NOTIFICATION_EVENTS,
  BUYER_NOTIFICATION_LABELS,
} from '@aglyn/plugins-commerce/model/buyer-notifications'
import { STOREFRONT_PAYMENT_METHODS } from '@aglyn/plugins-commerce/model/commerce-payment-methods'
import {
  RETURN_REASON_LABELS,
  RETURN_STATUSES,
  RETURN_STATUS_LABELS,
} from '@aglyn/plugins-commerce/model/commerce-returns'
import { SHIPSTATION_STATUS_NAMES } from '@aglyn/plugins-commerce/model/shipstation'
import {
  ORDER_WEBHOOK_DELIVERY_STATUS_LABELS,
  ORDER_WEBHOOK_MAX_ENDPOINTS,
} from '@aglyn/plugins-commerce/model/order-webhooks'
import {
  PICKUP_HOURS_MAX,
  PICKUP_INSTRUCTIONS_MAX,
} from '@aglyn/plugins-commerce/model/local-fulfillment-settings'
import {
  REVIEW_MODERATION_REASONS,
  REVIEW_MODERATION_REASON_LABELS,
  REVIEW_REQUEST_DELAY_DEFAULT_DAYS,
  REVIEW_REQUEST_DELAY_MAX_DAYS,
  REVIEW_REQUEST_DELAY_MIN_DAYS,
} from '@aglyn/plugins-commerce/model/product-reviews'
import {
  LOCAL_FULFILLMENT_OPEN_STATUSES,
  LOCAL_FULFILLMENT_QUEUE_FIELDS,
  LOCAL_FULFILLMENT_QUEUE_LIMIT,
  LOCAL_FULFILLMENT_QUEUE_TABS,
} from '@aglyn/plugins-commerce/constants/local-fulfillment-list-query'
import { STOCK_MOVEMENT_REASON_LABEL } from '@aglyn/plugins-commerce/constants/stock-movement-query'

/**
 * The Commerce plugin's native screens restate some facts the console works out in code, because a screen spec has no
 * tables of its own: a status's words, the reasons a stock count moves, what each payment method asks of a shopper. This
 * keeps them from drifting from the console's cards.
 */
const RESOURCES = join(
  __dirname,
  '../../../libs/plugins/commerce/src/ios/Sources/AglynCommercePlugin/Resources',
)

const screens: Record<string, any> = {}
for (const file of readdirSync(RESOURCES).filter((name) =>
  name.endsWith('.screens.json'),
)) {
  for (const screen of JSON.parse(readFileSync(join(RESOURCES, file), 'utf8'))
    .screens as any[]) {
    screens[screen.id] = screen
  }
}

const rows = (list: Array<{ id: string; label: string }>) =>
  list.map((row) => [row.id, row.label])

describe('native commerce screens', () => {
  it('say a return status and a reason in the console words', () => {
    expect(rows(screens['commerce.returns'].constants.statuses)).toEqual(
      RETURN_STATUSES.map((status) => [status, RETURN_STATUS_LABELS[status]]),
    )
    expect(rows(screens['commerce.return'].constants.reasons)).toEqual(
      Object.entries(RETURN_REASON_LABELS),
    )
  })

  it('name the reasons a stock count moves, in the console order', () => {
    expect(rows(screens['commerce.stockMovements'].constants.reasons)).toEqual(
      Object.entries(STOCK_MOVEMENT_REASON_LABEL),
    )
  })

  it('offer the same customer emails with the same words', () => {
    expect(screens['commerce.notifications'].constants.events).toEqual(
      BUYER_NOTIFICATION_EVENTS.map((id) => ({
        id,
        label: BUYER_NOTIFICATION_LABELS[id].label,
        description: BUYER_NOTIFICATION_LABELS[id].description,
      })),
    )
  })

  it('moderate reviews for the reasons the console allows and bound the request delay as it does', () => {
    expect(rows(screens['commerce.reviews'].constants.reasons)).toEqual(
      REVIEW_MODERATION_REASONS.map((reason) => [
        reason,
        REVIEW_MODERATION_REASON_LABELS[reason],
      ]),
    )
    const delay = screens['commerce.reviewSettings'].blocks[0].fields.find(
      (field: { key: string }) => field.key === 'requestDelayDays',
    )
    expect([delay.min, delay.max]).toEqual([
      REVIEW_REQUEST_DELAY_MIN_DAYS,
      REVIEW_REQUEST_DELAY_MAX_DAYS,
    ])
    expect(delay.initial).toContain(`'${REVIEW_REQUEST_DELAY_DEFAULT_DAYS}'`)
  })

  it('describe each payment method as the console does', () => {
    expect(screens['commerce.paymentMethods'].constants.methods).toEqual(
      STOREFRONT_PAYMENT_METHODS.map((method) => ({
        id: method.id,
        label: method.label,
        kind: method.kind,
        capability: Boolean(method.capability),
        requirements: method.requirements,
        limits: method.limits,
      })),
    )
  })

  it('print the status names ShipStation is told to use', () => {
    const rowsOf = screens['commerce.shipstation'].blocks.find(
      (block: { id: string }) => block.id === 'statusNames',
    ).rows
    expect(rowsOf.map((row: { value: string }) => row.value)).toEqual([
      SHIPSTATION_STATUS_NAMES.unpaid,
      SHIPSTATION_STATUS_NAMES.paid,
      SHIPSTATION_STATUS_NAMES.shipped,
      SHIPSTATION_STATUS_NAMES.canceled,
      SHIPSTATION_STATUS_NAMES.onHold,
    ])
  })

  it('read as many webhook endpoints, and name a delivery, as the console does', () => {
    const list = screens['commerce.orderWebhooks']
    expect(list.load.endpoints.query.limit).toBe(ORDER_WEBHOOK_MAX_ENDPOINTS)
    expect(rows(list.constants.statuses)).toEqual(
      Object.entries(ORDER_WEBHOOK_DELIVERY_STATUS_LABELS),
    )
  })

  it('cut pickup text where the console does', () => {
    const body = JSON.stringify(screens['commerce.locations'])
    expect(body).toContain(`take/${PICKUP_HOURS_MAX}`)
    expect(body).toContain(`take/${PICKUP_INSTRUCTIONS_MAX}`)
  })

  it('ask the one query the console asks for each pickup and delivery tab', () => {
    for (const id of [
      'commerce.fulfillmentPickup',
      'commerce.fulfillmentDelivery',
    ]) {
      expect(rows(screens[id].constants.tabs)).toEqual(
        LOCAL_FULFILLMENT_QUEUE_TABS.map((tab) => [tab.key, tab.label]),
      )
    }
    const query = screens['commerce.fulfillmentPickup'].load.orders.query
    expect(query.limit).toBe(LOCAL_FULFILLMENT_QUEUE_LIMIT)
    expect(query.orderBy).toBe(`${LOCAL_FULFILLMENT_QUEUE_FIELDS.due} asc`)
    expect(
      query.where.map((clause: unknown[]) => [clause[0], clause[1]]),
    ).toEqual([
      [LOCAL_FULFILLMENT_QUEUE_FIELDS.location, '=='],
      [LOCAL_FULFILLMENT_QUEUE_FIELDS.key, '=='],
      [LOCAL_FULFILLMENT_QUEUE_FIELDS.status, 'in'],
    ])
    expect(query.where[2][2]).toEqual([...LOCAL_FULFILLMENT_OPEN_STATUSES])
  })
})
