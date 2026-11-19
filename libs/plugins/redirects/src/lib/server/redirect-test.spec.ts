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

const admin = {
  uid: 'u1',
  host: { exists: true, memberRoles: { u1: 'viewer' } as Record<string, string> },
  rules: [] as Array<{ id: string; data: Record<string, unknown> }>,
  limit: 0,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: admin.uid }) }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: admin.host.exists,
              get: (field: string) => (field === 'memberRoles' ? admin.host.memberRoles : undefined),
            }),
            collection: () => ({
              limit: (n: number) => {
                admin.limit = n
                return { get: async () => ({ docs: admin.rules.map((rule) => ({ id: rule.id, data: () => rule.data })) }) }
              },
            }),
          }),
        }),
      }),
    }),
  },
}))

import { redirectTestHandler, testRedirectPath } from './redirect-test'

function reply() {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  return res
}

const post = (body: unknown, authorization = 'Bearer t') => ({ method: 'POST', headers: { authorization }, body }) as any

describe('testRedirectPath: the Redirects page tester, in its words', () => {
  const rules = [
    { $id: 'r1', source: '/old-page', destination: '/new-page', statusCode: 301, kind: 'exact' },
    { $id: 'r2', source: '/shop', destination: '/store', statusCode: 302, kind: 'prefix' },
    { $id: 'r3', source: '^/blog/(\\d+)$', destination: '/posts/$1', statusCode: 308, kind: 'regex' },
  ]

  it('normalizes the typed path as a from-path, then answers the rule that fires', () => {
    expect(testRedirectPath(rules, ' Old-Page/ ')).toEqual({
      path: '/old-page',
      match: { destination: '/new-page', statusCode: 301 },
      text: '→ /new-page (301)',
    })
    expect(testRedirectPath(rules, '/shop/hats').text).toBe('→ /store (302)')
  })

  it('runs pattern rules through the serve path matcher, groups substituted', () => {
    expect(testRedirectPath(rules, '/blog/42').text).toBe('→ /posts/42 (308)')
  })

  it('says No rule matches, and skips switched-off and deleted rules', () => {
    expect(testRedirectPath(rules, '/nothing-here')).toEqual({ path: '/nothing-here', match: null, text: 'No rule matches' })
    const off = [
      { $id: 'a', source: '/a', destination: '/b', kind: 'exact', enabled: false },
      { $id: 'c', source: '/c', destination: '/d', kind: 'exact', deletedAt: 1 },
    ]
    expect(testRedirectPath(off, '/a').text).toBe('No rule matches')
    expect(testRedirectPath(off, '/c').text).toBe('No rule matches')
  })

  it('keeps what was typed when it is not a from-path', () => {
    expect(testRedirectPath(rules, 'https://x.example/a').path).toBe('https://x.example/a')
  })
})

describe('redirectTestHandler', () => {
  beforeEach(() => {
    admin.uid = 'u1'
    admin.host = { exists: true, memberRoles: { u1: 'viewer' } }
    admin.rules = [{ id: 'r1', data: { source: '/old-page', destination: '/new-page', statusCode: 301, kind: 'exact' } }]
  })

  it('answers only POST, only with an ID token, and only for a site and a path', async () => {
    const get = reply()
    await redirectTestHandler({ method: 'GET', headers: {} } as any, get)
    expect(get.statusCode).toBe(405)
    const anonymous = reply()
    await redirectTestHandler(post({ hostId: 'h1', path: '/a' }, ''), anonymous)
    expect(anonymous.statusCode).toBe(401)
    const noSite = reply()
    await redirectTestHandler(post({ path: '/a' }), noSite)
    expect(noSite.statusCode).toBe(400)
    const noPath = reply()
    await redirectTestHandler(post({ hostId: 'h1', path: '  ' }), noPath)
    expect(noPath.statusCode).toBe(400)
  })

  it('answers any member of the site over the page window of rules', async () => {
    const res = reply()
    await redirectTestHandler(post({ hostId: 'h1', path: '/old-page' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ path: '/old-page', match: { destination: '/new-page', statusCode: 301 }, text: '→ /new-page (301)' })
    expect(admin.limit).toBe(200)
  })

  it('refuses someone who is not a member, and a site that does not exist', async () => {
    admin.uid = 'stranger'
    const res = reply()
    await redirectTestHandler(post({ hostId: 'h1', path: '/old-page' }), res)
    expect(res.statusCode).toBe(403)
    admin.host = { exists: false, memberRoles: {} }
    const missing = reply()
    await redirectTestHandler(post({ hostId: 'h1', path: '/old-page' }), missing)
    expect(missing.statusCode).toBe(404)
  })
})
