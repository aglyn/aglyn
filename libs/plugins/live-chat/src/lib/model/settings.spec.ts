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
  liveChatPathMatches,
  liveChatShowsOnPath,
  liveChatSliceForPage,
  normalizeLiveChatSettings,
  readLiveChatSlice,
  readStoredLiveChatSettings,
  type LiveChatSettings,
} from './settings'

const TIDIO_KEY = 'abcdefghijklmnopqrstuvwxyz123456'

const valid = (overrides: Partial<LiveChatSettings> = {}): LiveChatSettings => ({
  enabled: true,
  provider: 'tidio',
  publicKey: TIDIO_KEY,
  pages: 'all',
  paths: [],
  position: 'right',
  loadWithPage: false,
  ...overrides,
})

describe('live chat settings validation (AGL-3698)', () => {
  it('accepts a Tidio public key, bare or inside the pasted install code', () => {
    expect(normalizeLiveChatSettings(valid())).toEqual({ settings: valid() })
    const snippet = `<script src="//code.tidio.co/${TIDIO_KEY.toUpperCase()}.js" async></script>`
    expect(normalizeLiveChatSettings({ ...valid(), publicKey: snippet })).toEqual({ settings: valid() })
  })

  it('accepts a LiveChat license number, bare or out of its install code', () => {
    const answer = normalizeLiveChatSettings({ ...valid(), provider: 'livechat', publicKey: '12345678' })
    expect(answer).toEqual({ settings: valid({ provider: 'livechat', publicKey: '12345678' }) })
    const snippet = 'window.__lc = window.__lc || {};\nwindow.__lc.license = 12345678;'
    expect(normalizeLiveChatSettings({ ...valid(), provider: 'livechat', publicKey: snippet })).toEqual(answer)
  })

  it('refuses a key of the wrong shape, naming where to find the right one', () => {
    const tidio = normalizeLiveChatSettings({ ...valid(), publicKey: 'not a key; alert(1)' })
    expect(tidio).toEqual({ error: expect.stringContaining('Settings › Developer') })
    const livechat = normalizeLiveChatSettings({ ...valid(), provider: 'livechat', publicKey: TIDIO_KEY })
    expect(livechat).toEqual({ error: expect.stringContaining('LiveChat license number') })
  })

  it('refuses an unknown provider and turning the chat on with no key', () => {
    expect(normalizeLiveChatSettings({ ...valid(), provider: 'intercom' })).toEqual({ error: 'Choose Tidio or LiveChat.' })
    expect(normalizeLiveChatSettings({ ...valid(), publicKey: '' })).toEqual({
      error: 'Add your Tidio public key to turn the chat on.',
    })
    // Off with no key is a valid, saved state.
    expect(normalizeLiveChatSettings({ ...valid(), enabled: false, publicKey: '' })).toEqual({
      settings: valid({ enabled: false, publicKey: '' }),
    })
  })

  it('normalizes the page list and refuses what is not a page address', () => {
    expect(
      normalizeLiveChatSettings({ ...valid(), pages: 'except', paths: ['contact/', '/shop/*', '/contact', ' '] }),
    ).toEqual({ settings: valid({ pages: 'except', paths: ['/contact', '/shop/*'] }) })
    expect(normalizeLiveChatSettings({ ...valid(), pages: 'only', paths: ['/a?b=1'] })).toEqual({
      error: expect.stringContaining('is not a page address'),
    })
    expect(normalizeLiveChatSettings({ ...valid(), pages: 'only', paths: [] })).toEqual({
      error: 'List the pages the chat shows on, or choose every page.',
    })
    const tooMany = Array.from({ length: 51 }, (_, index) => `/p${index}`)
    expect(normalizeLiveChatSettings({ ...valid(), pages: 'only', paths: tooMany })).toEqual({
      error: 'List at most 50 pages.',
    })
    // "Every page" keeps no list.
    expect(normalizeLiveChatSettings({ ...valid(), pages: 'all', paths: ['/a'] })).toEqual({ settings: valid() })
  })

  it('reads a junk or hand-edited document as the chat off', () => {
    expect(readStoredLiveChatSettings(null).enabled).toBe(false)
    expect(readStoredLiveChatSettings('junk').enabled).toBe(false)
    const tampered = readStoredLiveChatSettings({ ...valid(), publicKey: 'x"></script><script>alert(1)' })
    expect(tampered.enabled).toBe(false)
    expect(readStoredLiveChatSettings({ ...valid(), updatedBy: 'uid' })).toEqual(valid())
  })
})

describe('which pages show the chat (AGL-3698)', () => {
  it('matches an exact page and a section', () => {
    expect(liveChatPathMatches('/contact', '/contact/')).toBe(true)
    expect(liveChatPathMatches('/contact', '/contact-us')).toBe(false)
    expect(liveChatPathMatches('/shop/*', '/shop')).toBe(true)
    expect(liveChatPathMatches('/shop/*', '/shop/hats/red')).toBe(true)
    expect(liveChatPathMatches('/shop/*', '/shopping')).toBe(false)
    expect(liveChatPathMatches('/*', '/anything')).toBe(true)
  })

  it('answers only, except and every page, and only "every page" without a path', () => {
    expect(liveChatShowsOnPath({ pages: 'only', paths: ['/contact'] }, '/contact')).toBe(true)
    expect(liveChatShowsOnPath({ pages: 'only', paths: ['/contact'] }, '/')).toBe(false)
    expect(liveChatShowsOnPath({ pages: 'except', paths: ['/checkout/*'] }, '/checkout/pay')).toBe(false)
    expect(liveChatShowsOnPath({ pages: 'except', paths: ['/checkout/*'] }, '/')).toBe(true)
    // The designed 404 body is cached per host: no path can be targeted.
    expect(liveChatShowsOnPath({ pages: 'except', paths: ['/x'] }, '/', true)).toBe(false)
    expect(liveChatShowsOnPath({ pages: 'all', paths: [] }, '/', true)).toBe(true)
  })

  it('puts only the provider, key, side and load mode on a page', () => {
    expect(liveChatSliceForPage(valid({ loadWithPage: true }), '/')).toEqual({
      provider: 'tidio',
      publicKey: TIDIO_KEY,
      position: 'right',
      loadWithPage: true,
    })
    expect(liveChatSliceForPage(valid({ enabled: false }), '/')).toBeNull()
    expect(liveChatSliceForPage(valid({ pages: 'only', paths: ['/contact'] }), '/')).toBeNull()
  })

  it('re-checks the slice in the browser before the key reaches a URL', () => {
    expect(readLiveChatSlice({ provider: 'tidio', publicKey: TIDIO_KEY })).toEqual({
      provider: 'tidio',
      publicKey: TIDIO_KEY,
      position: 'right',
      loadWithPage: false,
    })
    expect(readLiveChatSlice({ provider: 'tidio', publicKey: '../evil' })).toBeNull()
    expect(readLiveChatSlice({ provider: 'drift', publicKey: TIDIO_KEY })).toBeNull()
    expect(readLiveChatSlice(undefined)).toBeNull()
  })
})
