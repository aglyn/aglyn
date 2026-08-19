/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom, where `Request` is not a constructor.
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
 * `GET /api/host?host=` may not publish the host document (AGL-2192).
 *
 * The sibling of AGL-2191, found by asking which other tenant routes return
 * through `appHandleJsonSuccess`. There are exactly two, and they were the same
 * bug: this one returned everything `getHost` read, `memberRoles` included —
 * the Firebase UIDs of the site's editors with their roles, which
 * `edit-access-authz` reads as an authorization INPUT. Also the org and GCP
 * project ids, and the raw suspension fields `/api/locked` takes care to
 * sanitize (AGL-1501).
 *
 * ## What makes this spec able to fail
 *
 * It drives the REAL route over a `getHost` that answers with a full host
 * document — the shape production stores, since `hostConverter` strips nothing.
 * So the projection under test is the route's own `toPublicHost`, and nothing
 * upstream can quietly do its job for it. Proven RED by returning
 * `result.host` verbatim.
 *
 * `getHost` itself is mocked rather than driven through a Firestore stand-in
 * because the question here is not which document is found — that is
 * `collections-rss-host-form.spec.ts` — but what survives the boundary. The
 * mock is also the assertion that the SHARED util still hands back everything:
 * every render, sitemap and lockdown path depends on fields this response must
 * not carry, so a projection pushed down into `get-host.ts` would fix the leak
 * by starving the loader.
 */

const mockHostDoc = {
  $id: 'host-demo',
  displayName: 'Demo Co',
  logoUrl: 'https://cdn.aglyn.app/logo.png',
  subdomain: 'demo',
  cname: 'demo.example.com',
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  seo: { title: 'Demo Co', description: 'We demo things', favicon: 'f.ico' },
  // Everything below is what the route used to publish.
  memberRoles: { 'uid-alice': 'admin', 'uid-bob': 'editor' },
  orgId: 'org-demo',
  projectId: 'aglyn-main',
  projectNumber: 123456789,
  suspendedAt: 1_754_714_956,
  suspendedReasonCode: 'billing.chargeback',
  suspendedMessage: 'Payment disputed by the cardholder',
  suspendedUntilMs: 1_754_800_000,
  screens: { 'screen-about': 'about', 'screen-investors': 'investors' },
  layouts: { 'layout-main': 'Main' },
  redirects: { 'redirect-1': true },
  notFoundScreenId: 'screen-404',
  disabledPlugins: ['bookings'],
  analytics: { gaMeasurementId: 'G-SECRET' },
  maintenance: true,
}

// Stated from THIS file; Jest keys the registry by resolved path, so this is
// the same module the route reaches by its own relative import.
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: async () => ({ host: mockHostDoc, nextPageToken: '', error: null }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('../app/api/host/[hostId]/route')

async function callRoute(): Promise<{ raw: string; body: any }> {
  const response = await GET(
    new Request('https://demo.aglyn.app/api/host/demo?host=demo'),
  )
  const raw = await response.text()
  return { raw, body: JSON.parse(raw) }
}

describe('GET /api/host response projection (AGL-2192)', () => {
  it('never ships the member roster or the ids behind the site', async () => {
    const { raw } = await callRoute()

    expect(raw).not.toContain('memberRoles')
    expect(raw).not.toContain('uid-alice')
    expect(raw).not.toContain('uid-bob')
    expect(raw).not.toContain('org-demo')
    expect(raw).not.toContain('aglyn-main')
    expect(raw).not.toContain('123456789')
  })

  it('never ships the internal moderation or routing state', async () => {
    const { raw } = await callRoute()

    expect(raw).not.toContain('suspended')
    expect(raw).not.toContain('Payment disputed')
    expect(raw).not.toContain('screen-investors')
    expect(raw).not.toContain('notFoundScreenId')
    expect(raw).not.toContain('disabledPlugins')
    expect(raw).not.toContain('G-SECRET')
  })

  it('publishes only allow-listed fields', async () => {
    const { body } = await callRoute()
    const allowed = new Set([
      '$id',
      'displayName',
      'logoUrl',
      'subdomain',
      'cname',
      'locales',
      'defaultLocale',
      'seo',
    ])

    // Fails on a field NOBODY has thought about yet — the reason this is an
    // allow-list and not a `delete host.memberRoles`.
    for (const key of Object.keys(body.data.host)) {
      expect(allowed.has(key)).toBe(true)
    }
  })

  it('still serves the public identity a lookup is for', async () => {
    const { body } = await callRoute()

    expect(body.data.host.displayName).toBe('Demo Co')
    expect(body.data.host.subdomain).toBe('demo')
    expect(body.data.host.cname).toBe('demo.example.com')
    expect(body.data.host.locales).toEqual(['en', 'fr'])
    expect(body.data.host.seo.title).toBe('Demo Co')
    expect(body.data.host.seo.favicon).toBe('f.ico')
  })
})
