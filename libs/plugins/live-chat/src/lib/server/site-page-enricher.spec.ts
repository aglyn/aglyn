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

import { createLiveChatSitePageEnricher } from './site-page-enricher'

const TIDIO_KEY = 'abcdefghijklmnopqrstuvwxyz123456'
const STORED = {
  enabled: true,
  provider: 'tidio',
  publicKey: TIDIO_KEY,
  pages: 'except',
  paths: ['/checkout/*'],
  position: 'left',
  loadWithPage: false,
}

/** A site that turned Live chat on — it is off for a site until it opts in. */
const ON = { enabledPlugins: ['live-chat'] }

function enricher(stored: unknown = STORED) {
  const readSettings = jest.fn(async () => stored)
  return { readSettings, run: createLiveChatSitePageEnricher({ readSettings }) }
}

const context = (overrides: Record<string, unknown> = {}) => ({
  hostId: 'h1',
  host: ON,
  org: {},
  path: '/',
  slugSegments: [],
  ...overrides,
})

describe('the live chat page enricher (AGL-3698)', () => {
  it('reads nothing for a site that has not turned Live chat on', async () => {
    const { readSettings, run } = enricher()
    expect(await run(context({ host: {} }))).toEqual({})
    // …or whose workspace switched it off for the site.
    expect(await run(context({ host: { ...ON, disabledPlugins: ['live-chat'] } }))).toEqual({})
    expect(readSettings).not.toHaveBeenCalled()
  })

  it('hands a page the chat shows on its slice, and nothing more', async () => {
    const { readSettings, run } = enricher()
    expect(await run(context())).toEqual({
      liveChat: { provider: 'tidio', publicKey: TIDIO_KEY, position: 'left', loadWithPage: false },
    })
    expect(readSettings).toHaveBeenCalledWith('h1')
  })

  it('answers an excluded page with nothing, so the plugin is not loaded there', async () => {
    const { run } = enricher()
    expect(await run(context({ path: '/checkout/pay' }))).toEqual({})
  })

  it('answers nothing while the chat is off or its settings are unusable', async () => {
    expect(await enricher({ ...STORED, enabled: false }).run(context())).toEqual({})
    expect(await enricher({ ...STORED, publicKey: 'x' }).run(context())).toEqual({})
    expect(await enricher(null).run(context())).toEqual({})
  })

  it('names the vendor for the consent banner when the chat loads with the page', async () => {
    const answer = await enricher({ ...STORED, provider: 'livechat', publicKey: '1234567', loadWithPage: true }).run(
      context(),
    )
    expect(answer).toEqual({
      liveChat: { provider: 'livechat', publicKey: '1234567', position: 'left', loadWithPage: true },
      consentAnalyticsVendors: ['LiveChat chat'],
    })
  })

  it('gives the designed 404 body only an every-page chat', async () => {
    expect(await enricher().run(context({ pathUnknown: true }))).toEqual({})
    expect(
      await enricher({ ...STORED, pages: 'all', paths: [] }).run(context({ pathUnknown: true })),
    ).toEqual({ liveChat: expect.objectContaining({ provider: 'tidio' }) })
  })
})
