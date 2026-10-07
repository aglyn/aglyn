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
 * The browser's site-wide outbox and the native app's are two copies of one
 * mechanism (AGL-3621): the web bundle may not grow for the app, and the id
 * helper the browser's copy calls is not free of React. Both must name the
 * same collection, stage the same entry, retry the same refusal and release
 * on the same answer, or a product saved on a phone leaves the drain a
 * different record than one saved in the console.
 */

import * as Outbox from '@aglyn/aglyn/app-utils/site-wide-outbox'
import * as Browser from './site-wide-change'

const mockDeleteDoc = jest.fn()

jest.mock('@aglyn/aglyn/app-utils/create-resource-uid', () => ({
  createResourceUid: () => 'entry-1',
}))

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  serverTimestamp: () => '__now__',
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  writeBatch: jest.fn(),
}))

const firestore = {} as never

function recorder() {
  const sets: { path: string; data: unknown }[] = []
  return { sets, set: (ref: { path: string }, data: unknown) => sets.push({ path: ref.path, data }) }
}

const refusal = Object.assign(new Error('denied'), { code: 'permission-denied' })

describe('the site-wide outbox, browser and app', () => {
  beforeEach(() => mockDeleteDoc.mockReset().mockResolvedValue(undefined))

  it('names the same collection and addresses', () => {
    expect(Outbox.SITE_WIDE_OUTBOX_COLLECTION).toBe(Browser.SITE_WIDE_OUTBOX_COLLECTION)
    expect(Outbox.SITE_WIDE_OUTBOX_PATHS).toEqual(Browser.SITE_WIDE_OUTBOX_PATHS)
  })

  it('stages the same entry', () => {
    const browser = recorder()
    const app = recorder()
    const a = Browser.stageSiteWideOutboxEntry(browser, firestore, 'host-1')
    const b = Outbox.stageSiteWideOutboxEntryAs(app, firestore, 'host-1', 'entry-1')
    expect(b).toEqual(a)
    expect(app.sets).toEqual(browser.sets)
    expect(app.sets[0]).toEqual({
      path: 'publishOutbox/entry-1',
      data: { hostId: 'host-1', paths: ['/'], createdAt: '__now__', attempts: 0, entireHost: true },
    })
  })

  async function both(commit: (stage: Outbox.StageSiteWideEntry | undefined) => Promise<void>) {
    const browserCalls: boolean[] = []
    const appCalls: boolean[] = []
    const run = (calls: boolean[]) => async (stage: Outbox.StageSiteWideEntry | undefined) => {
      calls.push(Boolean(stage))
      await commit(stage)
    }
    const settle = (promise: Promise<unknown>) =>
      promise.then(
        (value) => ({ value }),
        (error: Error) => ({ error: error.message }),
      )
    const browser = await settle(Browser.commitWithSiteWideEntry('host-1', run(browserCalls)))
    const app = await settle(Outbox.commitWithSiteWideEntryAs('host-1', run(appCalls), () => 'entry-1'))
    return { browser, app, browserCalls, appCalls }
  }

  it('answers the entry when the batch lands', async () => {
    const result = await both(async (stage) => stage?.(recorder(), firestore))
    expect(result.app).toEqual(result.browser)
    expect(result.app).toEqual({ value: { path: 'publishOutbox/entry-1' } })
    expect(result.appCalls).toEqual(result.browserCalls)
  })

  it('lands the write without the entry when only the entry is refused', async () => {
    const result = await both(async (stage) => {
      if (stage) {
        stage(recorder(), firestore)
        throw refusal
      }
    })
    expect(result.app).toEqual(result.browser)
    expect(result.app).toEqual({ value: null })
    expect(result.appCalls).toEqual([true, false])
    expect(result.browserCalls).toEqual([true, false])
  })

  it('surfaces any other failure without a retry', async () => {
    const result = await both(async (stage) => {
      stage?.(recorder(), firestore)
      throw new Error('offline')
    })
    expect(result.app).toEqual(result.browser)
    expect(result.app).toEqual({ error: 'offline' })
    expect(result.appCalls).toEqual([true])
  })

  it.each([
    ['ok', 1],
    ['failed', 0],
    [null, 0],
  ])('releases the entry on %p the same way', async (reason, deletes) => {
    const entry = { path: 'publishOutbox/entry-1' } as never
    await Browser.releaseSiteWideOutboxEntry(entry, reason)
    expect(mockDeleteDoc).toHaveBeenCalledTimes(deletes)
    mockDeleteDoc.mockClear()
    await Outbox.releaseSiteWideOutboxEntry(entry, reason)
    expect(mockDeleteDoc).toHaveBeenCalledTimes(deletes)
  })
})
