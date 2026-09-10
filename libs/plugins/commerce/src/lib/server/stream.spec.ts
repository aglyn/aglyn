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
 * The gated stream's redirect (AGL-315), and the delivery copy it lands on
 * (AGL-2766).
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
 * ## Why the URL shapes are enumerated
 *
 * `gatedVideos[].url` is written by the console media picker, which stores
 * the media-CDN path for an org with the `mediaCdn` entitlement and the raw
 * Storage download URL for one without — and older products predate the
 * picker entirely. So a redirect target is not reliably a CDN URL, and the
 * assertions here say what each shape does rather than assuming the good one.
 */

process.env.TOKEN_SIGNING_SECRET = 'stream-spec-secret'

import { MEDIA_CDN_ROUTE, videoDeliverySrc } from '@aglyn/aglyn/server'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { streamHandler } from './stream'

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

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
}))

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
const PRODUCT = 'prod-course'

/**
 * The shapes `gatedVideos[].url` actually holds, and where each comes from.
 *
 * Built from {@link MEDIA_CDN_ROUTE} rather than typed out, so a route that
 * moved would take the fixture with it instead of leaving a string that no
 * longer names this platform's own door — a fixture drifting out of shape is
 * exactly how the assertions below would stay green while proving nothing.
 */
/** The picker's `cdnPath`: an org with the paid `mediaCdn` entitlement. */
const CDN_VIDEO = `${MEDIA_CDN_ROUTE}/org:acme/med-film`
/** The same, pinned to a content hash — the route's immutable form. */
const CDN_VIDEO_PINNED = `${MEDIA_CDN_ROUTE}/org:acme/med-film/abc123def456`
/** An org asset restricted to sites, host-qualified by the picker dialog. */
const CDN_VIDEO_QUALIFIED = `${MEDIA_CDN_ROUTE}/org:acme:${HOST}/med-film`
/** No `mediaCdn` entitlement, or a legacy upload: the raw download URL. */
const RAW_STORAGE_VIDEO =
  'https://firebasestorage.googleapis.com/v0/b/x/o/film.mp4?alt=media&token=t'
/** An author-typed hotlink, which the demo catalog still seeds. */
const HOTLINK_VIDEO = 'https://videos.example.com/w1.m3u8'

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

beforeEach(() => {
  docs.clear()
  mockEntitled = true
  seed([{ url: CDN_VIDEO, title: 'Week 1' }])
})

// ---------------------------------------------------------------------------

/**
 * The fixtures, measured before anything is concluded from them.
 *
 * Every assertion in this file reads "the redirect carries `?r=auto`" or "the
 * redirect is untouched", and a CDN fixture that had drifted out of the
 * route's shape would satisfy BOTH by falling down the pass-through branch.
 * The suite would stay green and prove nothing. So the eligibility of each
 * shape is asserted directly, once, against the builder itself.
 */
describe('the URL shapes this redirect can be handed', () => {
  it('treats the three CDN forms as this platform’s own', () => {
    for (const stored of [CDN_VIDEO, CDN_VIDEO_PINNED, CDN_VIDEO_QUALIFIED]) {
      expect(stored.startsWith(`${MEDIA_CDN_ROUTE}/`)).toBe(true)
      expect(videoDeliverySrc(stored)).toBe(`${stored}?r=auto`)
    }
  })

  it('⛔ treats a raw Storage URL and a hotlink as somebody else’s', () => {
    // Neither has renditions to ask for, and the Storage URL already carries
    // a query — the case that would show a builder appending blindly.
    expect(videoDeliverySrc(RAW_STORAGE_VIDEO)).toBe(RAW_STORAGE_VIDEO)
    expect(videoDeliverySrc(HOTLINK_VIDEO)).toBe(HOTLINK_VIDEO)
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
 * AGL-2766. AGL-2753 gave the Video element `?r=auto` — "the best encoding
 * you hold" — and this player never went through that path, so the audience
 * that has already paid was the one still being sent the master.
 *
 * The parameter belongs at the redirect because nothing upstream can put it
 * there: the player holds a signed URL, not a media reference, and the
 * `Location` is built from the product document rather than from the request.
 */
describe('AGL-2766 · the entitlement hop lands on a delivery copy', () => {
  it('asks the CDN for the best encoding it holds', async () => {
    const played = await play()
    expect(played.status).toBe(302)
    expect(played.redirectedTo).toBe(`${CDN_VIDEO}?r=auto`)
  })

  it('merges the parameter onto a pinned path rather than replacing it', async () => {
    // The immutable form is a year in the browser and the newest half of the
    // corpus; losing the hash segment would drop it back to a minute.
    seed([{ url: CDN_VIDEO_PINNED }])
    expect((await play()).redirectedTo).toBe(`${CDN_VIDEO_PINNED}?r=auto`)
  })

  it('keeps a host-qualified org scope intact', async () => {
    // The qualified scope is what serves an org asset restricted to sites;
    // an unqualified one would 404 for exactly the assets that need it.
    seed([{ url: CDN_VIDEO_QUALIFIED }])
    expect((await play()).redirectedTo).toBe(`${CDN_VIDEO_QUALIFIED}?r=auto`)
  })

  it('⛔ hands a raw Storage URL back exactly as stored', async () => {
    // A free-tier org has no `cdnPath`, so this is what its products hold.
    // It is not our route, it has no renditions, and its query must survive.
    seed([{ url: RAW_STORAGE_VIDEO }])
    expect((await play()).redirectedTo).toBe(RAW_STORAGE_VIDEO)
  })

  it('⛔ hands an author-typed hotlink back exactly as stored', async () => {
    seed([{ url: HOTLINK_VIDEO }])
    expect((await play()).redirectedTo).toBe(HOTLINK_VIDEO)
  })

  it('⛔ still redirects a value the builder cannot resolve', async () => {
    // `videoDeliverySrc` answers undefined for a `media:` value that does not
    // parse, and a redirect to `undefined` is worse than the broken URL it
    // replaced. The fallback keeps this handler's contract: a stored string
    // never loses its redirect by being unimprovable.
    seed([{ url: 'media:not a reference' }])
    const played = await play()
    expect(played.status).toBe(302)
    expect(played.redirectedTo).toBe('media:not a reference')
  })

  it('serves the video the link was minted for, not the first one', async () => {
    seed([{ url: HOTLINK_VIDEO }, { url: CDN_VIDEO }])
    expect((await play(1)).redirectedTo).toBe(`${CDN_VIDEO}?r=auto`)
  })

  it('⛔ 404s a video index the product does not have', async () => {
    const played = await play(7)
    expect(played.status).toBe(404)
    expect(played.redirectedTo).toBe('')
  })

  it('⛔ takes no rendition instruction from the caller', async () => {
    // The signature covers `(hostId, productId, video, exp)`. An `r` on the
    // stream URL is outside it, so honoring one would let anyone holding a
    // link for a video they ARE entitled to name an object path the mint
    // never authorized. It is ignored, and the redirect is unchanged.
    const query = redeemable((await mint()).body.url)
    const played = await redeem({ ...query, r: '../../etc/passwd' })
    expect(played.status).toBe(302)
    expect(played.redirectedTo).toBe(`${CDN_VIDEO}?r=auto`)
  })
})

/**
 * AGL-2766, the caching half.
 *
 * A 302 to a negotiated URL puts `Vary: Accept` on the SECOND response — the
 * one whose bytes actually depend on `Accept` — and `serveMediaCdn` declares
 * it there (pinned by `serve-media-cdn.video.spec.ts`). This asserts the
 * corollary so that nobody later "completes" the feature by adding it to the
 * redirect: the `Location` is a function of the product document alone, and
 * declaring a variance this response does not have splits a cache key that
 * has exactly one representation.
 */
describe('AGL-2766 · the redirect does not claim to vary', () => {
  it('⛔ declares no Vary on the 302, whatever the client accepts', async () => {
    const played = await play()
    expect(played.status).toBe(302)
    expect(played.headers['Vary']).toBeUndefined()
    expect(played.headers['vary']).toBeUndefined()
  })

  it('keeps the redirect itself out of every cache', async () => {
    // The signed URL expires in 15 minutes and is per-member; a stored 302
    // would outlive the entitlement that produced it.
    expect((await play()).headers['Cache-Control']).toBe('private, no-store')
  })
})
