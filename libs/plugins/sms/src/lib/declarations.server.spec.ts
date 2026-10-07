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
  pluginSmsAvailable,
  pluginSmsMessaging,
} from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { listPluginUsageMeters } from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { SMS_PLUGIN_ID, SMS_USAGE_METER_ID } from './constants'
import { registerSmsServerDeclarations } from './declarations.server'
import { smsSubprocessors } from './subprocessors'
import { smsUsageAxes } from './usage-axes'

/**
 * Boot registration (AGL-3610): the contract other plugins resolve, and the
 * meter the usage sweep requires — and both stay inert without credentials.
 */
afterEach(() => {
  unregisterPluginServices(SMS_PLUGIN_ID)
  delete process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_AUTH_TOKEN
  delete process.env.TWILIO_MESSAGING_SERVICE_SID
})

describe('registerSmsServerDeclarations', () => {
  it('registers the text contract, unavailable until Twilio is configured', () => {
    registerSmsServerDeclarations()
    expect(pluginSmsMessaging()).toBeDefined()
    expect(pluginSmsAvailable()).toBe(false)
    process.env.TWILIO_ACCOUNT_SID = 'AC1'
    process.env.TWILIO_AUTH_TOKEN = 't'
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG1'
    expect(pluginSmsAvailable()).toBe(true)
  })

  it('registers the meter usage-axes declares', () => {
    registerSmsServerDeclarations()
    expect(smsUsageAxes().meters).toEqual([{ id: SMS_USAGE_METER_ID }])
    expect(
      listPluginUsageMeters().some(
        (meter) => meter.pluginId === SMS_PLUGIN_ID && meter.id === SMS_USAGE_METER_ID,
      ),
    ).toBe(true)
  })

  it('declares Twilio as the subprocessor it reaches', () => {
    expect(smsSubprocessors().map((entry) => entry.host)).toEqual(['api.twilio.com'])
  })
})
