/**
 * @jest-environment node
 */
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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHIPPING_API_ROUTES } from './constants/api-routes'
import { MAX_BATCH } from './server/routes'

/**
 * The native apps buy labels for several ticked orders through the same routes the console's batch widget uses, and the
 * orders lists stop a selection at the batch limit. This keeps the spec and the lists from drifting from the routes.
 */
const SPEC = JSON.parse(
  readFileSync(
    join(__dirname, '../ios/Sources/AglynShippingPlugin/Resources/shipping-order.screens.json'),
    'utf8',
  ),
) as { screens: Array<{ id: string; load?: any; blocks: any[] }> }
const review = SPEC.screens.find((screen) => screen.id === 'shipping.batchReview')!

describe('native batch labels', () => {
  it('rate and buy through the routes the console batch widget calls', () => {
    expect(review.load.rates.url).toBe(`/api/${SHIPPING_API_ROUTES.batchRates}`)
    const buy = review.blocks
      .find((block) => block.id === 'buy')
      .items.find((item: { id: string }) => item.id === 'buy')
    expect(buy.url).toBe(`/api/${SHIPPING_API_ROUTES.batchBuy}`)
    expect(Object.keys(buy.body.items.$map.fields).sort()).toEqual(['rateId', 'recordId', 'shipmentId'])
  })

  it('offer the service rules the route reads', () => {
    const batch = SPEC.screens.find((screen) => screen.id === 'shipping.batch')!
    const policy = batch.blocks
      .find((block) => block.id === 'rate')
      .items[0].prompt.find((field: { key: string }) => field.key === 'policy')
    expect(policy.options.map((option: { value: string }) => option.value)).toEqual(['cheapest', 'fastest'])
  })

  it('hold the selection to the batch limit the orders lists use', () => {
    // The Swift and Kotlin orders lists disable "More…" past this many ticked orders.
    expect(MAX_BATCH).toBe(50)
  })
})
