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
  findPluginConnection,
  isPluginConnectionChoiceId,
  isPluginConnectionHostPattern,
  pluginConnectionAuthorizeUrl,
  preparePluginConnectionRequest,
  readPluginConnectionPath,
  validatePluginConnections,
  validatePluginImageHosts,
  type PluginConnectionDeclaration,
} from './plugin-connections'

/**
 * Declared connections (AGL-4193): the manifest block a marketplace plugin
 * declares an OAuth provider, its hosts, a picker and a sync with. Every field
 * becomes an outbound request carrying a customer's token, so the schema's
 * refusals are the security boundary, and these specs hold each of them.
 */

/** A Google Business Profile reviews connection, as a publisher would declare it. */
const REVIEWS_CONNECTION = {
  id: 'reviews',
  provider: 'google',
  label: 'Google Business Profile',
  description: 'Show the business’s Google reviews.',
  authorizationUrl: 'https://accounts.example.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.example.com/token',
  revocationUrl: 'https://oauth2.example.com/revoke',
  scopes: ['https://www.example.com/auth/business.manage'],
  authParams: { access_type: 'offline', prompt: 'consent' },
  apiHosts: ['mybusiness.example.com', '*.example.net'],
  resources: [
    {
      id: 'accounts',
      label: 'Account',
      request: {
        method: 'GET',
        url: 'https://mybusiness.example.com/v1/accounts',
        itemsPath: 'accounts',
        pagination: { cursorPath: 'nextPageToken', cursorParam: 'pageToken', maxPages: 5 },
      },
      idPath: 'name',
      labelPath: 'accountName',
    },
    {
      id: 'locations',
      label: 'Location',
      request: {
        method: 'GET',
        url: 'https://info.example.net/v1/{{resource.accounts}}/locations',
        query: { readMask: 'name,title' },
        itemsPath: 'locations',
      },
      idPath: 'name',
      labelPath: 'title',
      maxItems: 50,
    },
  ],
  sync: {
    intervalHours: 6,
    requests: [
      {
        id: 'reviews',
        method: 'GET',
        url: 'https://mybusiness.example.com/v4/{{resource.accounts}}/{{resource.locations}}/reviews',
        query: { pageSize: '50' },
        itemsPath: 'reviews',
      },
    ],
    record: {
      fields: {
        averageRating: { request: 'reviews', type: 'number', path: 'averageRating' },
        totalReviewCount: { request: 'reviews', type: 'number', path: 'totalReviewCount' },
      },
      items: {
        request: 'reviews',
        maxItems: 20,
        fields: {
          reviewer: { type: 'string', path: 'reviewer.displayName', maxLength: 100 },
          photo: { type: 'url', path: 'reviewer.profilePhotoUrl', maxLength: 500 },
          rating: { type: 'number', path: 'starRating', map: { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } },
          comment: { type: 'string', path: 'comment', maxLength: 2000 },
          createdAt: { type: 'datetime', path: 'createTime' },
        },
      },
    },
  },
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** The declaration with one change, by a function that edits a copy. */
function withChange(edit: (connection: any) => void): unknown[] {
  const copy = clone(REVIEWS_CONNECTION)
  edit(copy)
  return [copy]
}

function refused(edit: (connection: any) => void): string {
  const verdict = validatePluginConnections(withChange(edit))
  if (verdict.ok) throw new Error('expected a refusal')
  return (verdict as { error: string }).error
}

describe('validatePluginConnections (AGL-4193)', () => {
  it('accepts a full declaration and returns it with its defaults filled in', () => {
    const verdict = validatePluginConnections([REVIEWS_CONNECTION])
    expect(verdict.ok).toBe(true)
    const [connection] = (verdict as { value: PluginConnectionDeclaration[] }).value
    expect(connection.id).toBe('reviews')
    expect(connection.resources?.[0].maxItems).toBe(100)
    expect(connection.resources?.[1].maxItems).toBe(50)
    expect(connection.sync?.record.items?.fields['rating'].map).toEqual({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 })
  })

  it('treats an absent block as no connections and refuses a non-list', () => {
    expect(validatePluginConnections(undefined)).toEqual({ ok: true, value: [] })
    expect(validatePluginConnections({})).toEqual({ ok: false, error: 'connections must be a list' })
  })

  it.each([
    ['an http authorization URL', (c: any) => (c.authorizationUrl = 'http://accounts.example.com/auth'), /authorizationUrl must be an https URL/],
    ['an http token URL', (c: any) => (c.tokenUrl = 'http://oauth2.example.com/token'), /tokenUrl must be an https URL/],
    ['a token URL on an IP literal', (c: any) => (c.tokenUrl = 'https://10.0.0.1/token'), /public host/],
    ['a token URL on localhost', (c: any) => (c.tokenUrl = 'https://localhost/token'), /public host/],
    ['a token URL with credentials', (c: any) => (c.tokenUrl = 'https://user:pw@oauth2.example.com/token'), /credentials/],
    ['an authorization URL with a query', (c: any) => (c.authorizationUrl = 'https://accounts.example.com/auth?x=1'), /query/],
    ['an http revocation URL', (c: any) => (c.revocationUrl = 'http://oauth2.example.com/revoke'), /revocationUrl/],
  ])('refuses %s', (_name, edit, error) => {
    expect(refused(edit)).toMatch(error)
  })

  it.each([
    ['*.com'],
    ['*.*.example.com'],
    ['*api.example.com'],
    ['api.*.example.com'],
    ['**.example.com'],
    ['*'],
    ['API.EXAMPLE.COM'],
    ['127.0.0.1'],
    ['localhost'],
    ['https://api.example.com'],
  ])('refuses the api host %s', (host) => {
    expect(refused((c) => (c.apiHosts = [host]))).toMatch(/api host/)
  })

  it('accepts a wildcard of exactly one label, and matches exactly one label with it', () => {
    expect(isPluginConnectionHostPattern('*.example.com')).toBe(true)
    expect(isPluginConnectionHostPattern('api.example.com')).toBe(true)
    const prepared = (url: string) =>
      preparePluginConnectionRequest({ method: 'GET', url }, { apiHosts: ['*.example.net'], choices: {} }).ok
    expect(prepared('https://info.example.net/v1')).toBe(true)
    expect(prepared('https://deep.info.example.net/v1')).toBe(false)
    expect(prepared('https://example.net/v1')).toBe(false)
  })

  it.each([
    ['a template URL off the declared hosts', (c: any) => (c.resources[0].request.url = 'https://evil.example.org/v1/accounts'), /apiHosts/],
    ['a placeholder in the host', (c: any) => (c.resources[1].request.url = 'https://{{resource.accounts}}.example.net/v1'), /host literally/],
    ['an http template URL', (c: any) => (c.resources[0].request.url = 'http://mybusiness.example.com/v1/accounts'), /https/],
    ['an unknown placeholder', (c: any) => (c.resources[0].request.url = 'https://mybusiness.example.com/{{env.SECRET}}'), /unknown placeholder/],
    ['a resource named before it is declared', (c: any) => (c.resources[0].request.url = 'https://mybusiness.example.com/{{resource.locations}}'), /no resource declared before it/],
    ['an unclosed placeholder', (c: any) => (c.resources[1].request.url = 'https://info.example.net/{{resource.accounts/locations'), /not closed|unknown placeholder/],
    ['a resource with no itemsPath', (c: any) => delete c.resources[0].request.itemsPath, /itemsPath is required/],
    ['an unbounded page count', (c: any) => (c.resources[0].request.pagination.maxPages = 1000), /maxPages/],
    ['an unbounded resource list', (c: any) => (c.resources[0].maxItems = 100000), /maxItems/],
    ['a GET with a body', (c: any) => (c.resources[0].request.body = { a: 'b' }), /only a POST/],
  ])('refuses %s', (_name, edit, error) => {
    expect(refused(edit)).toMatch(error)
  })

  it.each([
    ['an interval under an hour', (c: any) => (c.sync.intervalHours = 0), /intervalHours/],
    ['a fractional interval', (c: any) => (c.sync.intervalHours = 0.5), /intervalHours/],
    ['an interval over a week', (c: any) => (c.sync.intervalHours = 1000), /intervalHours/],
    ['too many record items', (c: any) => (c.sync.record.items.maxItems = 10000), /maxItems/],
    ['a string field with no maxLength', (c: any) => delete c.sync.record.items.fields.comment.maxLength, /maxLength is required/],
    ['a string field past the ceiling', (c: any) => (c.sync.record.items.fields.comment.maxLength = 1_000_000), /maxLength is required/],
    ['a summary field reading no sync request', (c: any) => (c.sync.record.fields.averageRating.request = 'nope'), /request must name/],
    ['an unknown field type', (c: any) => (c.sync.record.fields.averageRating.type = 'object'), /type must be one of/],
    ['a path that reaches past a plain segment', (c: any) => (c.sync.record.items.fields.comment.path = 'a..b'), /path must be a dot path/],
    ['an empty record', (c: any) => (c.sync.record = {}), /record must declare/],
  ])('refuses a sync with %s', (_name, edit, error) => {
    expect(refused(edit)).toMatch(error)
  })

  it.each(['client_id', 'redirect_uri', 'state', 'scope', 'response_type', 'REDIRECT_URI'])(
    'refuses an authorization parameter the platform sets itself: %s',
    (name) => {
      expect(refused((c) => (c.authParams = { [name]: 'x' }))).toMatch(/platform sets itself/)
    },
  )

  it('refuses a second connection with the same id, and more than four', () => {
    expect(validatePluginConnections([REVIEWS_CONNECTION, REVIEWS_CONNECTION])).toEqual({
      ok: false,
      error: 'connection id "reviews" is declared twice',
    })
    const five = Array.from({ length: 5 }, (_, index) => ({ ...clone(REVIEWS_CONNECTION), id: `c-${index}` }))
    expect(validatePluginConnections(five).ok).toBe(false)
  })

  it('refuses a block past the serialized ceiling', () => {
    const huge = withChange((c) => (c.description = 'x'.repeat(40_000)))
    expect(validatePluginConnections(huge)).toMatchObject({ ok: false, error: expect.stringMatching(/serialize/) })
  })

  it('finds a declared connection again, re-validated, and nothing for a broken copy', () => {
    expect(findPluginConnection({ connections: [REVIEWS_CONNECTION] }, 'reviews')?.label).toBe('Google Business Profile')
    expect(findPluginConnection({ connections: withChange((c) => (c.tokenUrl = 'http://x.example.com')) }, 'reviews')).toBeNull()
    expect(findPluginConnection(null, 'reviews')).toBeNull()
  })
})

describe('validatePluginImageHosts (AGL-4193)', () => {
  it('takes the same host rule as apiHosts', () => {
    expect(validatePluginImageHosts(['lh3.example.com', '*.example.net'])).toEqual({
      ok: true,
      value: ['lh3.example.com', '*.example.net'],
    })
    expect(validatePluginImageHosts(['*.com']).ok).toBe(false)
    expect(validatePluginImageHosts(['http://lh3.example.com']).ok).toBe(false)
    expect(validatePluginImageHosts(Array.from({ length: 11 }, (_, i) => `h${i}.example.com`)).ok).toBe(false)
  })
})

describe('preparePluginConnectionRequest (AGL-4193)', () => {
  const [connection] = (validatePluginConnections([REVIEWS_CONNECTION]) as { value: PluginConnectionDeclaration[] }).value
  const locations = connection.resources?.[1].request

  it('fills a chained request from the choices made before it', () => {
    const prepared = preparePluginConnectionRequest(locations as never, {
      apiHosts: connection.apiHosts,
      choices: { accounts: 'accounts/123' },
    })
    expect(prepared).toEqual({
      ok: true,
      request: { method: 'GET', url: 'https://info.example.net/v1/accounts/123/locations?readMask=name%2Ctitle' },
    })
  })

  it('refuses a request whose choice has not been made', () => {
    expect(preparePluginConnectionRequest(locations as never, { apiHosts: connection.apiHosts, choices: {} }).ok).toBe(false)
  })

  it.each(['../../admin', 'a?b=1', 'a#frag', '//evil.example.org', 'x@evil', '%2e%2e', '/abs', 'a b'])(
    'never puts a choice that could leave the path in a URL: %s',
    (choice) => {
      expect(isPluginConnectionChoiceId(choice)).toBe(false)
      expect(
        preparePluginConnectionRequest(locations as never, { apiHosts: connection.apiHosts, choices: { accounts: choice } }).ok,
      ).toBe(false)
    },
  )

  it('sends the page cursor in the declared parameter', () => {
    const accounts = connection.resources?.[0].request
    const prepared = preparePluginConnectionRequest(accounts as never, {
      apiHosts: connection.apiHosts,
      choices: {},
      cursor: 'next page',
    })
    expect(prepared).toMatchObject({ ok: true, request: { url: 'https://mybusiness.example.com/v1/accounts?pageToken=next+page' } })
  })
})

describe('readPluginConnectionPath (AGL-4193)', () => {
  it('reads own properties and array indexes only', () => {
    const body = { reviews: [{ reviewer: { displayName: 'Ada' } }] }
    expect(readPluginConnectionPath(body, 'reviews.0.reviewer.displayName')).toBe('Ada')
    expect(readPluginConnectionPath(body, 'reviews.x')).toBeUndefined()
    expect(readPluginConnectionPath({}, '__proto__')).toBeUndefined()
    expect(readPluginConnectionPath({}, 'constructor')).toBeUndefined()
  })
})

describe('pluginConnectionAuthorizeUrl (AGL-4193)', () => {
  it('carries the platform’s client id, redirect, scope and state, and the declared extras', () => {
    const [connection] = (validatePluginConnections([REVIEWS_CONNECTION]) as { value: PluginConnectionDeclaration[] }).value
    const url = new URL(
      pluginConnectionAuthorizeUrl(connection, {
        clientId: 'client-1',
        redirectUri: 'https://app.example.com/api/plugin-connections/connect/callback',
        state: 'pc1.state',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.example.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      access_type: 'offline',
      prompt: 'consent',
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://app.example.com/api/plugin-connections/connect/callback',
      scope: 'https://www.example.com/auth/business.manage',
      state: 'pc1.state',
    })
  })
})
