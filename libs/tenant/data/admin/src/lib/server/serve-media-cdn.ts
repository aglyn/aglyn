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
  isLockdownActive,
  isOrgWideScope,
  type LockdownState,
  normalizeHostLockdown,
  normalizeOrgLockdown,
  visibleToHost,
} from '@aglyn/aglyn/server'
import type { NextApiRequest, NextApiResponse } from 'next'
import { firebaseAdmin } from './firebase-admin'
import { getPlatformLockdown } from './lockdown'
import { getMediaQuarantine } from './media-quarantine'
import { verifyMediaAccess } from './media-signing'

/** Variant widths generated at upload (AGL-175). */
export const MEDIA_CDN_VARIANT_WIDTHS = [320, 640, 1280] as const

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The stable (non-content-hashed) URL's caching contract.
 *
 * This was `public, max-age=3600, stale-while-revalidate=86400`, and that
 * header contradicted the promise the stable URL exists to make. Measured on
 * production 2026-08-12: Vercel's edge DOES cache this route on a bare
 * `max-age` (`x-vercel-cache: MISS` then `HIT`, `age` climbing) — so the
 * saving was never in question. What a browser `max-age` breaks is
 * *propagation*. `max-age=3600` reaches the client, so a browser holding a
 * replaced asset will not send a conditional request for a full hour: the
 * ETag below never gets a chance to answer, and nothing on our side can bust
 * a browser cache. Every other cacheable route in the repo already uses
 * `s-maxage` for exactly this reason — see `seo-origin.spec.ts`, "never a
 * browser `max-age`, which nothing could bust".
 *
 * So: a short browser `max-age` that still collapses the burst of repeat
 * requests within one page view (an image referenced by four `srcSet`
 * candidates, a tile rendered in a grid and again in a drawer), and the full
 * hour moved to `s-maxage` where it belongs. Worst stale read is now 60 s of
 * replaced bytes in one browser rather than an hour, at the cost of one
 * conditional request per image per minute — answered by the EDGE from its
 * own copy, so it adds no Storage read and no Firestore read.
 *
 * The immutable content-hashed form is untouched: its URL changes with its
 * bytes, so it can and should be pinned in the browser for a year.
 *
 * Since AGL-1515 this policy applies to IMAGE responses only — see
 * {@link mediaCdnEdgeCacheable}.
 */
export const MEDIA_CDN_STABLE_CACHE_CONTROL =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400'

/**
 * The stable URL's policy for types the edge must never hold (AGL-1515):
 * the same 60-second browser window and the same ETag/304 contract, with
 * `private` in place of `public, s-maxage` so no shared cache stores a
 * full body.
 *
 * Why the edge must never hold one: Vercel's edge, holding a cached
 * full-body 200, answers a `Range` request FROM that entry as a
 * spec-violating hybrid — status 200, a `Content-Range` header, and only
 * the requested slice as the body (`x-vercel-cache: HIT`; reproduced twice
 * on production, 2026-08-13). A video player seeking into such an asset
 * adopts a 100-byte slice as the complete file: silent playback corruption.
 *
 * The S4 shape below this constant was built on Vercel's documented
 * cacheable-response criteria ("Request doesn't contain Range header"),
 * read as "ranged requests bypass the edge". Production falsified that
 * reading: the criteria govern what the edge STORES, not what it SERVES. A
 * ranged request is still matched against the URL-keyed entry a previous
 * plain GET left behind, and the edge's slicing layer rewrites the body
 * and adds `Content-Range` without rewriting the stored 200 status.
 *
 * `private` is the lever because it is in the same documented criteria
 * list as an absolute storage preventer ("Response doesn't contain the
 * `private` … directives"), where `Vary: Range` is undocumented on
 * Vercel, discouraged by RFC 9110, and untestable anywhere but a
 * production deploy. What it costs: edge caching for non-image assets
 * under Vercel's 10 MB cacheable-size cap. Real video mostly sits ABOVE
 * the cap and was never edge-cached — the mangling reproduced on a 186 KB
 * asset precisely because small ones are the ones that get cached.
 */
export const MEDIA_CDN_STABLE_EDGE_BYPASS_CACHE_CONTROL =
  'private, max-age=60'

/** The immutable content-hashed URL's policy for edge-cacheable (image) types. */
export const MEDIA_CDN_IMMUTABLE_CACHE_CONTROL =
  'public, max-age=31536000, immutable'

/**
 * The immutable URL's policy for edge-bypassing types (AGL-1515): the
 * browser keeps its year — the URL still changes with the bytes — while
 * the edge holds nothing it could mangle.
 */
export const MEDIA_CDN_IMMUTABLE_EDGE_BYPASS_CACHE_CONTROL =
  'private, max-age=31536000, immutable'

/**
 * Whether a response of this content type may be edge-cached (AGL-1515).
 *
 * The split is "types no realistic client ranges into": browsers fetch
 * images with plain GETs (`<img>`, `srcSet`, save-as — all of them), while
 * every consumer that seeks or resumes — `<video>`/`<audio>` players, PDF
 * viewers, download managers — operates on the non-image types. Images stay
 * on the shared edge policy because they are the DAM grid's hot path (4.3 KB
 * WebP tiles at volume), and pushing them to origin to fix video would trade
 * a real regression for a theoretical one.
 *
 * Accepted residual, recorded here on purpose: a hand-built `Range` request
 * against an edge-cached IMAGE can still be answered with the hybrid (that
 * is exactly the AGL-1515 favicon repro). No browser or player issues one,
 * and the alternative — `private` on images too — costs the hot path an
 * edge hit rate it measurably has.
 *
 * Unknown or absent types return false: correctness over cache.
 */
export function mediaCdnEdgeCacheable(contentType: unknown): boolean {
  return String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
    .startsWith('image/')
}

/**
 * The CDN's OWN Content-Security-Policy (AGL-1474).
 *
 * An uploaded `image/svg+xml` is a document, not a picture. It passes the
 * `image/*` allowlist, it is stored under whatever type the client declared,
 * and this handler serves it `inline` from the console's own origin — and
 * from every tenant site's, since the same handler mounts in both apps. So
 * `<script>alert(document.domain)</script>` inside an uploaded logo executed
 * on `app.aglyn.com` the moment the asset URL was opened top-level, for
 * anyone with editor rights.
 *
 * Nothing already in place stopped it. `X-Content-Type-Options: nosniff`
 * blocks HTML *mislabelled* as an image; it says nothing about a file
 * honestly labelled `image/svg+xml`, which browsers render as a scripted
 * document. And there was no CSP on this response **at all**: since AGL-523
 * the policy is built per-response in each app's middleware, and both
 * middlewares' matchers exclude `api` (`apps/console/middleware.ts`,
 * `apps/tenant/middleware.ts`), so a directly-navigated CDN URL never passed
 * through the code that sets one.
 *
 * That is precisely why the header is set HERE, on the response, rather than
 * added to a matcher: a route-level header cannot be lost to a matcher edit,
 * a rewrite, or a new mount of `serveMediaCdn` in a third app. It is also
 * what makes this the containment rather than the remediation — it covers
 * every asset already in the bucket, including the SVGs uploaded before the
 * sanitizer existed, without rewriting a byte.
 *
 * **It does not touch `<img src>`, which is how logos and marks are used
 * across this product.** A browser loading an SVG as an image neither runs
 * its script nor applies the response's CSP — CSP governs documents and
 * workers. The policy only becomes live in the case that is the vector: the
 * asset opened as a top-level document (or framed via `<object>`/`<iframe>`).
 */
export const MEDIA_CDN_BASE_CSP =
  "default-src 'none'; script-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'"

/**
 * The policy for a type a browser will treat as an ACTIVE DOCUMENT. Adds
 * `sandbox` — an opaque origin, so even a hypothetical execution has no
 * `document.domain`, no cookies and no storage to reach for.
 *
 * `style-src 'unsafe-inline'` and the two `data:` allowances are not
 * concessions to script: with `script-src 'none'` and `sandbox` in force,
 * nothing in CSS or a data URI can execute. They exist so that opening a
 * logo's URL directly still shows the logo — `default-src 'none'` alone
 * would blank an SVG's own `<style>` block and its embedded raster fills,
 * which is a visible regression on legitimate assets and buys no safety.
 */
export const MEDIA_CDN_ACTIVE_DOCUMENT_CSP =
  `${MEDIA_CDN_BASE_CSP}; style-src 'unsafe-inline'; img-src data:; ` +
  'font-src data:; sandbox'

/**
 * Types a browser parses as a document rather than rendering as an image.
 *
 * Keying off the SERVED content type is sound only because this response also
 * carries `nosniff`: the browser is bound to the label we send, so an SVG
 * uploaded under a `image/png` label is decoded as a PNG and is inert. Every
 * type here except SVG is refused by the upload allowlist today; they are
 * listed anyway because the allowlist has moved before (AGL-1465) and because
 * a legacy fourth upload route accepted arbitrary types for its whole life
 * before AGL-1485 deleted it.
 */
const MEDIA_CDN_ACTIVE_DOCUMENT_TYPES = new Set([
  'image/svg+xml',
  'image/svg',
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  'text/xsl',
  'application/xslt+xml',
  'application/mathml+xml',
])

/** The `Content-Security-Policy` for a response serving `contentType`. */
export function mediaCdnContentSecurityPolicy(contentType: string): string {
  const type = String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  return MEDIA_CDN_ACTIVE_DOCUMENT_TYPES.has(type)
    ? MEDIA_CDN_ACTIVE_DOCUMENT_CSP
    : MEDIA_CDN_BASE_CSP
}

/**
 * The parsed CDN scope segment (AGL-1043). Shapes:
 *
 * - `{hostId}` — that host's own library
 * - `org:{orgId}` — the org library, ORG-WIDE assets only
 * - `org:{orgId}:{hostId}` — an org asset in one site's context
 *
 * The host is in the URL rather than sniffed from the `Host` header on
 * purpose. A header is the requester's CHOICE: anyone holding a restricted
 * asset's id could fetch it through a domain that IS permitted and get the
 * bytes, so header-based enforcement stops accidents while looking like a
 * boundary. Here the decision is a pure function of (URL, doc), and since
 * the cache key IS the URL, one host's answer can never reach another.
 */
export interface MediaCdnScope {
  isOrg: boolean
  scopeId: string
  /** Only on the `org:{orgId}:{hostId}` form. */
  contextHostId?: string
}

export function parseMediaCdnScope(
  scopeSegment: string,
): MediaCdnScope | null {
  if (!scopeSegment.startsWith('org:')) {
    return SEGMENT.test(scopeSegment)
      ? { isOrg: false, scopeId: scopeSegment }
      : null
  }
  const parts = scopeSegment.slice('org:'.length).split(':')
  if (parts.length > 2) return null
  const [scopeId, contextHostId] = parts
  if (!SEGMENT.test(scopeId ?? '')) return null
  if (contextHostId !== undefined && !SEGMENT.test(contextHostId)) return null
  return {
    isOrg: true,
    scopeId,
    ...(contextHostId ? { contextHostId } : {}),
  }
}

/**
 * Whether the asset may be served under this URL. Host-library assets are
 * private by construction and carry no `visibleTo`, so only the org branch
 * is checked.
 */
export function mediaCdnAllows(
  scope: MediaCdnScope,
  visibleTo: unknown,
): boolean {
  if (!scope.isOrg) return true
  const scoped = Array.isArray(visibleTo) ? (visibleTo as string[]) : undefined
  return scope.contextHostId
    ? visibleToHost(scoped, scope.contextHostId)
    : isOrgWideScope(scoped)
}

/**
 * Lockdown on the delivery path (AGL-1520).
 *
 * A security-locked org's SITE stops within seconds (the tenant middleware
 * 503s, AGL-1501) — but until this gate existed its public media kept
 * serving worldwide: to hot-links, to third-party embeds, and to the
 * infected asset's own URL, which for an "infected host" security lock is
 * the exact thing the lock was pressed to stop.
 *
 * **Which reasons stop delivery — decided per reason, not blanket:**
 *
 * - `security` — REFUSE. The point of the lock: the org's content, media
 *   included, must stop serving.
 * - `manual` — REFUSE. A staff suspension with no reason code (every
 *   pre-lockdown `suspendedAt` normalizes to `manual`) is "we turned this
 *   org off"; content continuing to serve would make the kill partial.
 * - `maintenance` — SERVE. The maintenance notice surface may itself
 *   reference org assets (a logo on the notice page), the window is
 *   temporary and non-adversarial, and blanking every image buys no safety.
 * - `billing` — SERVE. The AGL-1506 principle: billing-locked orgs keep the
 *   surfaces that let them come back (members can still reach billing to
 *   pay). The site already 503s, so whether a hot-linked image serves is
 *   nearly moot — and refusing would punish e.g. an email-signature logo
 *   for a payment lapse. Serving is the cheap, reversible answer.
 *
 * Scopes are checked INDIVIDUALLY against that matrix rather than through
 * `resolveLockdown`, on purpose: the resolver answers "which notice does a
 * visitor see" and returns the WIDEST active scope — so a platform
 * `maintenance` window would mask a concurrent org `security` lock and the
 * infected asset would keep serving. Delivery has no notice to pick; the
 * question is only "does ANY active lockdown demand these bytes stop".
 */
export function lockdownStopsMediaDelivery(
  state: LockdownState | null | undefined,
  nowMs: number,
): boolean {
  if (!state || !isLockdownActive(state, nowMs)) return false
  return state.reason === 'security' || state.reason === 'manual'
}

/**
 * **Read cost (AGL-1302):** the verdict inputs are TTL-cached in-process
 * per CDN scope — one org-doc read (host scope: host doc + hostIndex + the
 * owning org doc, since an org lock never stamps host docs) per scope per
 * {@link MEDIA_CDN_LOCK_TTL_MS}, not per asset. A DAM grid firing dozens of
 * requests coalesces into one lookup; the platform doc rides
 * `getPlatformLockdown`'s existing 15s cache. Same fail-open posture as the
 * verdict core: an unreachable Firestore is an outage, not a lockdown, and
 * must not blank every customer image.
 *
 * **Staleness bound, stated rather than hidden:** a warm origin refuses
 * within ≤15s of the org-doc write (the platform panic number). What the
 * origin cannot reach: browsers hold the stable URL up to 60s
 * (`max-age=60`); Vercel's edge holds image responses up to `s-maxage=3600`
 * (+ one stale serve while revalidating) — so an already-edge-cached image
 * URL can serve up to ~1h into a lock; non-image types are `private`
 * (AGL-1515) and never edge-held. The immutable content-hashed form is
 * browser-pinned for a year in clients that already fetched it — there is
 * no per-asset purge API, so that copy is out of reach by design; NEW
 * fetchers of the same URL refuse at the next origin miss. Compare the
 * AGL-1501 drill: host pages flip ≤10s; assets lag minutes-to-an-hour at
 * the caching tiers, which is the accepted trade for a near-zero read cost
 * on the hottest unauthenticated path.
 *
 * **Out of this control's reach entirely:** free-tier raw
 * `firebasestorage.googleapis.com` URLs — no code of ours runs there.
 * Stated on AGL-1520; token rotation on lock is the filed follow-up.
 */
const MEDIA_CDN_LOCK_TTL_MS = 15_000

const lockCache = new Map<string, { at: number; blocked: boolean }>()
const lockPending = new Map<string, Promise<boolean>>()

/**
 * Drop the per-scope lock cache. Tests need it between cases; production
 * convergence is the TTL — the lock is written by the console app and served
 * by the tenant app, different processes an in-process invalidation can
 * never reach.
 */
export function invalidateMediaCdnLockCache(): void {
  lockCache.clear()
  lockPending.clear()
}

/** The `suspended*` field family off a snapshot, for the normalizers. */
const suspensionCarrier = (snapshot: {
  get: (field: string) => unknown
}): {
  suspendedAt?: unknown
  suspendedReasonCode?: unknown
  suspendedUntilMs?: unknown
} => ({
  suspendedAt: snapshot.get('suspendedAt'),
  suspendedReasonCode: snapshot.get('suspendedReasonCode'),
  suspendedUntilMs: snapshot.get('suspendedUntilMs'),
})

/** TTL-cached: does any lockdown covering `scope` stop delivery? */
async function mediaCdnScopeLocked(scope: MediaCdnScope): Promise<boolean> {
  const key = `${scope.isOrg ? 'org' : 'host'}:${scope.scopeId}`
  const cached = lockCache.get(key)
  if (cached && Date.now() - cached.at < MEDIA_CDN_LOCK_TTL_MS) {
    return cached.blocked
  }
  let pending = lockPending.get(key)
  if (!pending) {
    pending = (async () => {
      let blocked = false
      try {
        const nowMs = Date.now()
        // Platform first: cached, and a platform security lock is the panic
        // button — asset delivery is part of what it stops.
        blocked = lockdownStopsMediaDelivery(await getPlatformLockdown(), nowMs)
        const firestore = firebaseAdmin.app().firestore()
        if (!blocked && scope.isOrg) {
          // Org forms (`org:{orgId}` and `org:{orgId}:{hostId}`): the org
          // doc governs. The context host's own lock is not consulted — a
          // suspended HOST's pages 503 already, and which sites may USE an
          // org asset is `visibleTo`'s question, not the lock's.
          const org = await firestore
            .collection('orgs')
            .doc(scope.scopeId)
            .get()
          blocked = lockdownStopsMediaDelivery(
            normalizeOrgLockdown(suspensionCarrier(org)),
            nowMs,
          )
        } else if (!blocked) {
          // Host-library form: the host's own lock, and the OWNING org's —
          // an org lock never stamps host docs (AGL-1506), so a host-only
          // read would silently miss the very lock this issue is about.
          const [host, hostIndex] = await Promise.all([
            firestore.collection('hosts').doc(scope.scopeId).get(),
            firestore.collection('hostIndex').doc(scope.scopeId).get(),
          ])
          blocked = lockdownStopsMediaDelivery(
            normalizeHostLockdown(suspensionCarrier(host)),
            nowMs,
          )
          const orgId = hostIndex.get('orgId')
          if (!blocked && typeof orgId === 'string' && orgId) {
            const org = await firestore.collection('orgs').doc(orgId).get()
            blocked = lockdownStopsMediaDelivery(
              normalizeOrgLockdown(suspensionCarrier(org)),
              nowMs,
            )
          }
        }
      } catch {
        // Fail open — the lockdown core's posture (see lockdown.ts): an
        // unreachable Firestore is an outage, not a lockdown.
        blocked = false
      }
      lockCache.set(key, { at: Date.now(), blocked })
      return blocked
    })().finally(() => {
      lockPending.delete(key)
    })
    lockPending.set(key, pending)
  }
  return pending
}

/**
 * THE delivery-policy seam: "may this asset be served at all?" — one
 * question, one function, consulted once per request before any caching
 * exit. Distinct from `mediaCdnAllows` (which site may use it under this
 * URL) and from the signature check (may the public fetch it): this asks
 * whether the platform is willing to serve the bytes to ANYONE.
 *
 * Two independent reasons to refuse, both answered here so the handler
 * keeps ONE refusal path:
 *
 * - `'locked'` — a lockdown covering this SCOPE (AGL-1520): the whole org
 *   or host is off.
 * - `'quarantined'` — this ASSET is on the deny list (AGL-1512): one
 *   infected, abusive or DMCA-noticed file is off while everything else in
 *   the same workspace keeps serving. That proportionality is the point —
 *   a single bad object should not cost a customer their whole site.
 *
 * Order is scope-then-asset because the scope verdict is the cheaper cached
 * one and the wider fact; the caller does not distinguish them on the wire
 * (both are the same neutral 410), so the order is a cost decision only.
 *
 * Read cost, since this sits on the hottest unauthenticated path: the scope
 * verdict is one read per SCOPE per 15s, and the quarantine deny list is
 * one read per PROCESS per 15s for every asset in existence — it is a
 * single document. Fifty DAM tiles pay two reads between them, not a
 * hundred.
 */
export async function mediaCdnServeBlock(
  scope: MediaCdnScope,
  asset: {
    /**
     * The strong full-width digest (AGL-1614) when the document has one.
     * Preferred over `contentHash` as a quarantine key — it is one
     * algorithm at full width, where `contentHash` is a 64-bit truncation
     * of either sha256 or md5 depending on the ingesting route.
     */
    contentSha256?: string
    contentHash?: string
    /**
     * The raw URL scope segment and media id — the fallback quarantine key
     * for the assets that carry no `contentHash` at all (legacy uploads,
     * and composite objects GCS gives no md5 for). Without it the largest
     * files in the product would be the ones a takedown could not touch.
     */
    scopeSegment?: string
    mediaId?: string
  },
): Promise<'locked' | 'quarantined' | null> {
  if (await mediaCdnScopeLocked(scope)) return 'locked'
  const quarantined = await getMediaQuarantine({
    contentSha256: asset.contentSha256,
    contentHash: asset.contentHash,
    scopeSegment: asset.scopeSegment,
    mediaId: asset.mediaId,
  })
  return quarantined ? 'quarantined' : null
}

/**
 * Whether `?download=1` was asked for (AGL-1411). Strictly opt-in: absent,
 * `0`, `false` or junk all keep the historical `inline`, because the default
 * is what every `<img src>` in every published site relies on.
 *
 * Only `1` and `true` count, rather than "any truthy-looking string". The
 * query string is part of the CDN cache key, so every accepted spelling is a
 * separate edge entry for identical bytes; two is enough.
 */
export function wantsMediaDownload(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value
  const normalized = String(raw ?? '').toLowerCase()
  return normalized === '1' || normalized === 'true'
}

/** Anything that cannot appear literally in an HTTP field-value. */
const NON_ASCII_FIELD_VALUE = /[^\x20-\x7e]/g
/** ...and what additionally cannot appear inside a quoted-string. */
const NOT_QUOTED_STRING_SAFE = /["\\]/g

/**
 * The download name for an asset: the stored `fileName`, reduced to its
 * basename, falling back to the media id (the URL is id-keyed and
 * extensionless, so without a name a "save as" lands as a nameless blob).
 */
export function mediaDownloadName(fileName: unknown, mediaId: string): string {
  const raw = String(fileName ?? '').trim()
  // A stored name can carry a path from whatever uploaded it; only the last
  // segment is a filename, and `..` must never reach a client's save dialog.
  const base = raw.split(/[\\/]/).pop() ?? ''
  // Cap by CODE POINT so a truncation can't split a surrogate pair into a
  // lone half, which is exactly the kind of thing that later throws in a
  // header encoder.
  return Array.from(base).slice(0, 200).join('') || mediaId
}

/**
 * A `Content-Disposition` value for `name` (AGL-1411).
 *
 * A filename is attacker-adjacent data — it is whatever the uploader typed —
 * and it is being pasted into a header, so a quote or a CRLF in it is a
 * header-injection vector. The old code stripped `["\\\r\n]` and left
 * everything else, which is safe against injection but silently mangles the
 * name and passes non-ASCII through raw: a byte above 0x7e in a header is
 * either mojibake at the client or, on a stricter encoder than ours, a
 * throw. So both forms of RFC 6266 §4.1 are emitted:
 *
 * - `filename="…"` — ASCII only, every unrepresentable character replaced
 *   (not dropped) so the extension and the shape of the name survive. This
 *   is the fallback, and it always exists.
 * - `filename*=UTF-8''…` — RFC 8187 percent-encoding of the real name, added
 *   only when the ASCII form actually lost something. Every current browser
 *   prefers it, so a non-ASCII name arrives intact.
 */
export function mediaContentDisposition(
  name: string,
  options: { download: boolean },
): string {
  const type = options.download ? 'attachment' : 'inline'
  const ascii = name
    .replace(NON_ASCII_FIELD_VALUE, '_')
    .replace(NOT_QUOTED_STRING_SAFE, '_')
  const header = `${type}; filename="${ascii}"`
  if (ascii === name) return header
  // `encodeURIComponent` leaves `!'()*` alone, and `'`, `(`, `)` and `*` are
  // not `attr-char` (RFC 8187 §3.2.1) — a bare `'` in particular would be
  // read as the charset/language delimiter. Encode them too.
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  )
  return `${header}; filename*=UTF-8''${encoded}`
}

/**
 * A parsed `Range` request (AGL-1442 S4). Three answers, and the difference
 * between the last two is the whole game:
 *
 * - `{ start, end }` — a single satisfiable byte range, both ends INCLUSIVE
 *   (matching `createReadStream`, which is where the numbers go).
 * - `'unsatisfiable'` — syntactically a range, but nothing in it can be
 *   served (`start` past EOF, `-0`, an empty object). RFC 9110 §14.1.2 says
 *   this one earns a 416.
 * - `null` — everything else: no header, another unit, a multi-range, or
 *   malformed syntax. RFC 9110 §14.2 lets a server ignore a Range header
 *   outright, and ignoring means a full 200 — which is both the safe answer
 *   and the pre-S4 behavior, so every shape this parser does not positively
 *   recognise degrades to exactly what shipped before it existed.
 *
 * Multi-range requests land in `null` DELIBERATELY. Serving them needs a
 * `multipart/byteranges` body with generated boundaries; no browser sends
 * them for media (a `<video>` seek is always one range), and a 416 would be
 * wrong because a multi-range over a real file is satisfiable. A full 200
 * is the RFC-sanctioned refusal that no client can misread.
 */
export type MediaCdnRange = { start: number; end: number } | 'unsatisfiable' | null

export function parseMediaCdnRange(
  header: unknown,
  size: number,
): MediaCdnRange {
  if (typeof header !== 'string') return null
  const unit = /^bytes=(.*)$/i.exec(header.trim())
  if (!unit) return null
  const specs = unit[1].split(',')
  if (specs.length !== 1) return null
  const spec = /^(\d*)-(\d*)$/.exec(specs[0].trim())
  if (!spec) return null
  const [, startRaw, endRaw] = spec
  if (!startRaw && !endRaw) return null
  if (!startRaw) {
    // Suffix form `bytes=-N`: the LAST N bytes. `-0` names zero bytes and a
    // 200 would over-answer it, so it is the one suffix that 416s.
    const suffix = Number(endRaw)
    if (!Number.isSafeInteger(suffix)) return null
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startRaw)
  if (!Number.isSafeInteger(start)) return null
  const end = endRaw ? Number(endRaw) : size - 1
  if (!Number.isSafeInteger(end)) return null
  // `bytes=5-2` is a syntax error, not an unsatisfiable range — ignore it.
  if (endRaw && end < start) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

/**
 * CDN media delivery (AGL-175 / AGL-829). Two URL shapes resolve the same
 * asset by `mediaId`, so delivery never depends on the object's storage
 * location (folder moves don't change the URL):
 *
 * - **Stable** `/api/media/cdn/[scope]/[mediaId]` — always serves the
 *   asset's CURRENT bytes, so it survives a **replace** too. Revalidated
 *   with an ETag (the content hash) + `stale-while-revalidate`, so a
 *   replaced asset propagates without ever breaking references. This is
 *   the URL the console hands out.
 * - **Immutable** `/api/media/cdn/[scope]/[mediaId]/[contentHash]` —
 *   year-long `immutable` cache; the hash must match the current content,
 *   so it can never serve stale bytes (older embeds keep working until the
 *   asset is replaced, then that exact URL 404s by design).
 *
 * `?w=[width]` selects a generated WebP variant. `?download=1` swaps the
 * `Content-Disposition` from `inline` to `attachment` (AGL-1411) — the press
 * kit hands out links that must SAVE rather than open a tab. Both are read
 * only after every access gate, so neither can widen what is served; both
 * are part of the CDN cache key, so neither variant can poison the other.
 * The same handler mounts in both the tenant and console apps; raw storage
 * URLs already embedded in screens keep working unchanged.
 *
 * Single byte-range requests are honored with a 206 (AGL-1442 S4) — see
 * {@link parseMediaCdnRange} and the block below `Accept-Ranges` for the
 * exact semantics. This is the capability whose absence kept video on raw
 * `firebasestorage.googleapis.com` URLs (S8): a `<video>` seek is a Range
 * request, and a server that ignores it forces the player to re-download
 * the whole file.
 */
export async function serveMediaCdn(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  // AGL-1474, set FIRST so no exit from this handler can be reached without
  // it — including the refusals, the 304 and the 500. Upgraded below to the
  // sandboxing form once the served content type is known. `nosniff` is
  // repeated here rather than left to the app config's `/(.*)` header: the
  // policy above keys off the declared type, so this response has to carry
  // the header that makes the declared type binding, on its own.
  res.setHeader('Content-Security-Policy', MEDIA_CDN_BASE_CSP)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    res.status(405).end()
    return
  }
  const path = Array.isArray(req.query['path']) ? req.query['path'] : []
  const [scopeSegment, mediaId, hash] = path.map((value) =>
    String(value ?? ''),
  )
  const scope = parseMediaCdnScope(scopeSegment)
  const isOrg = scope?.isOrg ?? false
  const scopeId = scope?.scopeId ?? ''
  // 3 segments = the immutable content-hashed URL; 2 = the stable URL.
  const hashed = path.length === 3
  if (
    !scope ||
    (path.length !== 2 && path.length !== 3) ||
    !SEGMENT.test(mediaId) ||
    (hashed && !SEGMENT.test(hash))
  ) {
    res.status(400).json({ error: 'Bad media path' })
    return
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collection(isOrg ? 'orgs' : 'hosts')
      .doc(scopeId)
      .collection('media')
      .doc(mediaId)
      .get()
    const currentHash = String(snapshot.get('contentHash') ?? '')
    if (!snapshot.exists || snapshot.get('deletedAt')) {
      res.setHeader('Cache-Control', 'public, max-age=60')
      res.status(404).json({ error: 'Not found' })
      return
    }
    // Delivery gate — scope lockdown (AGL-1520) and asset quarantine
    // (AGL-1512). See mediaCdnServeBlock for the reason matrix, the
    // read-cost accounting and the staleness bound. Three shape decisions,
    // argued, and all three apply to BOTH refusal kinds:
    //
    // **Before the ETag/304 exit**, necessarily: a browser revalidating its
    // 60s copy during a lock or a quarantine must be refused, not handed a
    // 304 that renews the copy for another minute.
    //
    // **410, not 423, and identical for both kinds.** The 423 body is the
    // AGL-1506 discipline for authenticated API consumers who deserve
    // "suspended: billing"; this response answers anonymous `<img>` fetches
    // nobody parses, and a 423 would confirm to any prober that a lock
    // exists — which for a security lock is information. It is information
    // for a quarantine too, and of a worse kind: the existence of a DMCA
    // notice or a malware finding on a specific file is not something an
    // anonymous fetcher has standing to learn, and telling quarantine apart
    // from lockdown on the wire would leak which one it was. So the owning
    // org learns the reason in the console (`mediaQuarantineNotice`), and
    // the CDN says only `410 Gone` — neutral, indistinguishable in kind
    // from a deleted asset, and a hint to well-behaved consumers to drop
    // the link. (404 would also be neutral, but 410's "permanently gone"
    // semantics discourage retry loops from embedders.)
    //
    // **`no-store`, absolutely** (the AGL-1515 lesson): the refusal is a
    // function of a TTL'd verdict, not of the URL — a cached refusal would
    // weld the asset's URL identity to "gone" past the unlock, and edge
    // entries have no per-asset purge. The 60s negative window the 404s use
    // is not acceptable here either. For quarantine that argument is
    // strictly stronger than for lockdown: REVERSIBILITY is the whole
    // reason quarantine exists instead of deletion, so a cached 410 that
    // outlived the lift would defeat the feature's only advantage over the
    // irreversible option. The refusal is also nearly free to re-serve —
    // the verdict is one Firestore read per process per 15s for the entire
    // deny list, and the body is a few bytes with no Storage read — so
    // there is no saving to weigh against it. CSP + nosniff are already on
    // the response (set first, before any exit).
    const blockedBy = await mediaCdnServeBlock(scope, {
      // The strong digest is read for the quarantine key ONLY. It is
      // deliberately not the ETag and not the immutable URL segment
      // (AGL-1614): changing either of those would change live URLs and
      // cache validators for every existing asset, and this change must be
      // additive to the point of being invisible on the wire.
      contentSha256: String(snapshot.get('contentSha256') ?? ''),
      contentHash: currentHash,
      scopeSegment,
      mediaId,
    })
    if (blockedBy) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(410).json({ error: 'Gone' })
      return
    }
    // Scope check (AGL-1043). The bare `org:` form serves ORG-WIDE assets
    // only; a restricted asset must be requested through the form that
    // names the site using it. Today every asset is `['org']` after the
    // AGL-1040 backfill, so this is a no-op on existing URLs and starts
    // biting exactly when someone restricts an asset — which is when
    // AGL-1045's confirmation already warns which pages are affected.
    //
    // 404 rather than 403: whether a restricted asset exists is itself
    // something the caller has no standing to learn. Short max-age so
    // re-widening a scope propagates quickly instead of being pinned by a
    // long-lived negative cache entry.
    if (!mediaCdnAllows(scope, snapshot.get('visibleTo'))) {
      res.setHeader('Cache-Control', 'public, max-age=60')
      res.status(404).json({ error: 'Not found' })
      return
    }
    /**
     * Private assets (AGL-1051) leave the public model entirely: no
     * `cdnPath`, and no bytes without an unexpired signature. This is a
     * different question from the scope check above — that one asks which
     * SITE may use the asset, this one asks whether the public may fetch
     * it at all.
     *
     * `no-store`, not a short max-age. Every other response here is safe to
     * cache because it is the same answer for everyone, but a signed
     * request is per-caller and time-boxed: letting a shared cache keep
     * either the denial OR the bytes would outlive the signature and hand
     * the asset to the next requester on the same URL.
     *
     * Which is why the header goes through `setCacheControl` from here on
     * rather than `res.setHeader` — the private case has to win at EVERY
     * exit, and remembering that at each of six call sites is precisely
     * the kind of thing that gets missed when a seventh is added. It
     * already was: the stale-hash 404 below used to overwrite `no-store`
     * with `public, max-age=60`.
     */
    const isPrivate = snapshot.get('private') === true
    const setCacheControl = (value: string) => {
      res.setHeader('Cache-Control', isPrivate ? 'private, no-store' : value)
    }
    if (isPrivate) {
      const signed = verifyMediaAccess(scopeSegment, mediaId, {
        exp: Number(req.query['exp'] ?? 0),
        sig: String(req.query['sig'] ?? ''),
      })
      setCacheControl('private, no-store')
      if (!signed) {
        res.status(404).json({ error: 'Not found' })
        return
      }
    }
    // The immutable form must pin the current content; a stale hash 404s so
    // the edge never keeps serving replaced bytes under that URL.
    if (hashed && currentHash !== hash) {
      setCacheControl('public, max-age=60')
      res.status(404).json({ error: 'Not found' })
      return
    }

    const width = Number(req.query['w'] ?? 0)
    const variants: number[] = snapshot.get('variants') ?? []
    const useVariant = Boolean(width) && variants.includes(width)
    // Read only here, past every gate — a refusal above returns before the
    // parameter is ever looked at, so `?download=1` can never be the reason
    // a response happens (AGL-1411).
    const download = wantsMediaDownload(req.query['download'])

    // Stable URL: revalidate against an ETag so a replaced asset is picked
    // up (a conditional GET returns 304 while the content is unchanged).
    //
    // The disposition is part of the ETag for the same reason the variant
    // width is. The query string is already part of the CDN cache key, so
    // the two URLs are separate edge entries — but a validator is not scoped
    // to a URL in practice: a client holding the inline ETag that revalidates
    // the download URL would be answered 304 and reuse its stored INLINE
    // headers, and the file would open in a tab anyway. Same bytes, different
    // representation, so: different validator.
    const etag = currentHash
      ? `"${currentHash}${useVariant ? `-w${width}` : ''}${download ? '-dl' : ''}"`
      : null
    // AGL-1515: which cache tier may hold this response is a function of the
    // served type — see mediaCdnEdgeCacheable. Decided here from the DOC's
    // type (a variant serve is always `image/webp`) because the 304 exit
    // below runs before the Storage metadata read; re-derived from the
    // authoritative served type once metadata is in hand.
    const stableCacheControlFor = (type: unknown) =>
      mediaCdnEdgeCacheable(type)
        ? MEDIA_CDN_STABLE_CACHE_CONTROL
        : MEDIA_CDN_STABLE_EDGE_BYPASS_CACHE_CONTROL
    const docServedType = useVariant
      ? 'image/webp'
      : snapshot.get('contentType')
    if (!hashed) {
      setCacheControl(stableCacheControlFor(docServedType))
      if (etag) res.setHeader('ETag', etag)
      if (etag && req.headers['if-none-match'] === etag) {
        res.status(304).end()
        return
      }
    }

    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'])
    // Real folders: the doc records its object path; legacy assets fall
    // back to the flat layout.
    const basePath =
      (snapshot.get('storagePath') as string | undefined) ||
      `${isOrg ? 'orgs' : 'hosts'}/${scopeId}/media/${mediaId}`
    const objectPath = useVariant ? `${basePath}__w${width}.webp` : basePath
    const file = bucket.file(objectPath)
    const [metadata] = await file.getMetadata().catch(() => [null as any])
    if (!metadata) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const servedType = useVariant
      ? 'image/webp'
      : String(
          metadata.contentType ??
            snapshot.get('contentType') ??
            'application/octet-stream',
        )
    res.setHeader('Content-Type', servedType)
    // AGL-1474: an SVG (or anything else a browser treats as a document) gets
    // the sandboxing policy. Everything else keeps the base one set above —
    // `sandbox` is withheld from raster and PDF responses on purpose, since it
    // would change how a directly-opened PDF is handled for no security gain.
    res.setHeader(
      'Content-Security-Policy',
      mediaCdnContentSecurityPolicy(servedType),
    )
    // Range support (AGL-1442 S4) — this is what lets video ride this route
    // at all: a `<video>` seek is a Range request, and before S4 the raw
    // storage URL was the only server that would answer one.
    //
    // `Accept-Ranges` is advertised unconditionally because it is now TRUE
    // unconditionally — the handler honors a single byte-range for every
    // asset class. Limiting it to "types that benefit" would only teach a
    // PDF viewer or a download manager not to ask for something we would
    // happily serve, and the header is not part of any cache key.
    //
    // Caching shape (AGL-1515): S4 read Vercel's cacheable-response
    // criteria ("Request doesn't contain Range header") as "a cached full
    // body and a function-served partial can never cross". Production
    // falsified that: the criteria govern what the edge STORES, not what it
    // SERVES, and the edge answers a ranged request from an existing cached
    // full-body 200 as a 200 + Content-Range + sliced-body hybrid. The fix
    // is upstream of this line — every type a ranged consumer actually uses
    // is served `private` (see mediaCdnEdgeCacheable), so the entry the
    // edge would mangle never exists and every ranged request reaches this
    // function for a real 206. In the browser the 206 rides the same
    // Cache-Control as its URL class: a 206 under a STRONG validator is
    // exactly what lets a player reuse the segments it already fetched.
    res.setHeader('Accept-Ranges', 'bytes')
    // The authoritative tier decision, now that the served type is known
    // from Storage metadata rather than inferred from the doc. Overwrites
    // the header set before the 304 exit iff the two disagree — and the
    // BODY-serving response is the one the edge could store, so this one
    // must win.
    if (!hashed) setCacheControl(stableCacheControlFor(servedType))
    const size = Number(metadata.size ?? NaN)
    // Range applies to GET only (RFC 9110 §14.2); a HEAD answers the full
    // representation's metadata. And with no known size there is no honest
    // `Content-Range` to write, so the header is ignored and the full body
    // served — the degradation every unrecognised shape shares.
    const parsed =
      req.method === 'GET' && Number.isFinite(size) && size >= 0
        ? parseMediaCdnRange(req.headers['range'], size)
        : null
    // `If-Range`: the client is saying "this range is against version X; if
    // you hold anything else, send me the whole file". Honoring the range on
    // a mismatch is how a stale player splices two versions of a video into
    // one stream — so anything but an exact match with the CURRENT strong
    // validator (including a date form, and including the no-hash legacy
    // shape that has no validator at all) collapses to a full 200.
    const ifRange = req.headers['if-range']
    const range =
      parsed !== null && typeof ifRange === 'string' && ifRange !== etag
        ? null
        : parsed
    if (range === 'unsatisfiable') {
      // The refusal is a function of the REQUEST header, not the URL, and
      // shared caches key on the URL — no cache may keep it.
      setCacheControl('private, no-store')
      res.setHeader('Content-Range', `bytes */${size}`)
      res.status(416).end()
      return
    }
    const partial = range !== null && typeof range === 'object'
    const servedBytes = partial
      ? range.end - range.start + 1
      : Number(metadata.size ?? 0)
    if (partial) {
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      res.setHeader('Content-Length', String(servedBytes))
    } else if (metadata.size) {
      res.setHeader('Content-Length', String(metadata.size))
    }
    // Give downloads a real filename+extension (AGL-834): the URL is
    // mediaId-keyed and extensionless, so without this a "save image" lands
    // as a name-less blob. `?download=1` makes it an actual download rather
    // than a tab (AGL-1411).
    res.setHeader(
      'Content-Disposition',
      mediaContentDisposition(
        mediaDownloadName(snapshot.get('fileName'), mediaId),
        { download },
      ),
    )
    // `immutable` for a year is the strongest possible caching, and on a
    // private asset it would be a permanent public copy of a file whose
    // whole point is that it expires (AGL-1051) — `setCacheControl` holds
    // that line. The year stays browser-only for non-image types
    // (AGL-1515): the URL still changes with the bytes, but the edge must
    // hold no full body it could slice.
    if (hashed) {
      setCacheControl(
        mediaCdnEdgeCacheable(servedType)
          ? MEDIA_CDN_IMMUTABLE_CACHE_CONTROL
          : MEDIA_CDN_IMMUTABLE_EDGE_BYPASS_CACHE_CONTROL,
      )
    }

    // Delivery volume (AGL-176): per-asset serves/bytes on the AGL-82
    // analytics day-doc, fire-and-forget. Only cache MISSES reach this
    // code — edge-cached responses aren't counted, so these are origin
    // serves, not user-facing totals (billing accuracy is AGL-41's job).
    // Hot-doc note: a single day-doc caps at ~1 write/sec sustained;
    // acceptable at current traffic, shard or sample if an asset gets hot.
    const day = new Date().toISOString().slice(0, 10)
    void firestore
      .collection(isOrg ? 'orgs' : 'hosts')
      .doc(scopeId)
      .collection('analytics')
      .doc(day)
      .set(
        {
          media: {
            [mediaId]: {
              serves: firebaseAdmin.firestore.FieldValue.increment(1),
              // The bytes that actually leave, not the object's size — a
              // seek in a 200 MB video is a few MB of egress, and counting
              // the full object per range would overstate delivery by the
              // number of seeks (AGL-1442 S4).
              bytes: firebaseAdmin.firestore.FieldValue.increment(servedBytes),
            },
          },
        },
        { merge: true },
      )
      .catch(() => undefined)
    if (req.method === 'HEAD') {
      res.status(200).end()
      return
    }
    if (partial) res.status(206)
    // `start`/`end` are inclusive in `createReadStream`, matching the parsed
    // range — GCS is asked for exactly the requested bytes and nothing is
    // over-read from Storage on a partial serve.
    await new Promise<void>((resolve, reject) => {
      file
        .createReadStream(partial ? { start: range.start, end: range.end } : {})
        .on('error', reject)
        .on('end', resolve)
        .pipe(res)
    })
  } catch (error) {
    console.error('serveMediaCdn failed', scopeSegment, mediaId, error)
    if (!res.headersSent) res.status(500).json({ error: 'Delivery failed' })
    else res.end()
  }
}
