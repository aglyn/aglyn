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

import { act, render } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { bridgeReplyScript } from './bridge-protocol'
import { ConsoleWebView, isSignedOutUrl } from './console-webview'

type CapturedProps = Record<string, any>
const captured: { props: CapturedProps; injected: string[] } = { props: {}, injected: [] }

jest.mock('react-native-webview', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react')
  return {
    WebView: forwardRef((props: Record<string, unknown>, ref: unknown) => {
      captured.props = props
      useImperativeHandle(ref, () => ({
        injectJavaScript: (script: string) => captured.injected.push(script),
        reload: jest.fn(),
        goBack: jest.fn(),
      }))
      return null
    }),
  }
})

const TRUSTED = ['https://app.aglyn.com']
const POS = 'https://app.aglyn.com/acme/hosts/shop/pos'

function nonceOf(script: string): string {
  return /nonce: "([A-Za-z0-9]+)"/.exec(script)?.[1] ?? ''
}

async function send(data: Record<string, unknown>, url = POS) {
  await act(async () => {
    captured.props['onMessage']({ nativeEvent: { data: JSON.stringify(data), url } })
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ConsoleWebView', () => {
  beforeEach(() => {
    captured.injected = []
  })

  function mount(handlers = { readerStatus: jest.fn(async () => ({ connected: true })) }) {
    render(<ConsoleWebView url={POS} trustedOrigins={TRUSTED} bridgeName="AglynPosBridge" handlers={handlers} />)
    const nonce = nonceOf(captured.props['injectedJavaScriptBeforeContentLoaded'])
    return { handlers, nonce }
  }

  it('injects a bridge for exactly the handler methods, main frame only, with shared cookies', () => {
    const { nonce } = mount()
    expect(nonce).toHaveLength(32)
    expect(captured.props['injectedJavaScriptBeforeContentLoaded']).toContain('["readerStatus"]')
    expect(captured.props['injectedJavaScriptBeforeContentLoadedForMainFrameOnly']).toBe(true)
    expect(captured.props['sharedCookiesEnabled']).toBe(true)
    expect(captured.props['allowFileAccess']).toBe(false)
  })

  it('runs a trusted call and replies into the page', async () => {
    const { handlers, nonce } = mount()
    captured.props['onNavigationStateChange']({ url: POS, canGoBack: false })
    await send({ aglynBridge: 1, nonce, id: 'c1', method: 'readerStatus', params: {} })
    expect(handlers.readerStatus).toHaveBeenCalledWith({})
    expect(captured.injected).toEqual([
      bridgeReplyScript('AglynPosBridge', { id: 'c1', ok: true, result: { connected: true } }),
    ])
  })

  it('ignores a forged or foreign call', async () => {
    const { handlers, nonce } = mount()
    await send({ aglynBridge: 1, nonce: 'x'.repeat(32), id: 'c1', method: 'readerStatus' })
    await send({ aglynBridge: 1, nonce, id: 'c2', method: 'readerStatus' }, 'https://evil.example/')
    expect(handlers.readerStatus).not.toHaveBeenCalled()
    expect(captured.injected).toEqual([])
  })

  it('refuses an unknown method with an answer, not a hang', async () => {
    const { nonce } = mount()
    await send({ aglynBridge: 1, nonce, id: 'c3', method: 'openSettings' })
    expect(captured.injected[0]).toContain('"ok":false')
  })

  it('does not hand an answer to a page that navigated off the console', async () => {
    let finish: (value: unknown) => void = () => undefined
    const slow = jest.fn(() => new Promise((resolve) => (finish = resolve)))
    const { nonce } = mount({ readerStatus: slow })
    await send({ aglynBridge: 1, nonce, id: 'c4', method: 'readerStatus' })
    captured.props['onNavigationStateChange']({ url: 'https://evil.example/', canGoBack: true })
    await act(async () => {
      finish({ connected: true })
      await Promise.resolve()
    })
    expect(captured.injected).toEqual([])
  })

  it('keeps foreign top-level navigation out of the WebView', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    mount()
    const allow = captured.props['onShouldStartLoadWithRequest']
    expect(allow({ url: `${POS}?x=1`, isTopFrame: true })).toBe(true)
    expect(allow({ url: 'https://stripe.com/legal', isTopFrame: true })).toBe(false)
    expect(open).toHaveBeenCalledWith('https://stripe.com/legal')
    expect(allow({ url: 'javascript:alert(1)', isTopFrame: true })).toBe(false)
    expect(allow({ url: 'https://js.stripe.com/frame', isTopFrame: false })).toBe(true)
  })

  it('recognizes the console sign-in page as a lost session', () => {
    expect(isSignedOutUrl('https://app.aglyn.com/signin?continue=/x')).toBe(true)
    expect(isSignedOutUrl(POS)).toBe(false)
  })
})
