/**
 * @jest-environment node
 */
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

/**
 * "Show to" signed-in or signed-out visitors (AGL-4231): the middleware keeps
 * each site's readable sign-in hint in step with its member session on the
 * response a page arrives in, so a member who signed in before the hint
 * existed sees "Account" on the first page they load.
 */

const TENANT_DEMO_HOST = 'localhost:4500'
const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = (async () =>
    Response.json({ locked: false, attribution: false, overQuota: false })) as typeof global.fetch
})
afterAll(() => {
  global.fetch = originalFetch
  delete process.env.AGLYN_TENANT_DEMO
})

import 'next/dist/server/node-environment-baseline'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

async function page(cookie: string) {
  process.env.AGLYN_TENANT_DEMO = 'hint-site'
  const req = new NextRequest(
    new Request(`http://${TENANT_DEMO_HOST}/pricing`, {
      headers: { host: TENANT_DEMO_HOST, ...(cookie ? { cookie } : {}) },
    }),
  )
  return (await middleware(req, {} as never)) as Response
}

const setCookies = (response: Response) =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']).filter(Boolean)

beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
})

describe('the sign-in hint follows the member session (AGL-4231)', () => {
  it('adds the hint to a page for a member session that has none', async () => {
    const cookies = setCookies(await page('aglyn_member_hint-site=hint-site.m1.9999999999999.sig'))
    const hint = cookies.find((c) => c.startsWith('aglyn_signed_in_hint-site=1'))
    expect(hint).toBeDefined()
    expect(hint).toMatch(/Path=\//)
    expect(hint).not.toMatch(/HttpOnly/i)
  })

  it('clears a hint whose session is gone', async () => {
    const cookies = setCookies(await page('aglyn_signed_in_hint-site=1'))
    expect(cookies.find((c) => c.startsWith('aglyn_signed_in_hint-site=;'))).toMatch(/Max-Age=0/)
  })

  it('CONTROL — sets nothing for a visitor with neither, or with both in step', async () => {
    expect(setCookies(await page('')).filter((c) => c.includes('aglyn_signed_in_'))).toEqual([])
    expect(
      setCookies(
        await page('aglyn_member_hint-site=hint-site.m1.9999999999999.sig; aglyn_signed_in_hint-site=1'),
      ).filter((c) => c.includes('aglyn_signed_in_')),
    ).toEqual([])
  })
})
