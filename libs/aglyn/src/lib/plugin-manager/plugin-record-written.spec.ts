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
  notifyPluginRecordWritten,
  registerPluginRecordWrittenListener,
} from './plugin-record-written'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * The record-written seam (AGL-3336): every listener is told, in order, and
 * one that throws neither stops the next nor reaches the writer.
 */
describe('the record-written seam', () => {
  afterEach(() => resetPluginServicesForTests())

  it('tells every listener, and survives one that throws', async () => {
    const heard: string[] = []
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginRecordWrittenListener(
      async () => {
        throw new Error('boom')
      },
      { pluginId: 'first' },
    )
    registerPluginRecordWrittenListener(
      async (event) => {
        heard.push(`${event.collection}:${event.path}`)
      },
      { pluginId: 'second' },
    )
    await expect(
      notifyPluginRecordWritten({ path: 'orgs/o/leads/l1', collection: 'leads' }),
    ).resolves.toBeUndefined()
    expect(heard).toEqual(['leads:orgs/o/leads/l1'])
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('replaces a plugin’s listener registered again under the same key', async () => {
    const heard: string[] = []
    registerPluginRecordWrittenListener(async () => void heard.push('old'), { pluginId: 'crm', key: 'sharing' })
    registerPluginRecordWrittenListener(async () => void heard.push('new'), { pluginId: 'crm', key: 'sharing' })
    await notifyPluginRecordWritten({ path: 'orgs/o/deals/d1', collection: 'deals' })
    expect(heard).toEqual(['new'])
  })
})
