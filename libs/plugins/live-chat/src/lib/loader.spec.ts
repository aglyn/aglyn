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

import { LIVE_CHAT_SCRIPT_ATTRIBUTE } from './constants'
import {
  liveChatLoadedProvider,
  loadLiveChat,
  removeLiveChat,
  resetLiveChatLoaderForTests,
  setLiveChatVisible,
  sweepLiveChatStorage,
  type LiveChatWindow,
} from './loader'

const TIDIO_KEY = 'abcdefghijklmnopqrstuvwxyz123456'
const win = window as LiveChatWindow

const ourScripts = () =>
  Array.from(document.querySelectorAll<HTMLScriptElement>(`script[${LIVE_CHAT_SCRIPT_ATTRIBUTE}]`))

beforeEach(() => {
  resetLiveChatLoaderForTests()
  document.body.innerHTML = ''
  delete win.tidioChatApi
  delete win.LiveChatWidget
  delete win.__lc
  window.localStorage.clear()
})

describe('the live chat loader (AGL-3698)', () => {
  it('adds Tidio’s script for the key, and opens the chat once Tidio says it is ready', async () => {
    const loaded = loadLiveChat(
      { provider: 'tidio', publicKey: TIDIO_KEY, position: 'right', loadWithPage: false },
      { open: true },
    )
    expect(ourScripts().map((script) => [script.src, script.async, script.getAttribute(LIVE_CHAT_SCRIPT_ATTRIBUTE)])).toEqual([
      [`https://code.tidio.co/${TIDIO_KEY}.js`, true, 'tidio'],
    ])
    expect(liveChatLoadedProvider()).toBe('tidio')
    const api = { open: jest.fn(), show: jest.fn(), hide: jest.fn() }
    win.tidioChatApi = api
    document.dispatchEvent(new Event('tidioChat-ready'))
    await loaded
    expect(api.open).toHaveBeenCalledTimes(1)
  })

  it('adds the script once however often it is asked', async () => {
    const slice = { provider: 'tidio' as const, publicKey: TIDIO_KEY, position: 'right' as const, loadWithPage: false }
    const first = loadLiveChat(slice)
    const second = loadLiveChat(slice)
    expect(ourScripts()).toHaveLength(1)
    document.dispatchEvent(new Event('tidioChat-ready'))
    await Promise.all([first, second])
  })

  it('sets LiveChat’s license and command queue before its loader, and maximizes on a press', async () => {
    const loaded = loadLiveChat(
      { provider: 'livechat', publicKey: '12345678', position: 'right', loadWithPage: false },
      { open: true },
    )
    expect(win.__lc).toMatchObject({ license: 12345678, integration_name: 'aglyn', product_name: 'livechat' })
    expect(ourScripts().map((script) => script.src)).toEqual(['https://cdn.livechatinc.com/tracking.js'])
    // tracking.js replays the queue; the `ready` listener is in it.
    const queued = win.LiveChatWidget?._q as Array<[string, unknown[]]>
    expect(queued[0][0]).toBe('on')
    expect(queued[0][1][0]).toBe('ready')
    ;(queued[0][1][1] as () => void)()
    await loaded
    expect(queued.at(-1)).toEqual(['call', ['maximize']])
  })

  it('refuses settings that would put a junk key in a URL, adding nothing', async () => {
    await expect(
      loadLiveChat({ provider: 'tidio', publicKey: '"><script>', position: 'right', loadWithPage: false }),
    ).rejects.toThrow('unusable settings')
    expect(ourScripts()).toHaveLength(0)
  })

  it('gives up when the vendor never answers, so a later press can try again', async () => {
    jest.useFakeTimers()
    try {
      const slice = { provider: 'tidio' as const, publicKey: TIDIO_KEY, position: 'right' as const, loadWithPage: false }
      const loaded = loadLiveChat(slice, { timeoutMs: 1000 })
      jest.advanceTimersByTime(1001)
      await expect(loaded).rejects.toThrow('did not load in time')
    } finally {
      jest.useRealTimers()
    }
  })

  it('rejects when the script cannot be reached (an ad blocker, an outage)', async () => {
    const loaded = loadLiveChat({ provider: 'tidio', publicKey: TIDIO_KEY, position: 'right', loadWithPage: false })
    ourScripts()[0].dispatchEvent(new Event('error'))
    await expect(loaded).rejects.toThrow('Tidio could not be reached')
  })

  it('hides and shows a loaded widget through the vendor’s own API', () => {
    win.tidioChatApi = { show: jest.fn(), hide: jest.fn() }
    setLiveChatVisible('tidio', false)
    setLiveChatVisible('tidio', true)
    expect(win.tidioChatApi.hide).toHaveBeenCalledTimes(1)
    expect(win.tidioChatApi.show).toHaveBeenCalledTimes(1)
    const call = jest.fn()
    win.LiveChatWidget = { call }
    setLiveChatVisible('livechat', false)
    setLiveChatVisible('livechat', true)
    expect(call.mock.calls).toEqual([['hide'], ['minimize']])
  })

  it('takes a widget back off the page: our script, its elements and its storage, nobody else’s', () => {
    const ours = document.createElement('script')
    ours.setAttribute(LIVE_CHAT_SCRIPT_ATTRIBUTE, 'tidio')
    const merchants = document.createElement('script')
    merchants.src = 'https://code.tidio.co/other.js'
    const frame = document.createElement('div')
    frame.id = 'tidio-chat'
    document.body.append(ours, merchants, frame)
    window.localStorage.setItem(`tidio_state_${TIDIO_KEY}`, '{}')
    window.localStorage.setItem('aglyn:consent:h1', '{}')
    document.cookie = 'tidio_token=abc; path=/'
    removeLiveChat('tidio')
    expect(ourScripts()).toHaveLength(0)
    expect(document.body.contains(merchants)).toBe(true)
    expect(document.getElementById('tidio-chat')).toBeNull()
    expect(window.localStorage.getItem(`tidio_state_${TIDIO_KEY}`)).toBeNull()
    expect(window.localStorage.getItem('aglyn:consent:h1')).toBe('{}')
    expect(document.cookie).not.toContain('tidio_token')
  })

  it('sweeps LiveChat’s cookies by prefix and leaves everything else', () => {
    document.cookie = '__lc_cid=1; path=/'
    document.cookie = 'cart=2; path=/'
    expect(sweepLiveChatStorage(['__lc'])).toEqual(['__lc_cid'])
    expect(document.cookie).toContain('cart=2')
  })
})
