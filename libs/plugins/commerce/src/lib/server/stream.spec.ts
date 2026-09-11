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
 * The gated stream's redirect (AGL-315), the delivery copy it lands on
 * (AGL-2766), and the expiry of what it lands on (AGL-2814).
 *
 * ## Why the round trip is minted rather than hand-signed
 *
 * Every GET below redeems a URL the POST half actually minted, instead of a
 * query assembled with a signature computed in this file. The two are not
 * equivalent. `?r=auto` is attached at the redirect, downstream of a
 * signature over `(hostId, productId, video, exp)` — a tuple it must not
 * join — and a spec that signed its own requests would keep passing if the
 * parameter were folded into the signed payload, or if the payload quietly
 * grew a field. Minting makes the handler prove that contract on every case.
 *
 * ## Why the media signatures are checked with the real verifier
 *
 * The delivery resolver and the media-signing module are the real ones, not
 * doubles: only Firestore and the bucket are faked. An assertion that the
 * `Location` expires is therefore checked with the same `verifyMediaAccess`
 * the CDN runs, at the instant before and the instant of expiry.
 *
 * ## Why the URL shapes are enumerated
 *
 * `gatedVideos[].url` is written by the console media picker, which stores
 * a media reference or the media-CDN path for an org with the `mediaCdn`
 * entitlement and the raw Storage download URL for one without — and older
 * products predate the picker entirely. So a redirect target is not reliably
 * a CDN URL, and the assertions here say what each shape does rather than
 * assuming the good one.
 */

process.env.TOKEN_SIGNING_SECRET = 'stream-spec-secret'

import { MEDIA_CDN_ROUTE, parsePaidMediaSource } from '@aglyn/aglyn/server'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { streamHandler } from './stream'

const {
  GATED_VIDEO_SESSION_TTL_MS,
  verifyMediaAccess,
} = jest.requireActual('@aglyn/tenant-data-admin/server/media-signing')

const docs = new Map<string, Record<string, any>>()

function makeDocRef(path: string) {
  return {
    id: path.split('/').pop() as string,
    path,
    async get() {
      const data = docs.get(path)
      return {
        exists: data !== undefined,
        id: path.split('/').pop() as string,
        data: () => data,
        get: (field: string) => data?.[field],
      }
    },
  }
}

function makeCollectionRef(path: string) {
  return {
    doc: (id: string) => ({
      ...makeDocRef(`${path}/${id}`),
      collection: (name: string) => makeCollectionRef(`${path}/${id}/${name}`),
    }),
  }
}

const fakeFirestore = { collection: (name: string) => makeCollectionRef(name) }

const BUCKET = 'aglyn-test.appspot.com'

/** Every V4 read the handler asked the bucket to sign. */
const signedReads: { path: string; expires: number }[] = []

const fakeBucket = {
  name: BUCKET,
  file: (path: string) => ({
    getSignedUrl: async ({ expires }: { expires: number }) => {
      signedReads.push({ path, expires })
      return [
        `https://storage.googleapis.com/${BUCKET}/${path}` +
          '?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=v4',
      ]
    },
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const delivery = jest.requireActual(
    '@aglyn/tenant-data-admin/server/paid-media-delivery',
  )
  const signing = jest.requireActual(
    '@aglyn/tenant-data-admin/server/media-signing',
  )
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => fakeFirestore,
        storage: () => ({ bucket: () => fakeBucket }),
      }),
    },
    createPaidMediaDeliveryIo: delivery.createPaidMediaDeliveryIo,
    resolvePaidMediaDelivery: delivery.resolvePaidMediaDelivery,
    GATED_VIDEO_SESSION_TTL_MS: signing.GATED_VIDEO_SESSION_TTL_MS,
  }
})

/**
 * The gate is stubbed OPEN so the redirect is reachable, and that is the only
 * thing these doubles are allowed to decide. Everything the entitlement check
 * itself owns — the suspension path, the plan gate, live-subscription lookup
 * — is measured by `membership-suspension.spec.ts` and `connect-mode-gate`;
 * re-deciding it here would report those as green from a stub.
 *
 * `mockEntitled` is a `let` so one test can close the gate again and confirm
 * that a refused mint yields no signed URL at all, which is what makes "the
 * gate is unchanged" an assertion rather than a claim. The `mock` prefix is
 * what lets a factory reference it: jest's hoist pass moves these above every
 * import and refuses an out-of-scope name without it.
 */
let mockEntitled = true
jest.mock('./membership', () => ({
  requireActiveMember: async () => ({
    memberId: 'mem-1',
    member: {
      get: (field: string) =>
        field === 'email' ? 'member-a@example.com' : undefined,
    },
  }),
}))
jest.mock('./gate', () => ({
  checkMemberEntitlement: async () => mockEntitled,
}))

const HOST = 'host-1'
const ORG = 'acme'
const PRODUCT = 'prod-course'

/** The scope a delivered org asset is signed under: qualified with this site. */
const DELIVERY_SCOPE = `org:${ORG}:${HOST}`
const DELIVERED_PATH = `${MEDIA_CDN_ROUTE}/${DELIVERY_SCOPE}/med-film`

/**
 * The shapes `gatedVideos[].url` actually holds, and where each comes from.
 *
 * Built from {@link MEDIA_CDN_ROUTE} rather than typed out, so a route that
 * moved would take the fixture with it instead of leaving a string that no
 * longer names this platform's own door.
 */
/** The picker's `cdnPath`: an org with the paid `mediaCdn` entitlement. */
const CDN_VIDEO = `${MEDIA_CDN_ROUTE}/org:${ORG}/med-film`
/** The same, pinned to a content hash — the route's immutable form. */
const CDN_VIDEO_PINNED = `${MEDIA_CDN_ROUTE}/org:${ORG}/med-film/abc123def456`
/** An org asset restricted to sites, host-qualified by the picker dialog. */
const CDN_VIDEO_QUALIFIED = `${MEDIA_CDN_ROUTE}/org:${ORG}:${HOST}/med-film`
/** What the paid-media picker stores: a reference, which names the asset. */
const MEDIA_REF_VIDEO = `media:org:${ORG}/med-film`
/** No `mediaCdn` entitlement, or a legacy upload: the raw download URL. */
const RAW_STORAGE_VIDEO =
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/` +
  `${encodeURIComponent(`orgs/${ORG}/media/Films/med-film`)}` +
  '?alt=media&token=long-lived-token'
/** A raw download URL for an object no media document owns. */
const RAW_STORAGE_LEGACY =
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/` +
  `${encodeURIComponent(`hosts/${HOST}/media/week-1.mp4`)}` +
  '?alt=media&token=long-lived-token'
/** A raw download URL from another Firebase project's bucket. */
const FOREIGN_STORAGE_VIDEO =
  'https://firebasestorage.googleapis.com/v0/b/someone-else.appspot.com/o/' +
  'week-1.mp4?alt=media&token=long-lived-token'
/** An author-typed hotlink, which the demo catalog still seeds. */
const HOTLINK_VIDEO = 'https://videos.example.com/w1.m3u8'
/** Another org's private film, named from this site's product. */
const RIVAL_VIDEO = 'media:org:rival/med-film'

function makeResponse() {
  const result = {
    status: 0,
    body: undefined as any,
    redirectedTo: '' as string,
    headers: {} as Record<string, string>,
  }
  const res: PluginApiResponse = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value
    },
    redirect(code: number, url: string) {
      result.status = code
      result.redirectedTo = url
    },
    end() {
      // unused
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

function request(
  method: 'GET' | 'POST',
  fields: Record<string, unknown>,
): PluginApiRequest {
  return {
    method,
    query: method === 'GET' ? fields : {},
    body: method === 'POST' ? fields : {},
    headers: {},
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
}

/** The mint half: an entitled member asking for a playable link. */
async function mint(video = 0) {
  const { res, result } = makeResponse()
  await streamHandler(
    request('POST', { hostId: HOST, productId: PRODUCT, video }),
    res,
  )
  return result
}

/**
 * The query a minted URL carries, as the browser would send it back.
 *
 * Parsed out of the `Location`-bound URL rather than rebuilt, so `exp` and
 * `sig` are the handler's own and any change to what it signs shows up here
 * as a 403 instead of being quietly mirrored.
 */
function redeemable(url: string): Record<string, string> {
  const parsed = new URL(url, 'https://shop.example')
  return Object.fromEntries(parsed.searchParams.entries())
}

/** The redeem half: following the minted link. */
async function redeem(query: Record<string, unknown>) {
  const { res, result } = makeResponse()
  await streamHandler(request('GET', query), res)
  return result
}

/** Mint and immediately redeem — the whole path a player walks. */
async function play(video = 0) {
  const minted = await mint(video)
  expect(minted.status).toBe(200)
  return redeem(redeemable(minted.body.url))
}

/** A delivered CDN location, taken apart the way the CDN reads it. */
function delivered(location: string) {
  const url = new URL(location, 'https://shop.example')
  return {
    path: url.pathname,
    r: url.searchParams.get('r'),
    exp: Number(url.searchParams.get('exp')),
    sig: String(url.searchParams.get('sig') ?? ''),
  }
}

function seed(gatedVideos: { url: string; title?: string }[]) {
  docs.set(`hosts/${HOST}/products/${PRODUCT}`, {
    name: 'Training program',
    slug: 'training-program',
    type: 'digital',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 39 }],
    gatedVideos,
  })
}

/** The operator's log line for a video the handler would not deliver. */
let consoleError: jest.SpyInstance

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  docs.clear()
  signedReads.length = 0
  mockEntitled = true
  docs.set(`hostIndex/${HOST}`, { orgId: ORG })
  docs.set(`orgs/${ORG}/media/med-film`, {
    fileName: 'week-1.mp4',
    contentType: 'video/mp4',
    storagePath: `orgs/${ORG}/media/Films/med-film`,
    visibleTo: ['org'],
    private: true,
  })
  docs.set('orgs/rival/media/med-film', {
    contentType: 'video/mp4',
    visibleTo: ['org'],
    private: true,
  })
  seed([{ url: CDN_VIDEO, title: 'Week 1' }])
})

afterEach(() => {
  consoleError.mockRestore()
})

// ---------------------------------------------------------------------------

/**
 * The fixtures, measured before anything is concluded from them.
 *
 * A CDN fixture that had drifted out of the route's shape would fall down a
 * different branch of the resolver and could satisfy a refusal for the wrong
 * reason. So each shape's classification is asserted directly, once, against
 * the real parser.
 */
describe('the URL shapes this redirect can be handed', () => {
  it('reads the four library forms as this platform’s own asset', () => {
    for (const stored of [
      CDN_VIDEO,
      CDN_VIDEO_PINNED,
      CDN_VIDEO_QUALIFIED,
      MEDIA_REF_VIDEO,
    ]) {
      expect(parsePaidMediaSource(stored)).toMatchObject({
        kind: 'asset',
        mediaId: 'med-film',
      })
    }
  })

  it('reads a download URL as a Storage object and a hotlink as somebody else’s', () => {
    expect(parsePaidMediaSource(RAW_STORAGE_VIDEO)).toMatchObject({
      kind: 'storage-object',
      bucket: BUCKET,
    })
    expect(parsePaidMediaSource(RAW_STORAGE_LEGACY)).toMatchObject({
      kind: 'storage-object',
      bucket: BUCKET,
    })
    expect(parsePaidMediaSource(HOTLINK_VIDEO)).toMatchObject({
      kind: 'external',
    })
  })
})

describe('the gate still decides who gets a link (AGL-315)', () => {
  it('mints a signed, short-TTL URL for an entitled member', async () => {
    const minted = await mint()
    expect(minted.status).toBe(200)
    expect(minted.body.url).toContain('/api/commerce/stream?')
    const query = redeemable(minted.body.url)
    expect(query.sig).toMatch(/^[0-9a-f]{32}$/)
    expect(Number(query.exp)).toBeGreaterThan(Date.now())
    expect(minted.headers['Cache-Control']).toBe('private, no-store')
  })

  it('⛔ refuses to mint anything for a member who is not entitled', async () => {
    mockEntitled = false
    const minted = await mint()
    expect(minted.status).toBe(403)
    expect(minted.body).toEqual({ error: 'Not entitled' })
  })

  it('⛔ refuses a redeem whose signature does not verify', async () => {
    const query = redeemable((await mint()).body.url)
    const tampered = await redeem({ ...query, video: '1' })
    expect(tampered.status).toBe(403)
    expect(tampered.redirectedTo).toBe('')
  })

  it('⛔ refuses a redeem whose window has closed', async () => {
    const query = redeemable((await mint()).body.url)
    const stale = await redeem({ ...query, exp: String(Date.now() - 1) })
    expect(stale.status).toBe(403)
    expect(stale.redirectedTo).toBe('')
  })
})

/**
 * AGL-2814. The stream link expired in fifteen minutes and redirected to the
 * asset's permanent public URL, so the redirect was the only thing that
 * expired. Whoever read the `Location` kept the film.
 */
describe('AGL-2814 · the redirect lands on a link that expires', () => {
  it('signs the delivery URL for the viewing session, and it dies at the end of it', async () => {
    const before = Date.now()
    const played = await play()
    const after = Date.now()
    expect(played.status).toBe(302)
    const location = delivered(played.redirectedTo)
    expect(location.path).toBe(DELIVERED_PATH)
    expect(location.exp).toBeGreaterThanOrEqual(before + GATED_VIDEO_SESSION_TTL_MS)
    expect(location.exp).toBeLessThanOrEqual(after + GATED_VIDEO_SESSION_TTL_MS)
    // The CDN's own verifier, at the last moment and at the moment of expiry.
    expect(
      verifyMediaAccess(DELIVERY_SCOPE, 'med-film', location, location.exp - 1),
    ).toBe(true)
    expect(
      verifyMediaAccess(DELIVERY_SCOPE, 'med-film', location, location.exp),
    ).toBe(false)
  })

  it('⛔ never redirects to the bare, unsigned path', async () => {
    const played = await play()
    expect(played.redirectedTo).not.toBe(CDN_VIDEO)
    expect(played.redirectedTo).not.toBe(`${CDN_VIDEO}?r=auto`)
    expect(played.redirectedTo).toMatch(/[?&]exp=\d+/)
    expect(played.redirectedTo).toMatch(/[?&]sig=[0-9a-f]{32}(&|$)/)
  })

  it('asks the CDN for the best delivery copy inside the signed URL (AGL-2766)', async () => {
    expect(delivered((await play()).redirectedTo).r).toBe('auto')
  })

  it('signs every stored library form as the one asset, qualified with this site', async () => {
    // The pinned form drops its hash: the immutable year is withheld from a
    // private asset anyway, and a stale pin would only add a hop.
    for (const url of [CDN_VIDEO_PINNED, CDN_VIDEO_QUALIFIED, MEDIA_REF_VIDEO]) {
      seed([{ url }])
      expect(delivered((await play()).redirectedTo).path).toBe(DELIVERED_PATH)
    }
  })

  it('⛔ refuses a video whose asset is still public, with no Location at all', async () => {
    docs.set(`orgs/${ORG}/media/med-film`, {
      contentType: 'video/mp4',
      visibleTo: ['org'],
    })
    const played = await play()
    expect(played.status).toBe(409)
    expect(played.redirectedTo).toBe('')
    expect(played.headers['Cache-Control']).toBe('private, no-store')
    // Named for the operator, who has to find the product and fix its video.
    expect(consoleError).toHaveBeenCalledWith(
      '[commerce/stream] gated video not delivered',
      JSON.stringify({
        hostId: HOST,
        productId: PRODUCT,
        video: 0,
        refusal: 'not-private',
      }),
    )
  })

  it('⛔ signs nothing from another org’s library', async () => {
    seed([{ url: RIVAL_VIDEO }])
    const played = await play()
    expect(played.status).toBe(404)
    expect(played.redirectedTo).toBe('')
  })

  describe('the free-tier path never hands out a token URL', () => {
    it('signs the library asset a raw download URL belongs to', async () => {
      seed([{ url: RAW_STORAGE_VIDEO }])
      const played = await play()
      expect(played.status).toBe(302)
      expect(played.redirectedTo).not.toContain('token=')
      expect(played.redirectedTo).not.toContain('firebasestorage')
      expect(delivered(played.redirectedTo).path).toBe(DELIVERED_PATH)
    })

    it('gives an object no document owns a V4 read that expires with the session', async () => {
      seed([{ url: RAW_STORAGE_LEGACY }])
      const before = Date.now()
      const played = await play()
      expect(played.status).toBe(302)
      expect(played.redirectedTo).not.toContain('token=')
      expect(played.redirectedTo).toContain('X-Goog-Signature=')
      expect(signedReads).toHaveLength(1)
      expect(signedReads[0].path).toBe(`hosts/${HOST}/media/week-1.mp4`)
      expect(signedReads[0].expires).toBeGreaterThanOrEqual(
        before + GATED_VIDEO_SESSION_TTL_MS,
      )
      expect(signedReads[0].expires).toBeLessThanOrEqual(
        Date.now() + GATED_VIDEO_SESSION_TTL_MS,
      )
    })

    it('⛔ refuses a download URL from a bucket this platform does not serve', async () => {
      seed([{ url: FOREIGN_STORAGE_VIDEO }])
      const played = await play()
      expect(played.status).toBe(404)
      expect(played.redirectedTo).toBe('')
      expect(signedReads).toHaveLength(0)
    })
  })

  it('hands an author-typed hotlink back exactly as stored', async () => {
    seed([{ url: HOTLINK_VIDEO }])
    expect((await play()).redirectedTo).toBe(HOTLINK_VIDEO)
  })

  it('⛔ refuses a value it cannot resolve rather than redirecting to it', async () => {
    // A redirect to `media:junk` was never playable; a 404 says so.
    seed([{ url: 'media:not a reference' }])
    const played = await play()
    expect(played.status).toBe(404)
    expect(played.redirectedTo).toBe('')
  })

  it('serves the video the link was minted for, not the first one', async () => {
    seed([{ url: HOTLINK_VIDEO }, { url: CDN_VIDEO }])
    expect(delivered((await play(1)).redirectedTo).path).toBe(DELIVERED_PATH)
  })

  it('⛔ 404s a video index the product does not have', async () => {
    const played = await play(7)
    expect(played.status).toBe(404)
    expect(played.redirectedTo).toBe('')
  })

  it('⛔ takes no rendition instruction from the caller', async () => {
    // The stream signature covers `(hostId, productId, video, exp)`. An `r` on
    // the stream URL is outside it, so honoring one would let anyone holding
    // a link for a video they ARE entitled to name an object path the mint
    // never authorized. It is ignored, and the redirect is unchanged.
    const query = redeemable((await mint()).body.url)
    const played = await redeem({ ...query, r: '../../etc/passwd' })
    expect(played.status).toBe(302)
    const location = delivered(played.redirectedTo)
    expect(location.path).toBe(DELIVERED_PATH)
    expect(location.r).toBe('auto')
  })
})

/**
 * AGL-2766, the caching half.
 *
 * A 302 to a negotiated URL puts `Vary: Accept` on the SECOND response — the
 * one whose bytes actually depend on `Accept` — and `serveMediaCdn` declares
 * it there (pinned by `serve-media-cdn.video.spec.ts`). This asserts the
 * corollary so that nobody later "completes" the feature by adding it to the
 * redirect.
 */
describe('AGL-2766 · the redirect does not claim to vary', () => {
  it('⛔ declares no Vary on the 302, whatever the client accepts', async () => {
    const played = await play()
    expect(played.status).toBe(302)
    expect(played.headers['Vary']).toBeUndefined()
    expect(played.headers['vary']).toBeUndefined()
  })

  it('keeps the redirect itself out of every cache', async () => {
    // The Location carries a per-session signature; a stored 302 would hand
    // one buyer's session to the next request for the same stream URL.
    expect((await play()).headers['Cache-Control']).toBe('private, no-store')
  })
})
