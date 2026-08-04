/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored (AGL-1139 hit this; so did an earlier tenant spec).
 *
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
 * AGL-1139: Preview renders the real site, and must not write to it.
 *
 * Giving Preview a real `hostId` is what makes thirty `if (!hostId)`
 * placeholder branches resolve into actual blocks. The same `hostId` is what
 * would let those blocks place an order, post a review, register a member or
 * book a table — from a surface whose entire job is to answer "what will this
 * look like".
 *
 * `useSiteFetch` is where that line is drawn, so this suite asserts the line
 * rather than any one block's behaviour: reads pass through untouched, writes
 * never reach the network, and OUTSIDE preview nothing changes at all. That
 * last one is the control — a guard that also fired on the live site would
 * break every real checkout while looking like it worked here.
 */

import { SiteContext, useSiteFetch, PREVIEW_WRITE_BLOCKED_EVENT } from './site-context'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

/*
 * jsdom in this repo ships NO Fetch API — not `fetch`, not `Request`, not
 * `Response` — and the shared `jest.setup.js` cannot reach Node's from inside
 * the sandbox (it assigns undefined over undefined). Running on `node` instead
 * is not an option either: `renderHook` needs a document.
 *
 * So these are local stand-ins, and the limit of what they prove is worth
 * being explicit about: this suite asserts the hook's DECISION — which calls
 * reach the network and what a refusal looks like — not the platform's
 * `Response` semantics, which are not ours to test.
 */
class StubResponse {
  readonly status: number
  readonly ok: boolean
  constructor(
    private readonly body: string,
    init?: { status?: number },
  ) {
    this.status = init?.status ?? 200
    this.ok = this.status >= 200 && this.status < 300
  }
  json() {
    return Promise.resolve(JSON.parse(this.body))
  }
}
class StubRequest {
  readonly method: string
  constructor(
    readonly url: string,
    init?: { method?: string },
  ) {
    this.method = init?.method ?? 'GET'
  }
}
;(global as unknown as Record<string, unknown>)['Response'] = StubResponse
;(global as unknown as Record<string, unknown>)['Request'] = StubRequest

const wrapper =
  (value: { hostId?: string; preview?: boolean }) =>
  ({ children }: { children: ReactNode }) =>
    createElement(SiteContext.Provider, { value }, children)

describe('useSiteFetch (AGL-1139)', () => {
  let realFetch: typeof fetch
  let calls: Array<[RequestInfo | URL, RequestInit | undefined]>

  beforeEach(() => {
    calls = []
    realFetch = global.fetch
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init])
      return Promise.resolve(new Response('{}', { status: 200 }) as never)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  it('CONTROL — outside preview every method goes to the network', async () => {
    // The assertion that keeps this from being a checkout-breaking change. If
    // the guard leaked onto the live site, the tests below would still pass.
    const { result } = renderHook(() => useSiteFetch(), {
      wrapper: wrapper({ hostId: 'h1' }),
    })
    await act(async () => {
      await result.current('/api/commerce/cart', { method: 'POST' })
      await result.current('/api/commerce/catalog')
    })
    expect(calls).toHaveLength(2)
  })

  it('lets reads through in preview — that is the whole point of the fix', async () => {
    const { result } = renderHook(() => useSiteFetch(), {
      wrapper: wrapper({ hostId: 'h1', preview: true }),
    })
    await act(async () => {
      await result.current('/api/commerce/catalog?hostId=h1')
      await result.current('/api/commerce/catalog', { method: 'GET' })
      await result.current('/api/commerce/catalog', { method: 'head' })
    })
    expect(calls).toHaveLength(3)
  })

  it('refuses a write in preview without making the request', async () => {
    const { result } = renderHook(() => useSiteFetch(), {
      wrapper: wrapper({ hostId: 'h1', preview: true }),
    })
    let response: Response | undefined
    await act(async () => {
      response = await result.current('/api/commerce/cart', { method: 'POST' })
    })
    // Not "the request failed" — the request was never made. A preview that
    // reaches the server and is rejected there still books the table if any
    // route ever forgets to check.
    expect(calls).toHaveLength(0)
    expect(response?.ok).toBe(false)
    expect(response?.status).toBe(423)
    await expect(response?.json()).resolves.toMatchObject({ preview: true })
  })

  it('covers every unsafe method, not just POST', async () => {
    const { result } = renderHook(() => useSiteFetch(), {
      wrapper: wrapper({ hostId: 'h1', preview: true }),
    })
    await act(async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete']) {
        await result.current('/api/x', { method })
      }
    })
    expect(calls).toHaveLength(0)
  })

  it('reads the method off a Request object, not just the init', async () => {
    // `fetch(new Request(url, {method: 'POST'}))` is a legal call shape. Keying
    // only on `init.method` would default it to GET and let it straight past.
    const { result } = renderHook(() => useSiteFetch(), {
      wrapper: wrapper({ hostId: 'h1', preview: true }),
    })
    await act(async () => {
      await result.current(
        new Request('https://example.test/api/x', { method: 'POST' }),
      )
    })
    expect(calls).toHaveLength(0)
  })

  it('announces the refusal so one surface can explain it once', async () => {
    const seen: Event[] = []
    const handler = (event: Event) => seen.push(event)
    window.addEventListener(PREVIEW_WRITE_BLOCKED_EVENT, handler)
    const { result } = renderHook(() => useSiteFetch(), {
      wrapper: wrapper({ hostId: 'h1', preview: true }),
    })
    await act(async () => {
      await result.current('/api/commerce/cart', { method: 'POST' })
    })
    window.removeEventListener(PREVIEW_WRITE_BLOCKED_EVENT, handler)
    // Without this the click is indistinguishable from the broken button
    // AGL-1139 was filed about: nothing happens and nothing says why.
    expect(seen).toHaveLength(1)
  })
})
