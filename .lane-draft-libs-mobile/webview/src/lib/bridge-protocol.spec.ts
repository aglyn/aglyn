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
  bridgeInjectionScript,
  bridgeReplyScript,
  createBridgeNonce,
  isTrustedUrl,
  originOf,
  parseBridgeMessage,
} from './bridge-protocol'

const TRUSTED = ['https://app.aglyn.com']
const NONCE = 'n'.repeat(32)
const METHODS = ['collectCardPayment', 'cancel', 'readerStatus']

function message(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ aglynBridge: 1, nonce: NONCE, id: 'c1_x', method: 'readerStatus', params: {}, ...overrides })
}

function parse(data: string, sourceUrl = 'https://app.aglyn.com/acme/hosts/shop/pos') {
  return parseBridgeMessage({ data, sourceUrl, trustedOrigins: TRUSTED, nonce: NONCE, methods: METHODS })
}

describe('originOf / isTrustedUrl', () => {
  it('normalizes scheme, case and default ports', () => {
    expect(originOf('HTTPS://App.Aglyn.com:443/x?y#z')).toBe('https://app.aglyn.com')
    expect(originOf('http://localhost:4200/pos')).toBe('http://localhost:4200')
  })

  it.each([
    'https://app.aglyn.com.evil.com/pos',
    'https://evil.com/?https://app.aglyn.com',
    'https://app.aglyn.com@evil.com/pos',
    'https://shop.aglyn.com/pos',
    'http://app.aglyn.com/pos',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '',
    null,
  ])('refuses %p', (url) => {
    expect(isTrustedUrl(url as string, TRUSTED)).toBe(false)
  })

  it('admits the exact console origin', () => {
    expect(isTrustedUrl('https://app.aglyn.com/acme/hosts/shop/pos', TRUSTED)).toBe(true)
  })
})

describe('parseBridgeMessage', () => {
  it('accepts a well-formed call from the console', () => {
    expect(parse(message({ method: 'collectCardPayment', params: { paymentIntentId: 'pi_1' } }))).toEqual({
      ok: true,
      request: { id: 'c1_x', method: 'collectCardPayment', params: { paymentIntentId: 'pi_1' } },
    })
  })

  it('drops a message from any other origin, whatever it claims', () => {
    expect(parse(message(), 'https://evil.example/pos')).toEqual({ ok: false, reason: 'untrusted-origin' })
  })

  it('drops a message without the injected nonce', () => {
    expect(parse(message({ nonce: 'guess' }))).toEqual({ ok: false, reason: 'bad-nonce' })
    expect(parse(message({ nonce: undefined }))).toEqual({ ok: false, reason: 'bad-nonce' })
  })

  it('refuses a method off the allowlist, naming the call so it can be answered', () => {
    expect(parse(message({ method: 'openUrl' }))).toEqual({ ok: false, reason: 'unknown-method', id: 'c1_x' })
    expect(parse(message({ method: '__proto__' }))).toEqual({ ok: false, reason: 'malformed', id: 'c1_x' })
  })

  it.each([
    ['not json', 'nope'],
    ['an array', '[]'],
    ['no marker', JSON.stringify({ nonce: NONCE, id: 'a', method: 'cancel' })],
    ['a bad id', message({ id: 'a b' })],
    ['array params', message({ params: [1] })],
    ['an oversized body', message({ params: { pad: 'x'.repeat(20_000) } })],
  ])('refuses %s', (_label, data) => {
    expect(parse(data).ok).toBe(false)
  })
})

describe('createBridgeNonce', () => {
  it('is 32 characters from the alphabet', () => {
    expect(createBridgeNonce()).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(createBridgeNonce(() => 0)).toBe('a'.repeat(32))
  })
})

/** Runs an injected script against a fake page, as the WebView would. */
function runInPage(script: string, origin = 'https://app.aglyn.com') {
  const posted: string[] = []
  const events: string[] = []
  const window: Record<string, any> = {
    location: { origin },
    ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    dispatchEvent: (event: { type: string }) => events.push(event.type),
  }
  class FakeEvent {
    type: string
    constructor(type: string) {
      this.type = type
    }
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'Event', script)(window, FakeEvent)
  return { window, posted, events }
}

describe('bridgeInjectionScript', () => {
  const script = bridgeInjectionScript({
    globalName: 'AglynPosBridge',
    nonce: NONCE,
    methods: METHODS,
    trustedOrigins: TRUSTED,
    info: { platform: 'ios' },
  })

  it('defines exactly the allowed methods, posting the nonce with each call', async () => {
    const page = runInPage(script)
    const bridge = page.window['AglynPosBridge']
    expect(Object.keys(bridge).sort()).toEqual([...METHODS, 'info'].sort())
    expect(bridge.info).toEqual({ platform: 'ios' })
    expect(page.events).toEqual(['AglynPosBridge:ready'])

    const pending = bridge.readerStatus({ a: 1 })
    const sent = JSON.parse(page.posted[0])
    expect(sent).toMatchObject({ aglynBridge: 1, nonce: NONCE, method: 'readerStatus', params: { a: 1 } })
    expect(parse(page.posted[0]).ok).toBe(true)

    // The reply script resolves the call it names.
    new Function('window', bridgeReplyScript('AglynPosBridge', { id: sent.id, ok: true, result: { connected: true } }))(
      page.window,
    )
    await expect(pending).resolves.toEqual({ connected: true })
  })

  it('rejects a call the app refused, with its words', async () => {
    const page = runInPage(script)
    const pending = page.window['AglynPosBridge'].cancel()
    const { id } = JSON.parse(page.posted[0])
    new Function('window', bridgeReplyScript('AglynPosBridge', { id, ok: false, error: 'No reader' }))(page.window)
    await expect(pending).rejects.toThrow('No reader')
  })

  it('cannot be replaced by page code', () => {
    const page = runInPage(script)
    const original = page.window['AglynPosBridge']
    expect(() => {
      'use strict'
      Object.defineProperty(page.window, 'AglynPosBridge', { value: {} })
    }).toThrow()
    expect(page.window['AglynPosBridge']).toBe(original)
    expect(Object.isFrozen(original)).toBe(true)
  })

  it('defines nothing on a page from another origin', () => {
    const page = runInPage(script, 'https://evil.example')
    expect(page.window['AglynPosBridge']).toBeUndefined()
  })

  it('refuses a method name that is not an identifier', () => {
    expect(() =>
      bridgeInjectionScript({ globalName: 'X', nonce: NONCE, methods: ['a;alert(1)'], trustedOrigins: TRUSTED }),
    ).toThrow('Invalid bridge method name')
  })
})

describe('bridgeReplyScript', () => {
  it('cannot break out of the call it sits in', () => {
    const script = bridgeReplyScript('AglynPosBridge', {
      id: 'c1',
      ok: false,
      error: '"});alert(1);// </script>',
    })
    expect(script).not.toContain(' ')
    const replies: unknown[] = []
    new Function('window', script)({ AglynPosBridge: { __reply: (reply: unknown) => replies.push(reply) } })
    expect(replies).toEqual([{ id: 'c1', ok: false, error: '"});alert(1);// </script>' }])
  })
})
