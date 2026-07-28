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
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The media CDN boundary, driven through the real handler against a real
 * Firestore (AGL-1047).
 *
 * `mediaCdnAllows` is unit-tested exhaustively, but a pure predicate with
 * no caller is precisely the failure this project exists to avoid
 * (`feedback_verify_control_is_wired`). This drives `serveMediaCdn` itself
 * — the request parsing, the Firestore read, the status and the CACHE
 * HEADERS — so the assertion covers the wiring and not just the rule.
 *
 * The cache header is load-bearing, not a detail. The CDN is
 * unauthenticated and its responses are shared-cached: a denial that got
 * cached as a success, or a success cached under a URL that should deny,
 * outlives the Firestore change that caused it. AGL-1047 asks for "404,
 * and 404 again on the cached retry" — asserted here by issuing the same
 * request twice and checking the denial is cacheable only briefly.
 *
 * The ALLOWED cases assert the long-lived cache header rather than a 200.
 * No storage bucket is configured against the emulator, so an allowed
 * request runs past the scope check and then fails fetching bytes — and
 * `Cache-Control: max-age=3600` is set only AFTER the scope check passes,
 * which makes it the exact signal that separates allowed from denied. The
 * logged storage errors in an allowed case are expected for that reason.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is
 * unaffected and this can never touch production. Start the emulator
 * (docs/E2E_LOCAL.md), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns serve-media-cdn.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-cdn-agency'
const INTERNAL = 'e2e-cdn-internal-1'
const CLIENT = 'e2e-cdn-client-1'

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

/** Minimal NextApiResponse capturing what the CDN contract is made of. */
function makeRes() {
  const headers: Record<string, string> = {}
  const captured = { status: 0, body: undefined as unknown, ended: false }
  const res = {
    headers,
    captured,
    setHeader: (key: string, value: string) => {
      headers[key.toLowerCase()] = String(value)
      return res
    },
    status: (code: number) => {
      captured.status = code
      return res
    },
    json: (body: unknown) => {
      captured.body = body
      captured.ended = true
      return res
    },
    end: () => {
      captured.ended = true
      return res
    },
    send: (body: unknown) => {
      captured.body = body
      captured.ended = true
      return res
    },
  }
  return res
}

const get = async (
  serveMediaCdn: typeof import('./serve-media-cdn').serveMediaCdn,
  path: string[],
) => {
  const res = makeRes()
  await serveMediaCdn(
    { method: 'GET', query: { path }, headers: {} } as never,
    res as never,
  )
  return res
}

const getSigned = async (
  serveMediaCdn: typeof import('./serve-media-cdn').serveMediaCdn,
  path: string[],
  signature: { exp: number; sig: string },
) => {
  const res = makeRes()
  await serveMediaCdn(
    {
      method: 'GET',
      query: { path, exp: String(signature.exp), sig: signature.sig },
      headers: {},
    } as never,
    res as never,
  )
  return res
}

describeEmulated('media CDN scope boundary (AGL-1047)', () => {
  let db: Firestore
  let serveMediaCdn: typeof import('./serve-media-cdn').serveMediaCdn

  beforeAll(async () => {
    db = getFirestore()
    await seed(db)
    serveMediaCdn = (await import('./serve-media-cdn')).serveMediaCdn
  }, 60_000)

  it('THE LEAK: a restricted asset 404s on the bare org URL', async () => {
    // The shape AGL-1043 fixed. `org:{orgId}/{mediaId}` names no site, so
    // it may only serve ORG-WIDE assets — otherwise the agency's internal
    // artwork is one guessable URL away from any client site's page.
    const res = await get(serveMediaCdn, [`org:${ORG}`, 'm-internal'])
    expect(res.captured.status).toBe(404)
  }, 60_000)

  it('404s again on the retry, and the denial is only briefly cacheable', async () => {
    const first = await get(serveMediaCdn, [`org:${ORG}`, 'm-internal'])
    const second = await get(serveMediaCdn, [`org:${ORG}`, 'm-internal'])
    expect(first.captured.status).toBe(404)
    expect(second.captured.status).toBe(404)
    // Short max-age, so re-widening a scope propagates instead of being
    // pinned by a shared cache holding the denial.
    expect(second.headers['cache-control']).toBe('public, max-age=60')
    expect(second.headers['cache-control']).not.toContain('immutable')
  }, 60_000)

  it('404s for a site the asset is not shared with', async () => {
    const res = await get(serveMediaCdn, [
      `org:${ORG}:${CLIENT}`,
      'm-internal',
    ])
    expect(res.captured.status).toBe(404)
  }, 60_000)

  it('does not 404 for the site the asset IS shared with', async () => {
    // Storage holds no bytes in the emulator, so this stops at the object
    // fetch — but it gets PAST the scope check, which is what separates
    // "denied" from "allowed" and is the only thing this asserts.
    const res = await get(serveMediaCdn, [
      `org:${ORG}:${INTERNAL}`,
      'm-internal',
    ])
    expect(res.headers['cache-control']).toContain('max-age=3600')
  }, 60_000)

  it('serves an org-wide asset on the bare org URL', async () => {
    const res = await get(serveMediaCdn, [`org:${ORG}`, 'm-shared'])
    expect(res.headers['cache-control']).toContain('max-age=3600')
  }, 60_000)

  it('treats a pre-backfill asset with no scope as org-wide', async () => {
    // Absent `visibleTo` must stay visible (AGL-1040 ordering); a fail-closed
    // read here would blank every image uploaded before the backfill.
    const res = await get(serveMediaCdn, [`org:${ORG}`, 'm-legacy'])
    expect(res.headers['cache-control']).toContain('max-age=3600')
  }, 60_000)

  describe('private assets (AGL-1051)', () => {
    it('404s without a signature, even on the correctly scoped URL', async () => {
      // The point of the flag: scoping says this SITE may use the asset,
      // and it still must not hand the bytes to anyone holding the URL.
      const res = await get(serveMediaCdn, [`org:${ORG}`, 'm-private'])
      expect(res.captured.status).toBe(404)
    })

    it('never lets a denial be shared-cached', async () => {
      const res = await get(serveMediaCdn, [`org:${ORG}`, 'm-private'])
      expect(res.headers['cache-control']).toBe('private, no-store')
    })

    it('serves it with a valid signature', async () => {
      const { mintMediaSignature } = await import('./media-signing')
      const scope = `org:${ORG}`
      const signature = mintMediaSignature(scope, 'm-private')
      const res = await getSigned(serveMediaCdn, [scope, 'm-private'], signature)
      // Past the gate — see the header note at the top of this file.
      expect(res.captured.status).not.toBe(404)
      // And still never shared-cacheable: a signed response cached publicly
      // would outlive its own signature.
      expect(res.headers['cache-control']).toBe('private, no-store')
    })

    it('rejects a signature minted for a different asset', async () => {
      const { mintMediaSignature } = await import('./media-signing')
      const scope = `org:${ORG}`
      const signature = mintMediaSignature(scope, 'm-shared')
      const res = await getSigned(serveMediaCdn, [scope, 'm-private'], signature)
      expect(res.captured.status).toBe(404)
    })

    it('rejects an expired signature', async () => {
      const { signMediaAccess } = await import('./media-signing')
      const scope = `org:${ORG}`
      const exp = Date.now() - 1000
      const res = await getSigned(serveMediaCdn, [scope, 'm-private'], {
        exp,
        sig: signMediaAccess(scope, 'm-private', exp),
      })
      expect(res.captured.status).toBe(404)
    })

    it('does not sign away the SCOPE check', async () => {
      // A valid signature is not a bypass for `visibleTo`. Both gates run.
      const { mintMediaSignature } = await import('./media-signing')
      const scope = `org:${ORG}:${CLIENT}`
      const signature = mintMediaSignature(scope, 'm-private-internal')
      const res = await getSigned(
        serveMediaCdn,
        [scope, 'm-private-internal'],
        signature,
      )
      expect(res.captured.status).toBe(404)
    })
  })

  it('rejects a malformed scope segment before touching Firestore', async () => {
    expect(
      (await get(serveMediaCdn, ['org:', 'm-shared'])).captured.status,
    ).toBe(400)
    expect(
      (await get(serveMediaCdn, [`org:${ORG}`])).captured.status,
    ).toBe(400)
  }, 60_000)
})

async function seed(db: Firestore): Promise<void> {
  const org = db.collection('orgs').doc(ORG)
  await org.set({ name: 'CDN Agency' })
  for (const hostId of [INTERNAL, CLIENT]) {
    await db.collection('hostIndex').doc(hostId).set({ orgId: ORG })
    await db.collection('hosts').doc(hostId).set({ orgId: ORG })
  }
  const media: Array<[string, Record<string, unknown>]> = [
    ['m-shared', { fileName: 'logo.png', visibleTo: ['org'] }],
    ['m-internal', { fileName: 'rates.png', visibleTo: [`host:${INTERNAL}`] }],
    // No `visibleTo` at all — the pre-AGL-1040 shape, which must stay
    // visible rather than vanish.
    ['m-legacy', { fileName: 'old.png' }],
    // Private (AGL-1051): org-wide by scope, and still unfetchable without
    // a signature. The two flags are orthogonal and this proves it.
    ['m-private', { fileName: 'contract.pdf', visibleTo: ['org'], private: true }],
    // Private AND restricted — both gates must hold independently.
    [
      'm-private-internal',
      {
        fileName: 'unreleased.png',
        visibleTo: [`host:${INTERNAL}`],
        private: true,
      },
    ],
  ]
  for (const [id, data] of media) {
    await org
      .collection('media')
      .doc(id)
      .set({ contentType: 'image/png', ...data })
  }
}
