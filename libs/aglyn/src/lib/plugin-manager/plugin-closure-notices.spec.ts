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
 * The notices a closure screen prints before the confirm (AGL-4038): every
 * source is asked, warnings come first, and one that could not answer is
 * named rather than read as "nothing to warn about".
 */

import {
  isPrintableClosureNotice,
  listClosureNoticeSources,
  readClosureNotices,
  registerClosureNoticeSource,
  type ClosureNotice,
} from './plugin-closure-notices'
import { registerPluginDeclarationsRepair, resetPluginDeclarationsRepairForTests } from './plugin-declarations-repair'
import { resetPluginServicesForTests } from './plugin-services'

const notice = (over: Partial<ClosureNotice> = {}): ClosureNotice => ({
  id: 'orders',
  severity: 'warning',
  title: 'Two orders will be canceled and refunded',
  body: 'They have not shipped.',
  items: [{ id: 'o1', primary: 'Order 1', secondary: 'Reader × 1', amount: '$10.00' }],
  ...over,
})

describe('the closure notices', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    resetPluginDeclarationsRepairForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('asks every source about the closure, warnings first, each with its plugin', async () => {
    const asked: unknown[] = []
    registerClosureNoticeSource(
      {
        notices: async (subject) => {
          asked.push(subject)
          return [notice({ id: 'tip', severity: 'info', title: 'A tip', body: 'Export first.' })]
        },
      },
      { pluginId: 'files' },
    )
    registerClosureNoticeSource({ notices: async () => [notice()] }, { pluginId: 'shop' })
    const read = await readClosureNotices({ kind: 'workspace', orgId: 'org-1' })
    expect(asked).toEqual([{ kind: 'workspace', orgId: 'org-1' }])
    expect(read.notices.map((answer) => [answer.pluginId, answer.id, answer.severity])).toEqual([
      ['shop', 'orders', 'warning'],
      ['files', 'tip', 'info'],
    ])
    expect(read.unavailable).toEqual([])
  })

  it('answers nothing when no source has anything to say', async () => {
    registerClosureNoticeSource({ notices: async () => [] }, { pluginId: 'shop' })
    expect(await readClosureNotices({ kind: 'account', uid: 'u1' })).toEqual({ notices: [], unavailable: [] })
  })

  it('names a source that threw or answered something unprintable, and keeps the rest', async () => {
    registerClosureNoticeSource(
      {
        notices: async () => {
          throw new Error('down')
        },
      },
      { pluginId: 'broken' },
    )
    registerClosureNoticeSource({ notices: async () => [notice({ items: [] })] }, { pluginId: 'empty' })
    registerClosureNoticeSource({ notices: async () => [notice()] }, { pluginId: 'shop' })
    const read = await readClosureNotices({ kind: 'account', uid: 'u1' })
    expect(read.notices.map((answer) => answer.pluginId)).toEqual(['shop'])
    expect(read.unavailable).toEqual(['broken', 'empty'])
  })

  it('runs the app’s boot step once more when nothing is registered, then asks', async () => {
    registerPluginDeclarationsRepair(async () => {
      registerClosureNoticeSource({ notices: async () => [notice()] }, { pluginId: 'shop' })
    })
    const read = await readClosureNotices({ kind: 'workspace', orgId: 'org-1' })
    expect(read.notices).toHaveLength(1)
    expect(listClosureNoticeSources()).toEqual(['shop'])
  })

  it('prints only a notice with words, a severity and a line per item', () => {
    expect(isPrintableClosureNotice(notice())).toBe(true)
    expect(isPrintableClosureNotice(notice({ title: '' }))).toBe(false)
    expect(isPrintableClosureNotice(notice({ severity: 'blocking' as never }))).toBe(false)
    expect(isPrintableClosureNotice(notice({ items: [{ id: 'x', primary: '' }] }))).toBe(false)
    expect(isPrintableClosureNotice(null)).toBe(false)
  })

  it('refuses to register something that cannot answer', () => {
    expect(() => registerClosureNoticeSource({} as never, { pluginId: 'shop' })).toThrow(/notices/)
  })
})
