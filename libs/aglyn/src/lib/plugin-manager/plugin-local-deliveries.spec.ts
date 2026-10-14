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
  PLUGIN_COURIER_STATES,
  pluginCourierStateIsFinal,
  pluginLocalDeliveryRecords,
  registerPluginLocalDeliveryRecords,
  type PluginLocalDeliveryRecords,
} from './plugin-local-deliveries'
import { resetPluginServicesForTests } from './plugin-services'

const records = (): PluginLocalDeliveryRecords => ({
  read: async () => null,
  recordCourier: async () => ({ outcome: 'no_such_record' }),
})

describe('core.local-delivery-records (AGL-3695)', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('answers null with no seller registered', () => {
    expect(pluginLocalDeliveryRecords()).toBeNull()
  })

  it('answers the one seller that registered', async () => {
    const seller = records()
    registerPluginLocalDeliveryRecords(seller, { pluginId: 'seller' })
    expect(pluginLocalDeliveryRecords()).toBe(seller)
    await expect(pluginLocalDeliveryRecords()?.read('host-1', 'record-1')).resolves.toBeNull()
  })

  it('refuses a second seller', () => {
    registerPluginLocalDeliveryRecords(records(), { pluginId: 'seller' })
    expect(() => registerPluginLocalDeliveryRecords(records(), { pluginId: 'other-seller' })).toThrow()
  })

  it('calls a run over only once nothing more can happen on it', () => {
    const final = PLUGIN_COURIER_STATES.filter((state) => pluginCourierStateIsFinal(state))
    expect(final.sort()).toEqual(['cancelled', 'delivered', 'returned'])
  })
})
