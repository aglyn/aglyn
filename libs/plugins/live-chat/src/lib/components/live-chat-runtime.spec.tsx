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

import { resetPageIdleForTests } from '@aglyn/aglyn/app-utils/page-idle'
import {
  VISITOR_CONSENT_CHANGED_EVENT,
  visitorConsentStorageKey,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LIVE_CHAT_SCRIPT_ATTRIBUTE, LIVE_CHAT_SESSION_KEY_PREFIX } from '../constants'
import { resetLiveChatLoaderForTests, type LiveChatWindow } from '../loader'
import type { LiveChatSlice } from '../model/settings'
import { LiveChatRuntime } from './live-chat-runtime'

const HOST = 'h1'
const TIDIO_KEY = 'abcdefghijklmnopqrstuvwxyz123456'
const win = window as LiveChatWindow

const slice = (overrides: Partial<LiveChatSlice> = {}): LiveChatSlice => ({
  provider: 'tidio',
  publicKey: TIDIO_KEY,
  position: 'right',
  loadWithPage: false,
  ...overrides,
})

const ourScripts = () =>
  Array.from(document.querySelectorAll<HTMLScriptElement>(`script[${LIVE_CHAT_SCRIPT_ATTRIBUTE}]`))

/** The page has loaded and gone idle (`page-idle.ts` falls back to a timeout in jsdom). */
const idle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 5)))

function grantAnalytics(analytics: boolean) {
  window.localStorage.setItem(
    visitorConsentStorageKey(HOST),
    JSON.stringify({ v: 1, at: Date.now(), status: analytics ? 'accepted' : 'declined', analytics }),
  )
  window.dispatchEvent(new Event(VISITOR_CONSENT_CHANGED_EVENT))
}

beforeEach(() => {
  resetPageIdleForTests()
  resetLiveChatLoaderForTests()
  document.body.innerHTML = ''
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete win.tidioChatApi
  delete win.LiveChatWidget
  delete win.__lc
})

describe('the live chat runtime (AGL-3698)', () => {
  it('renders nothing on the server and nothing before the page is idle — no button, no script', () => {
    expect(renderToString(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice() }} />)).toBe('')
    render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice() }} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(ourScripts()).toHaveLength(0)
  })

  it('draws the launcher once idle and still loads nothing until it is pressed', async () => {
    render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice() }} />)
    await idle()
    expect(screen.getByRole('button', { name: 'Chat with us' })).toBeTruthy()
    expect(ourScripts()).toHaveLength(0)
  })

  it('loads the chosen provider’s widget on a press, opens it, and steps aside', async () => {
    render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice() }} />)
    await idle()
    fireEvent.click(screen.getByRole('button', { name: 'Chat with us' }))
    expect(ourScripts().map((script) => script.src)).toEqual([`https://code.tidio.co/${TIDIO_KEY}.js`])
    expect(window.sessionStorage.getItem(`${LIVE_CHAT_SESSION_KEY_PREFIX}${HOST}`)).toBe('1')
    win.tidioChatApi = { open: jest.fn(), show: jest.fn(), hide: jest.fn() }
    await act(async () => {
      document.dispatchEvent(new Event('tidioChat-ready'))
    })
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
    expect(win.tidioChatApi.open).toHaveBeenCalled()
  })

  it('loads LiveChat’s loader, not Tidio’s, for a LiveChat site', async () => {
    render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice({ provider: 'livechat', publicKey: '12345678' }) }} />)
    await idle()
    fireEvent.click(screen.getByRole('button', { name: 'Chat with us' }))
    expect(ourScripts().map((script) => script.src)).toEqual(['https://cdn.livechatinc.com/tracking.js'])
  })

  it('keeps the chat for a visitor who opened it earlier in the tab', async () => {
    window.sessionStorage.setItem(`${LIVE_CHAT_SESSION_KEY_PREFIX}${HOST}`, '1')
    render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice() }} />)
    expect(ourScripts()).toHaveLength(0)
    await idle()
    expect(ourScripts()).toHaveLength(1)
  })

  describe('"Load the chat with the page"', () => {
    it('waits for an analytics grant, however idle the page is', async () => {
      render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice({ loadWithPage: true }) }} />)
      await idle()
      expect(ourScripts()).toHaveLength(0)
      await act(async () => grantAnalytics(false))
      expect(ourScripts()).toHaveLength(0)
      await act(async () => grantAnalytics(true))
      expect(ourScripts()).toHaveLength(1)
    })

    it('takes the widget back off the page when the grant is withdrawn', async () => {
      grantAnalytics(true)
      render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice({ loadWithPage: true }) }} />)
      await idle()
      expect(ourScripts()).toHaveLength(1)
      window.localStorage.setItem(`tidio_state_${TIDIO_KEY}`, '{}')
      await act(async () => grantAnalytics(false))
      expect(ourScripts()).toHaveLength(0)
      expect(window.localStorage.getItem(`tidio_state_${TIDIO_KEY}`)).toBeNull()
      expect(screen.getByRole('button', { name: 'Chat with us' })).toBeTruthy()
    })

    it('never loads without a slice that asked for it', async () => {
      grantAnalytics(true)
      render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice({ loadWithPage: false }) }} />)
      await idle()
      expect(ourScripts()).toHaveLength(0)
    })
  })

  it('renders nothing where the page carries no chat — an excluded page, or the console preview', async () => {
    const { container, rerender } = render(<LiveChatRuntime hostId={HOST} page={{}} />)
    await idle()
    expect(container.innerHTML).toBe('')
    rerender(<LiveChatRuntime hostId={HOST} page={{ liveChat: { provider: 'tidio', publicKey: 'bad key' } }} />)
    expect(container.innerHTML).toBe('')
    expect(ourScripts()).toHaveLength(0)
  })

  it('hides a loaded widget on a page the chat is not on, and shows it again where it is', async () => {
    const show = jest.fn()
    const hide = jest.fn()
    const { rerender } = render(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice() }} />)
    await idle()
    fireEvent.click(screen.getByRole('button', { name: 'Chat with us' }))
    win.tidioChatApi = { open: jest.fn(), show, hide }
    await act(async () => {
      document.dispatchEvent(new Event('tidioChat-ready'))
    })
    rerender(<LiveChatRuntime hostId={HOST} page={{}} />)
    expect(hide).toHaveBeenCalled()
    rerender(<LiveChatRuntime hostId={HOST} page={{ liveChat: slice() }} />)
    expect(show).toHaveBeenCalled()
    expect(ourScripts()).toHaveLength(1)
  })
})
