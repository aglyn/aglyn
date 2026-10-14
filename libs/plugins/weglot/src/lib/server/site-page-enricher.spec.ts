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

import { WEGLOT_PAGE_PROP } from '../constants'
import { createWeglotSitePageEnricher } from './site-page-enricher'

const config = {
  enabled: true,
  apiKey: 'wg_0123456789abcdef0123456789abcdef',
  sourceLanguage: 'en',
  targetLanguages: 'fr,es',
  switcher: 'weglot',
  switcherPosition: 'bottom-right',
}

/** A site that switched the plugin on, which it is not by default. */
const switchedOn = { orgId: 'org-1', enabledPlugins: ['weglot'] }
const business = { plan: 'business' }

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    hostId: 'host-1',
    host: switchedOn,
    org: business,
    path: '/',
    slugSegments: [],
    ...overrides,
  }) as never

describe('the Weglot page enricher (AGL-3700)', () => {
  it('hands the page the checked settings for a switched-on, entitled, enabled site', async () => {
    const read = jest.fn(async () => config)
    const enrich = createWeglotSitePageEnricher(read)
    await expect(enrich(context())).resolves.toEqual({
      [WEGLOT_PAGE_PROP]: {
        apiKey: config.apiKey,
        sourceLanguage: 'en',
        targetLanguages: ['fr', 'es'],
        switcher: 'weglot',
        switcherPosition: 'bottom-right',
      },
    })
    expect(read).toHaveBeenCalledWith('org-1', 'host-1')
  })

  it('reads nothing on a site that never switched it on', async () => {
    const read = jest.fn(async () => config)
    const enrich = createWeglotSitePageEnricher(read)
    await expect(enrich(context({ host: { orgId: 'org-1' } }))).resolves.toEqual({})
    await expect(
      enrich(context({ host: { ...switchedOn, disabledPlugins: ['weglot'] } })),
    ).resolves.toEqual({})
    expect(read).not.toHaveBeenCalled()
  })

  it('reads nothing on a plan without multilingual', async () => {
    const read = jest.fn(async () => config)
    const enrich = createWeglotSitePageEnricher(read)
    for (const org of [{ plan: 'free' }, { plan: 'pro' }, null]) {
      await expect(enrich(context({ org }))).resolves.toEqual({})
    }
    expect(read).not.toHaveBeenCalled()
  })

  it('adds nothing when the settings are off or unusable', async () => {
    for (const stored of [
      { ...config, enabled: false },
      { ...config, apiKey: 'not-a-key' },
      { ...config, targetLanguages: 'en' },
      {},
    ]) {
      const enrich = createWeglotSitePageEnricher(async () => stored)
      await expect(enrich(context())).resolves.toEqual({})
    }
  })

  it('drops the slice, not the page, when the settings cannot be read', async () => {
    const enrich = createWeglotSitePageEnricher(async () => {
      throw new Error('firestore unavailable')
    })
    await expect(enrich(context())).resolves.toEqual({})
  })

  it('answers the designed 404 too: the slice is path-independent', async () => {
    const enrich = createWeglotSitePageEnricher(async () => config)
    const result = await enrich(context({ pathUnknown: true, path: '' }))
    expect(result).toHaveProperty(WEGLOT_PAGE_PROP)
  })
})
