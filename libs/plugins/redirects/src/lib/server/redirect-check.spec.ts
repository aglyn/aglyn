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

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: { app: () => { throw new Error('no admin in this spec') } } }))

import { checkRedirectSave, redirectCheckHandler } from './redirect-check'

const host = { subdomain: 'shop', cname: 'shop.example', screens: { about: 'about' } }

function reply() {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (body: unknown) => { res.body = body; return res }
  return res
}

describe('checkRedirectSave: the Redirects page save checks, in its words', () => {
  it('normalizes and answers the rule as the page stores it', () => {
    expect(checkRedirectSave({ source: 'old-page', destination: '/new-page', statusCode: 301 }, host, [])).toEqual({
      ok: true,
      source: '/old-page',
      destination: '/new-page',
      statusCode: 301,
      kind: 'exact',
      notice: null,
    })
  })

  it('falls back to 302 for a status code the page does not offer', () => {
    expect(checkRedirectSave({ source: '/a', destination: '/b', statusCode: 200 }, host, [])).toMatchObject({ ok: true, statusCode: 302 })
  })

  it('refuses what validateRedirectRule refuses', () => {
    expect(checkRedirectSave({ source: '', destination: '/b' }, host, [])).toEqual({ ok: false, problem: 'Enter a site path like /old-page' })
    expect(checkRedirectSave({ source: '/a', destination: 'http://x.example' }, host, [])).toEqual({
      ok: false,
      problem: 'Destinations are internal paths or https:// URLs',
    })
    expect(checkRedirectSave({ kind: 'nope', source: '/a', destination: '/b' }, host, [])).toEqual({ ok: false, problem: 'Unknown match mode' })
  })

  it('refuses a path redirected to itself, a duplicate and a loop', () => {
    expect(checkRedirectSave({ source: '/a', destination: '/a' }, host, [])).toEqual({ ok: false, problem: 'That would redirect the path to itself' })
    const rules = [{ $id: 'r1', source: '/a', destination: '/b', kind: 'exact' }]
    expect(checkRedirectSave({ source: '/a', destination: '/c' }, host, rules)).toEqual({ ok: false, problem: 'A rule for /a already exists' })
    expect(checkRedirectSave({ id: 'r1', source: '/a', destination: '/c' }, host, rules)).toMatchObject({ ok: true })
    expect(checkRedirectSave({ source: '/b', destination: '/a' }, host, rules)).toEqual({
      ok: false,
      problem: 'That destination chains back to this rule — a redirect loop',
    })
  })

  it('warns, without refusing, when the from-path is a published page', () => {
    expect(checkRedirectSave({ source: '/about', destination: '/team' }, host, [])).toMatchObject({
      ok: true,
      notice: '/about is a published page — the redirect takes precedence',
    })
  })

  it('ignores soft-deleted rules', () => {
    const rules = [{ $id: 'r1', source: '/a', destination: '/b', kind: 'exact', deletedAt: 1 }]
    expect(checkRedirectSave({ source: '/a', destination: '/c' }, host, rules)).toMatchObject({ ok: true })
  })
})

describe('redirectCheckHandler', () => {
  it('answers only POST, and only with an ID token', async () => {
    const get = reply()
    await redirectCheckHandler({ method: 'GET', headers: {} } as any, get)
    expect(get.statusCode).toBe(405)
    const anonymous = reply()
    await redirectCheckHandler({ method: 'POST', headers: {}, body: { hostId: 'h1' } } as any, anonymous)
    expect(anonymous.statusCode).toBe(401)
  })

  it('refuses a request with no site', async () => {
    const res = reply()
    await redirectCheckHandler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: {} } as any, res)
    expect(res.statusCode).toBe(400)
  })
})
