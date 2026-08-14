/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * AGL-1685: the console measures `img-src` before it enforces it.
 *
 * The policy carried no `img-src` and no `default-src`, so images fell back to
 * "anything" and two third-party egresses ran unconstrained — a live Stripe
 * payment URL to `api.qrserver.com` (AGL-1671) and an MD5 of every member's
 * email to `gravatar.com` (AGL-1683).
 *
 * Three properties have to hold together, and each is load-bearing for a
 * different failure:
 *
 * 1. The candidate policy actually ships, in the REPORT-ONLY header.
 * 2. It carries a reporting directive. AGL-518 shipped a report-only policy
 *    with none for months: it detected violations, told nobody, and read as an
 *    all-clear. A report-only header with nowhere to report is worse than no
 *    header, because it looks like measurement.
 * 3. The enforcing header still carries `script-src` with its nonce. This is
 *    the one that makes adding a second header safe at all — Next resolves the
 *    nonce as `content-security-policy || …-report-only`, so a report-only
 *    header is inert only while the enforcing one carries `script-src`. Drop
 *    that and every script renders `nonce="$undefined"` (AGL-523).
 */

import { NextRequest } from 'next/server'
// The middleware reads this same module; the spec reads it to prove the
// production/development split rather than to restate the list.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { imgSrcDirective } from '../../../security-origins'

/**
 * `app.aglyn.com` — an APEX_LABELS host, chosen so the middleware short-circuits
 * to `pass()` without a `fetch` for a slug verdict. A host that needed one would
 * make this suite depend on a network call that cannot succeed under jest, and
 * the request would fall through to a branch that sets no CSP at all — which
 * every assertion below would then pass against for the wrong reason. The
 * enforcing-header control is what would catch that.
 */
const HOST = 'app.aglyn.com'

const headersFor = async (): Promise<Headers> => {
  const { middleware } = await import('../middleware')
  const response = await middleware(
    new NextRequest(new URL('/', `https://${HOST}`), {
      headers: { host: HOST },
    }),
  )
  if (!response || !('headers' in response)) {
    throw new Error(
      'middleware returned no response — it redirected or fell through, so ' +
        'there is no CSP on it to assert about',
    )
  }
  return response.headers
}

const reportOnly = async () =>
  (await headersFor()).get('Content-Security-Policy-Report-Only') ?? ''
const enforcing = async () =>
  (await headersFor()).get('Content-Security-Policy') ?? ''

describe('console img-src, report-only (AGL-1685)', () => {
  it('sends the candidate img-src in the report-only header', async () => {
    expect(await reportOnly()).toContain('img-src ')
  })

  it('reports SOMEWHERE — both wire formats, as the enforcing policy does', async () => {
    // The AGL-518 failure, pinned. `report-uri` is what Safari and older
    // Chrome send; `report-to` is the modern one. Sending one alone loses a
    // browser family, and sending neither loses everything while still looking
    // like a measurement is underway.
    const policy = await reportOnly()
    expect(policy).toContain('report-uri /api/csp-report')
    expect(policy).toContain('report-to csp')
  })

  it('CONTROL — the enforcing header still carries script-src and its nonce', async () => {
    // Without this, every assertion here would pass against a middleware that
    // had lost its enforcing policy entirely, and the nonce would be
    // `$undefined` on every script in the console (AGL-523).
    const policy = await enforcing()
    expect(policy).toContain("script-src 'self' https: blob: 'nonce-")
    expect(policy).toContain("object-src 'none'")
  })

  it('does NOT enforce img-src yet — it is still being measured', async () => {
    // `photoURL` is whatever the identity provider handed us and a SAML IdP can
    // put any host in it, so the allowlist is provably incomplete. Enforcing on
    // an incomplete image allowlist breaks avatars for exactly the customers
    // hardest to reproduce. Flipping is a follow-up gated on the reports, not
    // an edit anyone should make to silence this test.
    expect(await enforcing()).not.toContain('img-src')
  })

  it('allows the origins the console provably loads images from', async () => {
    const policy = await reportOnly()
    // Same-origin: `/_next/image`, the media CDN's `cdnPath`, static assets.
    expect(policy).toContain("'self'")
    // Not egress — neither can leave the machine. Upload previews, canvas
    // exports, inline icons.
    expect(policy).toContain('data:')
    expect(policy).toContain('blob:')
    // Raw DAM download URLs, the free-tier and pre-AGL-1215 fallback in
    // `utils/media-src.ts`.
    expect(policy).toContain('https://firebasestorage.googleapis.com')
    // Google identity `photoURL`, mirrored onto the roster by `upsertOrgMember`.
    expect(policy).toContain('https://lh3.googleusercontent.com')
  })

  it('does NOT allowlist the two vendors that were just removed', async () => {
    // The regression this whole issue is downstream of. Both egresses are gone
    // from the source (AGL-1671, AGL-1683); an allowlist entry would quietly
    // re-authorise the class at the one layer that could still catch a
    // dependency rebuilding either URL at runtime — which is exactly how the
    // gravatar one worked, with no host literal anywhere in our source.
    //
    // Named without their TLDs, following `pos-card-qr-local.spec.ts:158`. Two
    // reasons, and the second is the real one: `aglyn/no-remote-image-service`
    // blocks the full host as a string literal and cannot tell an assertion of
    // ABSENCE from a use — and the bare label is the stronger assertion anyway,
    // since gravatar was reached through three different subdomains
    // (`s.`, `secure.`, `www.`) and an entry for any of them should fail here.
    const policy = await reportOnly()
    expect(policy).not.toContain('qrserver')
    expect(policy).not.toContain('gravatar')
  })
})

describe('imgSrcDirective production split (AGL-1685)', () => {
  it('leaks no http: or loopback source into the production policy', async () => {
    // The development escape hatches are what make an image allowlist
    // meaningless if they survive the build: `http://localhost:*` is fine on a
    // laptop and is a hole in production, and `http://` anything downgrades the
    // transport for an asset the policy is meant to constrain.
    const production = imgSrcDirective(true)
    expect(production).not.toContain('http://')
    expect(production).not.toContain('localhost')
    expect(production).not.toContain('127.0.0.1')
  })

  it('keeps local development working', async () => {
    // The Storage emulator serves uploads from 127.0.0.1:9199
    // (`cloud/firebase.json`), so without these a dev console shows no DAM
    // images at all — and a directive that is only ever violated locally
    // teaches everyone to ignore it.
    const development = imgSrcDirective(false)
    expect(development).toContain('http://127.0.0.1:*')
    expect(development).toContain('http://localhost:*')
  })
})
