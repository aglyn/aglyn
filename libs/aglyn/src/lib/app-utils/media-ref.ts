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
 * Media references (AGL-1215).
 *
 * A node used to persist a media asset's URL. First the firebasestorage
 * download URL, which names the object's CURRENT location — a folder move
 * physically copies the object, rewrites `url` and DELETES the original, so
 * every node holding the old one 404s forever. The first pass at this issue
 * (`b27d96791`) switched the picker to the mediaId-keyed CDN path
 * `/api/media/cdn/{scope}/{mediaId}`, which fixed that.
 *
 * It left a smaller version of the same bug. The persisted document is now
 * coupled to a ROUTE SHAPE — a delivery detail that has already changed once
 * (AGL-829 added the content-hashed third segment) and belongs to the app,
 * not to the content. Change the route and every screen, layout, component
 * and template document on every host has to be migrated in lockstep, in
 * both storage forms, or the sites break. A document should record WHICH
 * ASSET; how to fetch it is the renderer's business.
 *
 * So a node stores `media:{scope}/{mediaId}` and the URL is built at render
 * time. {@link MEDIA_CDN_ROUTE} below is then the only place in the codebase
 * that knows the route shape, and changing it is a deploy rather than a
 * migration.
 *
 * ## Why a token in the existing string field, not `mediaId` + `mediaScope`
 *
 * 1. **"Browse media" is one callback that writes one string.** The besigner
 *    offers it for every media-bearing attribute it can spot — `src`,
 *    `poster`, `imageUrl` — and hands back a single value. A dedicated prop
 *    PAIR would fix `image.src` only, and would need the picker to learn
 *    which component pairs which props. A token flows through the plumbing
 *    that already exists and covers every one of those fields at once.
 * 2. **Two fields are two fields that can disagree.** `src` has to survive
 *    regardless — an author-typed external URL (a hotlinked image) is a real
 *    and supported case — so a `mediaId` prop would need a precedence rule
 *    against `src` anyway, and a stale `src` sitting next to a fresh
 *    `mediaId` is invisible until someone clears the reference. One field
 *    holds one value, and what it is is decidable from the value itself.
 * 3. **The field already carries non-URL values.** `{{var:id}}` binding
 *    tokens live in exactly this position and resolve at render. A media
 *    reference is the same kind of thing, and reads that way to an author.
 *
 * ## The content pin names bytes, and no URL is built from it (AGL-2798)
 *
 * A reference may carry the asset's content hash — `media:{scope}/{id}@{hash}`
 * (AGL-2685). It parses, it round-trips and the where-used scan matches it,
 * but {@link resolveMediaSrc} ignores it: a pinned reference resolves to the
 * same stable URL as an unpinned one.
 *
 * The pin used to resolve to the CDN's content-hashed form,
 * `/api/media/cdn/{scope}/{id}/{hash}`, which is served `immutable` for a
 * year. The case for it was that a stale hash 302s to the stable URL, so a
 * replace would cost one extra hop. That hop only happens when a request
 * reaches the handler, and an immutable response is precisely the one nothing
 * asks about again: Vercel's edge stores it and answers from its copy
 * (measured on production, `MISS` then `HIT`), and every browser that fetched
 * it keeps its own. A page naming that URL showed the replaced bytes for as
 * long as either copy lived, and a replace has to reach every place the asset
 * is used.
 *
 * The two ways to keep the year-long URL were weighed and refused:
 *
 * 1. **Purge the edge on replace.** A purge cannot reach a browser's copy,
 *    and it puts a credentialled call to a third-party API on the replace
 *    path that has to fail soft — the argument `media-takedown-reach.ts`
 *    makes about takedowns.
 * 2. **Re-pin every stored reference on replace.** A write fan-out into
 *    published versions, found by a where-used scan that caps its own work,
 *    and it still leaves every copy of the old URL outside our documents — a
 *    sent email, a feed reader, a hotlink — on the year-long promise.
 *
 * The stable URL is revalidated rather than trusted: a 60-second browser
 * window, an ETag answered with a 304, an hour at the edge. A replace reaches
 * it on every surface within that bound with nothing to re-publish, which is
 * how every reference written before pins existed has always behaved.
 *
 * References that already carry a pin keep it. Nothing strips one, and a hash
 * recording which bytes an author placed stays available to anything that
 * wants to check them; {@link mediaNodeSrc} simply mints no new ones.
 *
 * ## What is still NOT stored
 *
 * The entitlement decision — see {@link mediaNodeSrc}, which is why a
 * free-tier org keeps getting a raw storage URL rather than a reference.
 */

/**
 * The media delivery route. The ONE literal a route change has to touch —
 * everything else derives from it. Kept in the framework package rather than
 * next to the handler because the handler lives in a server-only lib that a
 * plugin component cannot import.
 */
import { TENANT_APEX } from './host-naming'

export const MEDIA_CDN_ROUTE = '/api/media/cdn'

/**
 * The WebP variant widths generated at upload (AGL-175), and the widths a
 * renderer may advertise in a `srcSet`.
 *
 * Here rather than beside the handler for the reason above: `serveMediaCdn`
 * lives in a server-only lib that a plugin component cannot import, and the
 * renderer needs the same list. It was duplicated as a bare `[320, 640, 1280]`
 * literal in `libs/plugins/mui/.../image.tsx`, so a width added to the
 * generator never reached the markup.
 *
 * ⚠️ 1920 EXISTS SO THE LARGEST CANDIDATE IS STILL A VARIANT (2026-08-26).
 *
 * The srcSet used to top out with the BARE url labelled `1920w` — the only
 * candidate that is never WebP. With `sizes="100vw"` any retina desktop needs
 * more effective pixels than 1280w offers, so that bare candidate is the one
 * most desktop visitors actually download. Measured on aglyn.com's own
 * assets: 335 KB / 305 KB / 164 KB PNG originals against 4 KB / 4 KB / 5 KB
 * WebP at `?w=320` — and ~94% of a media serve is bandwidth (AGL-1442).
 *
 * `mediaVariantWidthsFor` drops any width at or above the source width, so
 * adding 1920 generates a fourth variant only for originals genuinely wider
 * than that, and `serveMediaCdn` serves the original for a width an asset
 * does not have. Both directions degrade to exactly today's bytes.
 *
 * ⛔ EXISTING ASSETS HAVE NO 1920 VARIANT until a backfill runs, so they keep
 * answering `?w=1920` with the original — no regression, and no saving on
 * them either. The backfill is a `sharp` pass over the corpus, a script and
 * not a patch (AGL-1442 S7).
 */
export const MEDIA_CDN_VARIANT_WIDTHS = [320, 640, 1280, 1920] as const

/**
 * The variant width a surface asks for when it can only ask for ONE.
 *
 * An `<img>` hands the browser {@link MEDIA_CDN_VARIANT_WIDTHS} and lets it
 * choose. A `<video poster>` attribute and a `thumbnailUrl` in structured data
 * each take a single url, so they have to name a width — and it has to be the
 * SAME width, or a crawler fetching the thumbnail gets different bytes from
 * the visitor looking at the poster. 1280 is the widest generated variant on a
 * 1920 original.
 */
export const MEDIA_CDN_POSTER_WIDTH = 1280

/**
 * Scheme of a stored media reference. Chosen so `startsWith` is a decision:
 * no URL, path, or `{{binding}}` an author can type begins with it, and it
 * is not a registered URL scheme, so a browser handed one by mistake fails
 * loudly rather than fetching something.
 */
export const MEDIA_REF_PREFIX = 'media:'

/**
 * What separates the media id from the optional content pin (AGL-2685).
 *
 * `@` because it cannot occur in either half: {@link SEGMENT_SOURCE} is
 * `[A-Za-z0-9_-]`, so the FIRST `@` after the media id is unambiguously the
 * boundary, and a reference written before pins existed contains none.
 */
export const MEDIA_REF_HASH_SEPARATOR = '@'

const ORG_SCOPE_PREFIX = 'org:'

/**
 * One path segment. Mirrors the `SEGMENT` grammar `serveMediaCdn` validates
 * requests against — deliberately a copy, not an import: that one is the
 * authority because it must distrust the network, and this one exists so we
 * never MINT or emit a reference the CDN would reject. Divergence shows up
 * as a 400 in a dev smoke, not as a security hole.
 */
const SEGMENT_SOURCE = '[A-Za-z0-9_-]{1,64}'
const SEGMENT = new RegExp(`^${SEGMENT_SOURCE}$`)

/** A parsed reference. `scope` is the CDN scope segment, unencoded. */
export interface MediaRef {
  /** `{hostId}`, `org:{orgId}`, or `org:{orgId}:{hostId}`. */
  scope: string
  mediaId: string
  /**
   * The content pin, when the reference carries one (AGL-2685). Absent on
   * every reference written before pins existed, which is the majority and
   * stays correct forever.
   */
  contentHash?: string
}

/** Whether a scope segment is one the CDN would accept. */
export function isMediaCdnScope(scope: string): boolean {
  if (!scope.startsWith(ORG_SCOPE_PREFIX)) return SEGMENT.test(scope)
  const parts = scope.slice(ORG_SCOPE_PREFIX.length).split(':')
  if (parts.length < 1 || parts.length > 2) return false
  return parts.every((part) => SEGMENT.test(part))
}

/**
 * Mints the stored form. Returns undefined rather than emitting junk.
 *
 * A `contentHash` that does not fit the segment grammar is DROPPED rather
 * than refused: the pin is an optimisation, and returning undefined for it
 * would turn a bad hash into no reference at all — an image that stops
 * rendering because a cache hint was malformed.
 */
export function formatMediaRef(
  scope: string | undefined | null,
  mediaId: string | undefined | null,
  contentHash?: string | undefined | null,
): string | undefined {
  if (!scope || !mediaId) return undefined
  if (!isMediaCdnScope(scope) || !SEGMENT.test(mediaId)) return undefined
  const pin =
    contentHash && SEGMENT.test(contentHash)
      ? `${MEDIA_REF_HASH_SEPARATOR}${contentHash}`
      : ''
  return `${MEDIA_REF_PREFIX}${scope}/${mediaId}${pin}`
}

/** Whether a persisted value is a media reference rather than a URL. */
export function isMediaRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MEDIA_REF_PREFIX)
}

/** Reads a stored reference apart; null when it isn't a well-formed one. */
export function parseMediaRef(value: unknown): MediaRef | null {
  if (!isMediaRef(value)) return null
  const rest = value.slice(MEDIA_REF_PREFIX.length)
  // The scope segment may contain `:` but never `/`, so the FIRST slash is
  // the boundary and the media id is everything after it.
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const scope = rest.slice(0, slash)
  // The media id may be followed by `@{contentHash}` (AGL-2685). Neither half
  // can contain `@`, so the first one is the boundary.
  const tail = rest.slice(slash + 1)
  const at = tail.indexOf(MEDIA_REF_HASH_SEPARATOR)
  const mediaId = at === -1 ? tail : tail.slice(0, at)
  const contentHash = at === -1 ? undefined : tail.slice(at + 1)
  if (!isMediaCdnScope(scope) || !SEGMENT.test(mediaId)) return null
  // A malformed pin loses the PIN, never the reference — the asset is still
  // named, and the stable URL still serves it.
  if (contentHash !== undefined && !SEGMENT.test(contentHash))
    return { scope, mediaId }
  return contentHash === undefined
    ? { scope, mediaId }
    : { scope, mediaId, contentHash }
}

/**
 * Whether a value is a media-library CDN **path** — exactly what the media
 * picker writes (AGL-2286).
 *
 * `MediaUrlField`'s `onPick` hands back `media.cdnPath`, which is
 * `/api/media/cdn/{scope}/{mediaId}` and is never absolute. Several save
 * routes validated their URL field with a bare `^https://` test and so
 * refused every asset their own Browse button could produce. AGL-2247 fixed
 * that for the white-label branding profile with a private regex inside
 * `apps/console/app/api/_lib/branding-url.ts`; this is that predicate
 * promoted to the module that already owns the grammar, because the org
 * profile logo and the member avatar had the same defect and live in a lib
 * `apps/console` cannot be imported from.
 *
 * Deliberately NOT {@link isMediaCdnUrl}, which asks a different question
 * with `includes()` and would answer yes to `https://evil.example/x/api/media/cdn/a/b`.
 * A validator needs the strict form, so this mirrors {@link parseMediaRef}
 * exactly — same first-slash boundary, same `isMediaCdnScope` and `SEGMENT`
 * checks — rather than re-deriving a regex that could drift from the route
 * the path is about to be served by.
 */
export function isMediaCdnPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const prefix = `${MEDIA_CDN_ROUTE}/`
  if (!value.startsWith(prefix)) return false
  const rest = value.slice(prefix.length)
  // The scope segment may contain `:` but never `/`, so the FIRST slash is
  // the boundary and the media id is everything after it.
  const slash = rest.indexOf('/')
  if (slash <= 0) return false
  const scope = rest.slice(0, slash)
  const mediaId = rest.slice(slash + 1)
  return isMediaCdnScope(scope) && SEGMENT.test(mediaId)
}

/**
 * Rewrites an org scope so it names the site doing the rendering — the
 * scope-segment twin of `hostQualifiedCdnPath` (AGL-1043).
 *
 * `org:{orgId}` serves ORG-WIDE assets only; an asset restricted to
 * particular sites has to be asked for through `org:{orgId}:{hostId}`,
 * because the CDN is unauthenticated and the URL is the only thing it can
 * decide from. The qualified form is a superset — it also serves org-wide
 * assets, since `visibleToHost` is true for `['org']` — so qualifying
 * whenever a host is known is always safe and never needs `visibleTo`.
 *
 * It REPLACES an existing qualification rather than refusing to touch one.
 * A baked-in host is the picker's best guess made where no site context
 * existed; the site actually rendering the node is the better answer, and
 * this is what lets one reference work in a reusable component or layout
 * shared across several sites — the case a single stored URL can never
 * cover.
 */
export function hostQualifiedScope(
  scope: string,
  hostId: string | undefined | null,
): string {
  if (!hostId || !SEGMENT.test(hostId)) return scope
  if (!scope.startsWith(ORG_SCOPE_PREFIX)) return scope
  const orgId = scope.slice(ORG_SCOPE_PREFIX.length).split(':')[0]
  if (!orgId || !SEGMENT.test(orgId)) return scope
  return `${ORG_SCOPE_PREFIX}${orgId}:${hostId}`
}

export interface ResolveMediaSrcOptions {
  /**
   * Host doc id of the site being rendered. The tenant page has it on
   * `SiteContext`; the besigner canvas and Preview do not, and pass nothing
   * — which is exactly why the picker bakes its best guess into the stored
   * scope (see {@link mediaNodeSrc}).
   */
  hostId?: string | null
}

/**
 * The render-time resolver every surface shares. Precedence, in order:
 *
 * 1. a **media reference** → the CDN URL for it, host-qualified if we know
 *    which site is asking;
 * 2. any other non-empty string → **itself, untouched**. That is the whole
 *    back-compat story and it needs no migration to be correct: nodes
 *    holding a raw `https://firebasestorage.googleapis.com/…` URL, nodes
 *    holding an `/api/media/cdn/…` path written by the first pass,
 *    and an author-typed external URL for a hotlinked image are all just
 *    passed through;
 * 3. empty/absent → undefined, so the caller shows its placeholder.
 *
 * A value that opens with `media:` but does not parse resolves to undefined
 * rather than reaching an `<img src>`. There is no correct URL to emit for
 * it, and a placeholder in the editor is a report; `src="media:junk"` is a
 * console error nobody reads.
 */
export function resolveMediaSrc(
  value: string | undefined | null,
  options?: ResolveMediaSrcOptions,
): string | undefined {
  if (!value) return undefined
  if (!isMediaRef(value)) return value
  const ref = parseMediaRef(value)
  if (!ref) return undefined
  const scope = hostQualifiedScope(ref.scope, options?.hostId)
  // The stable URL, pinned or not (AGL-2798). The content-hashed form is held
  // for a year by the edge and by every browser that fetched it, where no
  // replace can reach — see the module note.
  return `${MEDIA_CDN_ROUTE}/${scope}/${ref.mediaId}`
}

/**
 * The site-relative path of an ABSOLUTE first-party CDN URL, or undefined
 * when the value is not one. Internal to {@link siteRelativeMediaSrc}.
 *
 * Gated on {@link isFirstPartyHost} rather than on the path alone, and that
 * gate is the whole safety argument: an author-typed hotlink whose path
 * happens to look like ours must keep its origin, or we would silently
 * re-point someone else's image at our own CDN.
 *
 * `search` and `hash` are carried through. A private asset is served behind
 * `exp` + `sig`, and `signMediaAccess` signs (scope, mediaId, exp) — never
 * the host — so a signature survives the origin being dropped.
 */
function firstPartyCdnPathname(value: string): string | undefined {
  // Cheap reject before constructing a URL: only an absolute http(s) URL
  // carries an origin to drop, and this runs on every rendered image.
  if (!/^https?:\/\//i.test(value)) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (!isFirstPartyHost(url.hostname)) return undefined
  if (!url.pathname.startsWith(`${MEDIA_CDN_ROUTE}/`)) return undefined
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * {@link resolveMediaSrc}, with an absolute FIRST-PARTY CDN URL folded back
 * to the site-relative path that names the same bytes (AGL-1726).
 *
 * The resolver's pass-through branch is right for what it was written for —
 * a raw storage URL and an author's hotlink are values we must not touch.
 * But a stored `https://{subdomain}.aglyn.app/api/media/cdn/…` is neither.
 * It is OUR route, addressed the long way round, and on a white-label
 * storefront served from the customer's own domain it is:
 *
 * 1. a **brand leak** — the platform subdomain appears in page source and in
 *    every visitor's request, on a site whose owner pays not to see it;
 * 2. **cross-origin**, so `img-src 'self'` would blank it (this is the
 *    AGL-1726 measurement, and fixing it unblocks that flip);
 * 3. a dependency on `aglyn.app` resolving, on a page that otherwise has no
 *    reason to need it.
 *
 * Dropping the origin is safe because `serveMediaCdn` decides from the URL
 * and the document, never from the `Host` header — "the cache key IS the
 * URL, one host's answer can never reach another" — and BOTH apps mount the
 * route, so the console canvas and the tenant page each serve their own.
 *
 * ## Why this is a separate function and not a change to `resolveMediaSrc`
 *
 * Two consumers need the absolute form and would be harmed by folding this
 * into the shared resolver:
 *
 * - {@link absoluteMediaSrc}'s out-of-band readers (`og:image`, the PWA
 *   manifest, JSON-LD, an inbox). They re-absolutize against a stated
 *   origin, so a value that no longer carries one returns undefined
 *   wherever that origin is unknown.
 * - `resolveEmailMediaSrc` in `shared-util-email`, a deliberate COPY of
 *   `resolveMediaSrc` pinned by `apps/console/specs/email-media-src-drift.spec.ts`.
 *   It cannot import this module (`scope:shared` is a leaf), so any change
 *   to the authority has to be mirrored by hand — and a mirror of
 *   {@link isFirstPartyHost}, which reads two environment variables, is the
 *   AGL-2195 trap re-armed.
 *
 * So: the render-time resolver keeps its contract, and a surface that puts
 * the result straight into an `<img src>` on a page asks for this instead.
 */
export function siteRelativeMediaSrc(
  value: string | undefined | null,
  options?: ResolveMediaSrcOptions,
): string | undefined {
  const resolved = resolveMediaSrc(value, options)
  // Absent, empty, and an unparseable reference all arrive here as
  // undefined and must LEAVE as undefined — the caller's placeholder is the
  // correct render, and `strictNullChecks` being off repo-wide means a
  // missing field folds to falsy rather than announcing itself.
  if (!resolved) return undefined
  return firstPartyCdnPathname(resolved) ?? resolved
}

/**
 * {@link resolveMediaSrc}, then made ABSOLUTE against a stated origin.
 *
 * Two of the three stored generations — a `media:` reference and the AGL-175
 * relative CDN path — resolve site-RELATIVE, which is right for an `<img>` on
 * a page and wrong for every consumer that reads the URL out of band: a
 * crawler fetching `og:image` (AGL-1337), an inbox rendering a campaign
 * (AGL-1224), an installer fetching a PWA manifest icon (AGL-1407). None of
 * them has a page to resolve against, and the tenant app declares no
 * `metadataBase`, so Next resolves nothing for us either.
 *
 * With no origin a relative value returns **undefined** rather than a
 * relative URL — the rule the canonical and the RSS feed already follow
 * (AGL-1160/AGL-1272): never interpolate an unknown origin, and never emit a
 * URL that is well-formed but wrong. An absolute value is unaffected, so the
 * author-typed external URL and the raw storage URL never depend on knowing
 * the origin at all.
 *
 * A protocol-relative `//host/x.png` only lacks a scheme; it is given `https:`
 * rather than an origin, which would corrupt it.
 */
export function absoluteMediaSrc(
  value: string | undefined | null,
  options?: ResolveMediaSrcOptions & { origin?: string | null },
): string | undefined {
  const resolved = resolveMediaSrc(value, options)
  if (!resolved) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(resolved)) return resolved
  if (resolved.startsWith('//')) return `https:${resolved}`
  const origin = options?.origin
  if (!origin) return undefined
  return resolved.startsWith('/')
    ? `${origin}${resolved}`
    : `${origin}/${resolved}`
}

/**
 * Whether a resolved URL is served by our CDN, and therefore carries the
 * generated WebP variants selected by `?w=`. Widths without a variant fall
 * back to the original server-side, so a static srcSet is safe for any
 * CDN-form URL — including the legacy stored paths, which is why this asks
 * about the RESOLVED url rather than about the stored value.
 */
export function isMediaCdnUrl(url: string | undefined | null): boolean {
  return Boolean(url && url.includes(`${MEDIA_CDN_ROUTE}/`))
}

/**
 * One resolved URL at a chosen variant width (AGL-2741).
 *
 * `image.tsx` hands the browser the whole candidate list and lets it choose,
 * which is right for an `<img>` and impossible everywhere else: a
 * `<video poster>` attribute takes ONE url and no `srcset`, and so does a
 * `thumbnailUrl` in structured data. Those callers still want the WebP variant
 * rather than the 335 KB PNG original, and they have to name the width
 * themselves.
 *
 * The width is only appended when the resolved url is a CDN one. A hotlinked
 * image has no variants and no handler behind it, so a `?w=` there would be a
 * query string on somebody else's server; a width the asset has no variant for
 * falls back to the original server-side, so this is safe on any CDN-form url
 * and on an asset whose variants were never generated.
 *
 * Shared rather than restated at each call site because a poster attribute and
 * the `thumbnailUrl` describing it must name the SAME bytes — two spellings of
 * "resolve the poster" is how those drift apart.
 */
export function mediaVariantSrc(
  value: unknown,
  options: ResolveMediaSrcOptions & { width: number },
): string | undefined {
  const resolved = resolveMediaSrc(
    typeof value === 'string' ? value : undefined,
    options,
  )
  if (!resolved) return undefined
  return isMediaCdnUrl(resolved) ? `${resolved}?w=${options.width}` : resolved
}

/**
 * Hosts that serve OUR OWN media, for {@link isFirstPartyMediaSrc}.
 *
 * `firebasestorage.googleapis.com` is here because it is where the DAM
 * actually stores bytes: `mediaSrc` falls back to the raw download URL for a
 * free-tier org, which has no `mediaCdn` entitlement and therefore no
 * `cdnPath`. Excluding it would mean "upload it to the library" was advice a
 * free-tier publisher could not follow.
 *
 * `storage.googleapis.com` is deliberately NOT here — see AGL-1702 #3. Its
 * only producer in source is a signed WRITE url, and allowlisting it
 * pre-emptively is how a host nobody has proved we need becomes permanent.
 */
const FIRST_PARTY_MEDIA_HOSTS = ['firebasestorage.googleapis.com']

/**
 * Apexes whose subdomains are ours. `localhost` covers dev and e2e.
 *
 * `aglyn.com` and `aglyn.io` are both in `security-origins.js`'s
 * `PRODUCTION_DOMAINS`; `aglyn.app` is `TENANT_APEX`; `aglyn.dev` is carried
 * because `tools/lint-rules/no-remote-image-service.mjs` already treats it as
 * first-party and a disagreement between the two lists is the kind of thing
 * that gets discovered as a broken image.
 */
const FIRST_PARTY_APEXES = [
  'aglyn.com',
  'aglyn.app',
  'aglyn.io',
  'aglyn.dev',
  'localhost',
  // The operator's own names on a self-host install (AGL-2172). Pinned to our
  // five, this said a self-hoster's OWN media and CDN hostnames were
  // third-party — so their authors got off-site warnings about their own
  // assets, and the Styles panel's url() hint fired on every image they
  // uploaded. Derived from the same variables the rest of the runtime reads,
  // never a sixth list: `TENANT_APEX` is imported rather than restated, and a
  // console URL arrives as an origin so it is reduced to a hostname here.
  ...operatorFirstPartyApexes(),
]

/**
 * The apexes this DEPLOYMENT serves, beyond Aglyn's own.
 *
 * Empty on Aglyn's cloud, where the five above are the whole answer. A
 * function rather than a spread of constants so an unset or malformed value
 * contributes nothing instead of an empty string — `''` in this list would
 * make `endsWith('.')` true for every hostname on earth.
 */
function operatorFirstPartyApexes(): string[] {
  const consoleHost = (() => {
    const raw = process.env.NEXT_PUBLIC_CONSOLE_URL?.trim()
    if (!raw) return undefined
    try {
      return new URL(raw).hostname.toLowerCase()
    } catch {
      return undefined
    }
  })()
  return [
    TENANT_APEX,
    consoleHost,
    process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN?.trim().toLowerCase(),
  ].filter((name): name is string => Boolean(name && name.includes('.')))
}

// The parameter is `hostname`, not `host`, on purpose (AGL-1718/AGL-1719). In
// this repo `host` names the `hosts/{hostId}` SITE DOCUMENT, and the AGL-1361
// write-deny guard scans this whole directory textually for `host.<field>` to
// build that document's field universe. A string local called `host` therefore
// reads as a site field: `host.toLowerCase()` was collected as a host field
// named `toLowerCase` and turned the guard red. `url.hostname` is what the one
// caller passes, so this is also the more accurate name.
//
// Exported for `author-css.ts` (AGL-1737): the Styles panel's passive
// off-site-url() hint needs the SAME first-party set this file already keeps
// in sync with `security-origins.js`, rather than a third copy of the list.
export function isFirstPartyHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (FIRST_PARTY_MEDIA_HOSTS.includes(lower)) return true
  return FIRST_PARTY_APEXES.some(
    (apex) => lower === apex || lower.endsWith(`.${apex}`),
  )
}

/**
 * Whether a stored image `src` names media WE serve (AGL-1701).
 *
 * The predicate an authoring surface validates against when the person
 * supplying the value is not the person who will render it. A marketplace
 * publisher types a listing logo; every OTHER org's users load it. An `<img>`
 * on a host the publisher controls is a beacon — it discloses each viewer's
 * IP, user-agent and a `Referer` naming the console and the org, on every
 * render, to a recipient who appears on no subprocessor register. That is a
 * disclosure question, and the answer is not to name the host in a policy;
 * it is to stop accepting the host.
 *
 * Three accepted forms, in descending order of how much we like them:
 *
 * 1. a `media:` reference — names the asset, survives a move or a replace;
 * 2. a root-relative path under {@link MEDIA_CDN_ROUTE} — same-origin, so
 *    `img-src 'self'` covers it with no allowlist entry at all;
 * 3. an absolute `https:` URL on a first-party host. Two sub-cases, and both
 *    are what the DAM picker actually emits today: `mediaSrc` prefixes
 *    `window.location.origin` onto `cdnPath` because a listing renders
 *    somewhere other than the console, and it falls back to the raw storage
 *    download URL when the org has no CDN entitlement.
 *
 * `http:` is refused in every form, and so is protocol-relative `//host` —
 * which `new URL` would resolve against a base we do not have here, and which
 * on a page is simply the same egress with the scheme borrowed.
 *
 * KNOWN GAP, stated rather than papered over: an org with a white-label
 * `customConsoleDomain` would have `mediaSrc` emit that domain, which this
 * refuses. Inert today — AGL-743 leaves the claim `pending` and nothing
 * routes on it — and the fix when it does route is to resolve the claim here,
 * not to widen the apex list.
 */
export function isFirstPartyMediaSrc(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  // `startsWith` rather than `isMediaRef`: that one is a `value is string`
  // predicate, so narrowing a value ALREADY known to be a string leaves the
  // else branch as `never` and every later `.startsWith` fails to compile
  // under the console's stricter config (and, silently, not under this
  // library's — which is how it would have shipped).
  if (trimmed.startsWith(MEDIA_REF_PREFIX)) {
    return parseMediaRef(trimmed) !== null
  }
  // Root-relative only. `//host/…` is protocol-relative, not a path.
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) return false
    return trimmed.startsWith(`${MEDIA_CDN_ROUTE}/`)
  }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return false
    return isFirstPartyHost(url.hostname)
  } catch {
    return false
  }
}

/**
 * Reads a reference back out of a CDN path — how the picker mints one from
 * the `cdnPath` the server already wrote on the media doc, so nothing new
 * has to be plumbed through the media APIs.
 *
 * A content-hashed path (`…/{mediaId}/{hash}`) yields the reference for the
 * asset it names, and the hash is discarded: a reference names the ASSET, so
 * that a replace reaches it (AGL-2798).
 */
export function mediaRefFromCdnPath(
  cdnPath: string | undefined | null,
): string | undefined {
  if (!cdnPath) return undefined
  const marker = `${MEDIA_CDN_ROUTE}/`
  const at = cdnPath.indexOf(marker)
  if (at === -1) return undefined
  const [scope, mediaId] = cdnPath.slice(at + marker.length).split('/')
  return formatMediaRef(scope, mediaId)
}

/**
 * Matches every stored reference to ONE asset, whatever scope form it
 * carries — host library, bare org, or host-qualified org.
 *
 * The where-used scan (AGL-833/AGL-1045) answers "what breaks if I move,
 * restrict or delete this?" by looking for the asset's URL inside serialized
 * documents. A reference contains neither the storage URL nor the CDN path,
 * so without this it would report an asset as used nowhere — and the scope
 * confirmation that quotes those results would tell an author it is safe to
 * restrict an asset that is on a live page. Enumerating the org's hosts to
 * build one needle per site would work and would silently under-report the
 * moment a scan skipped a host; one pattern cannot.
 *
 * Deliberately not anchored to a quote: it must find a reference wherever it
 * was serialized. The trailing guard stops `med1` matching `med12`.
 *
 * It matches a PINNED reference too (AGL-2685) and must keep doing so: `@` is
 * outside `[A-Za-z0-9_-]`, so `media:h/med1@abc` satisfies the trailing guard
 * on its own. Had it not, the where-used scan would have started reporting
 * live assets as used nowhere the day pins shipped — a scan whose every error
 * already points at "safe to delete".
 */
export function mediaRefPattern(mediaId: string): RegExp {
  const id = mediaId.replace(/[^A-Za-z0-9_-]/g, '')
  // An id that sanitizes to nothing must match NOTHING — never everything.
  if (!id) return /(?!)/
  return new RegExp(
    `${MEDIA_REF_PREFIX}(?:org:${SEGMENT_SOURCE}(?::${SEGMENT_SOURCE})?` +
      `|${SEGMENT_SOURCE})/${id}(?![A-Za-z0-9_-])`,
  )
}

/**
 * What the media picker writes into a node prop.
 *
 * The reference is derived from `cdnPath`, and that is load-bearing rather
 * than convenient: `cdnPath` is only minted for orgs entitled to `mediaCdn`
 * and is deleted for private assets (`mediaCdnPathUpdate`). Since the CDN
 * handler itself checks neither, minting a reference from an id we happen to
 * know would hand every free-tier org paid delivery. Deriving it means the
 * entitlement gate keeps working with no second copy of the rule — and a
 * free-tier org degrades to the raw storage URL, which is exactly what it
 * got before the CDN-path pass.
 *
 * `media.cdnPath` is expected to be already host-qualified by the picker
 * dialog (AGL-1043). That qualification is preserved in the stored scope so
 * the besigner canvas, which has no site context, can still fetch a
 * restricted asset; {@link resolveMediaSrc} overrides it wherever the real
 * rendering host IS known.
 *
 * No content pin is written, even when `media.contentHash` is present
 * (AGL-2798). A pin changes no URL a reference renders, so writing one would
 * put a value into the document that nothing reads, and hand the next reader
 * a reason to turn it back into the year-long URL no replace can reach. The
 * field stays in the accepted shape because callers hand over the whole media
 * document.
 */
export function mediaNodeSrc(media: {
  url?: string | null
  cdnPath?: string | null
  contentHash?: string | null
}): string | undefined {
  return mediaRefFromCdnPath(media.cdnPath) ?? media.url ?? undefined
}

/**
 * The derived objects a VIDEO asset carries, and how a caller asks for one
 * (AGL-2742 / AGL-2743).
 *
 * ## Why these are query parameters on the asset's own URL
 *
 * The alternative was a second media document — a poster with its own id,
 * pointed at from the video's. It was refused for the reason the whole
 * `media:` scheme exists: a reference names an ASSET so that replacing its
 * bytes propagates everywhere without re-linking. Two documents are two
 * lifecycles that can diverge, and the first replace of a video would leave
 * the old poster live under an id no reader knows is stale. One id, one
 * delete, one replace — and a DAM grid that shows the film rather than the
 * film plus a mystery still.
 *
 * The parameters mirror `?w=`, which has selected a derived object since
 * AGL-175. Nothing about the reference itself changes: the same stored
 * `media:{scope}/{id}` yields the master, the poster and every rendition,
 * because which representation you want is a rendering decision and the
 * document records only which asset.
 */
export const MEDIA_CDN_POSTER_PARAM = 'poster'

/** Selects a video rendition by key. See {@link isMediaRenditionKey}. */
export const MEDIA_CDN_RENDITION_PARAM = 'r'

/**
 * The `?r=` value meaning "the best delivery copy you have" (AGL-2753).
 *
 * A key names ONE encoding, which a caller can only ask for if it knows the
 * asset has it. Nothing that renders a page knows that: renditions are
 * produced out of band by `tools/scripts/generate-video-renditions.mjs`,
 * minutes or days after the upload, and a published page is cached HTML that
 * neither regenerates when an encoding lands nor varies on a visitor's
 * `Accept`. So a placement made today can never name a rendition made
 * tomorrow, and the encodings would be produced and never served.
 *
 * This sentinel moves the choice to the one place that already holds the
 * document: `serveMediaCdn` reads it on every asset request anyway. The page
 * emits one URL that says what it WANTS rather than what exists, and an asset
 * with no renditions answers it with the master — the same degradation an
 * unknown `?r=` has always had, reached deliberately instead of by accident.
 *
 * ⚠️ Sentinel and key share a namespace, so {@link parseMediaRendition}
 * refuses a stored entry keyed `auto`. Without that refusal a producer could
 * mint one and make the sentinel unreachable — the negotiated form silently
 * pinned to whichever encoding happened to claim the name.
 */
export const MEDIA_CDN_RENDITION_AUTO = 'auto'

/**
 * Object-path suffix for a video's poster still. The width variants sit
 * under it as `{objectPath}__poster__w{n}.webp`, which is exactly what
 * `generateMediaVariants` produces when handed `{objectPath}__poster` — the
 * poster reuses the image variant generator whole rather than teaching it
 * about video.
 */
export const MEDIA_POSTER_OBJECT_SUFFIX = '__poster'

/** Object-path prefix for a rendition: `{objectPath}__r{key}.{ext}`. */
export const MEDIA_RENDITION_OBJECT_PREFIX = '__r'

/**
 * The grammar a rendition key must fit.
 *
 * Deliberately narrower than the segment grammar above: a key becomes part
 * of a Storage object path, and the two characters `SEGMENT` allows that
 * this does not — `_` and a leading `-` — are the two that would let a
 * crafted key collide with the `__w{n}` and `__poster` suffixes. `720p` and
 * `720p-av1` fit; `_poster` and `_w320` cannot.
 */
const RENDITION_KEY = /^[a-z0-9][a-z0-9-]{0,23}$/

/** Whether a value may be used as a rendition key, minted or received. */
export function isMediaRenditionKey(value: unknown): value is string {
  return typeof value === 'string' && RENDITION_KEY.test(value)
}

/**
 * One encoded delivery copy of a video, as recorded on the media document.
 *
 * Richer than the image variants' bare `number[]`, and the difference is not
 * incidental. An image variant is fully described by its width because every
 * one of them is WebP at quality 80 — the width IS the identity. A rendition
 * is a (resolution, container, codec) triple, and the whole point of having
 * more than one is to offer a browser a choice between codecs at the SAME
 * resolution. A `number[]` cannot express that, so the array carries the
 * facts a `<source>` element needs instead of forcing the renderer to
 * reconstruct them from a naming convention.
 */
export interface MediaVideoRendition {
  /** Selector, unique per asset. Fits {@link isMediaRenditionKey}. */
  key: string
  /** What the CDN serves it as, and what a `<source type>` should say. */
  contentType: string
  /** Object-path extension, so the path is derivable from the doc alone. */
  ext: string
  width: number
  height: number
  sizeBytes: number
}

/** Container extension grammar. Same argument as {@link RENDITION_KEY}. */
const RENDITION_EXT = /^[a-z0-9]{1,8}$/

/**
 * Read one stored rendition entry, or null.
 *
 * ⚠️ This is a SECURITY gate, not a convenience. `key` and `ext` are
 * interpolated into a Cloud Storage object path by
 * {@link mediaRenditionObjectPath}, and the media document they come from is
 * writable by anyone with editor rights on the scope. An entry carrying
 * `key: '../../../adminAudit-archive/x'` would otherwise walk straight out of
 * the asset's prefix on an admin-SDK bucket read — the same class of hole
 * `mediaStoragePathInScope` closes for `storagePath` (AGL-1881), reached by a
 * different field.
 *
 * The two grammars admit no `/`, no `.` and no `..`, so a validated entry
 * cannot leave the object it belongs to whatever the document says.
 */
export function parseMediaRendition(value: unknown): MediaVideoRendition | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const key = entry['key']
  const ext = entry['ext']
  const contentType = entry['contentType']
  if (!isMediaRenditionKey(key)) return null
  // The negotiation sentinel is not a name an encoding may take: it is
  // resolved before the by-key lookup, so an entry claiming it would be
  // unreachable AND would shadow the request every page makes (AGL-2753).
  if (key === MEDIA_CDN_RENDITION_AUTO) return null
  if (typeof ext !== 'string' || !RENDITION_EXT.test(ext)) return null
  if (typeof contentType !== 'string' || !/^video\/[\w.+-]{1,64}$/.test(contentType)) {
    return null
  }
  const width = Math.round(Number(entry['width']))
  const height = Math.round(Number(entry['height']))
  const sizeBytes = Math.round(Number(entry['sizeBytes']))
  if (!Number.isFinite(width) || width <= 0) return null
  if (!Number.isFinite(height) || height <= 0) return null
  return {
    key,
    ext,
    contentType,
    width,
    height,
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
  }
}

/**
 * Every VALID rendition on a document, in stored order.
 *
 * Order is the document's, and it is meaningful: a renderer emits one
 * `<source>` per entry and a browser takes the FIRST it can decode, so the
 * producer writes the most efficient codec first. Dropping an invalid entry
 * rather than refusing the list keeps one malformed row from costing an asset
 * every rendition it has.
 */
export function parseMediaRenditions(value: unknown): MediaVideoRendition[] {
  if (!Array.isArray(value)) return []
  const parsed: MediaVideoRendition[] = []
  for (const entry of value) {
    const rendition = parseMediaRendition(entry)
    if (rendition) parsed.push(rendition)
  }
  return parsed
}

/** Storage object path of an asset's poster still. */
export function mediaPosterObjectPath(objectPath: string): string {
  return `${objectPath}${MEDIA_POSTER_OBJECT_SUFFIX}.webp`
}

/**
 * Storage object path of one rendition. The `.` before the extension is the
 * only one in the suffix, so a path is unambiguous even when a key contains
 * digits that look like a width.
 */
export function mediaRenditionObjectPath(
  objectPath: string,
  rendition: { key: string; ext: string },
): string {
  return `${objectPath}${MEDIA_RENDITION_OBJECT_PREFIX}${rendition.key}.${rendition.ext}`
}

/**
 * Append CDN query parameters to a resolved media URL.
 *
 * Private assets already carry `exp`/`sig`, and the pinned form already
 * carries a hash segment, so this has to merge rather than assign — hence
 * the `?`/`&` test instead of a template literal. Kept private: every public
 * entry point below decides for itself whether a value is even eligible.
 */
function withMediaCdnQuery(
  src: string,
  params: readonly (readonly [string, string])[],
): string {
  const query = params.map(([key, value]) => `${key}=${value}`).join('&')
  return `${src}${src.includes('?') ? '&' : '?'}${query}`
}

/**
 * Whether a resolved value is one THIS platform serves, and so one that can
 * be asked for a poster or a rendition.
 *
 * An author-typed hotlink and a raw `firebasestorage.googleapis.com` URL both
 * pass through {@link resolveMediaSrc} untouched, and neither has a poster.
 * Appending `?poster=1` to them would produce a URL that either 404s or —
 * worse, on a permissive third-party host — serves the whole video under a
 * name that promises 40 KB.
 *
 * ⚠️ Deliberately the PREFIX test and not {@link isMediaCdnPath}, which is
 * the strict validator two functions above. The strict form refuses the
 * content-hashed shape — `/api/media/cdn/{scope}/{id}/{hash}` — because its
 * media-id segment then contains a `/`. No reference resolves to that shape
 * (AGL-2798), but a stored PATH can still hold one: it passes through
 * {@link resolveMediaSrc} untouched and the CDN still answers it, so refusing
 * it here would drop the poster and renditions of an asset that serves.
 *
 * Nothing is lost by being looser: the strict grammar is a SUBSET of this
 * prefix, and everything the prefix additionally admits is a same-origin
 * path into this platform's own route — which is the only question this
 * predicate asks.
 */
function derivedObjectEligible(src: string | undefined): src is string {
  if (!src) return false
  return src.startsWith(`${MEDIA_CDN_ROUTE}/`)
}

/**
 * The poster URL for a stored media reference, or undefined when the value
 * cannot have one.
 *
 * `width` narrows to a generated poster variant. An asset with no variant at
 * that width still answers — `serveMediaCdn` falls back to the full poster,
 * the same degradation `?w=` has always had — so a renderer may advertise
 * the standard {@link MEDIA_CDN_VARIANT_WIDTHS} in a `srcSet` without
 * consulting the document.
 *
 * ⚠️ Returning a URL is NOT a promise that a poster exists. Nothing here can
 * read a media document, and a video uploaded before AGL-2742 — or by a
 * browser that could not decode it — has none.
 *
 * That case answers **404**, deliberately and not as a gap: `serveMediaCdn`
 * refuses a poster it does not have rather than falling back to the master,
 * because answering a request for a 40 KB still with 60 MB of `video/mp4` is
 * the exact cost this exists to remove. So a `<video poster>` built from this
 * degrades to a `<video>` with no poster, which is what every video on the
 * platform did before AGL-2742 — which is why this is allowed to answer
 * without knowing. A caller putting the URL somewhere a 404 is NOT free (an
 * `<img>`, an `og:image`) must read `poster` off the document first.
 */
export function mediaPosterSrc(
  value: string | undefined | null,
  options?: ResolveMediaSrcOptions & { width?: number },
): string | undefined {
  const src = resolveMediaSrc(value, options)
  if (!derivedObjectEligible(src)) return undefined
  const width = Number(options?.width)
  const params: (readonly [string, string])[] = [[MEDIA_CDN_POSTER_PARAM, '1']]
  if (Number.isFinite(width) && width > 0) {
    params.push(['w', String(Math.round(width))])
  }
  return withMediaCdnQuery(src, params)
}

/**
 * The URL of one rendition. Undefined for a key that does not fit the
 * grammar, so a malformed key never reaches a `<source src>` — an empty
 * `src` makes a browser re-request the PAGE, which is a far more expensive
 * mistake than a missing source element.
 */
export function mediaRenditionSrc(
  value: string | undefined | null,
  key: string,
  options?: ResolveMediaSrcOptions,
): string | undefined {
  if (!isMediaRenditionKey(key)) return undefined
  const src = resolveMediaSrc(value, options)
  if (!derivedObjectEligible(src)) return undefined
  return withMediaCdnQuery(src, [[MEDIA_CDN_RENDITION_PARAM, key]])
}

/**
 * The URL a player should actually load for a video (AGL-2753).
 *
 * This is {@link resolveMediaSrc} plus one query parameter, and the parameter
 * is the entire feature: it asks the CDN for the best delivery copy it has
 * rather than naming one, so a rendition encoded LONG after the video was
 * placed on a page reaches that page with no re-pick, no node backfill and no
 * document read on the render path. See {@link MEDIA_CDN_RENDITION_AUTO} for
 * why the choice has to live at the CDN.
 *
 * ⚠️ Unlike {@link mediaPosterSrc} this NEVER returns undefined for a value
 * that resolved. A poster may legitimately have no URL — the element simply
 * renders without one — but a video with no URL is a dead player, so anything
 * this cannot improve is passed through exactly as `resolveMediaSrc` left it.
 * An author-typed hotlink and a raw Storage URL therefore come back untouched:
 * they are not this platform's objects and have no renditions to ask for.
 *
 * Safe on an asset that has none. `?r=` degrades to the master by design —
 * "the same video in more bytes" — which is precisely what every video served
 * before this existed, so a page that adopts this URL cannot regress.
 */
export function videoDeliverySrc(
  value: string | undefined | null,
  options?: ResolveMediaSrcOptions,
): string | undefined {
  const src = resolveMediaSrc(value, options)
  if (!derivedObjectEligible(src)) return src
  return withMediaCdnQuery(src, [
    [MEDIA_CDN_RENDITION_PARAM, MEDIA_CDN_RENDITION_AUTO],
  ])
}

/**
 * The still a Video element should show, from the two places one can come
 * from (AGL-2749).
 *
 * A video placement has two candidate posters and they are not equal:
 *
 * 1. **The author's own**, a media reference or a URL in the element's
 *    `poster` field. It wins outright wherever it is set — an author who went
 *    and chose a frame meant that frame, and a generated one silently
 *    replacing it would make re-picking the SOURCE a destructive edit.
 * 2. **The one the DAM generated at upload** ({@link mediaPosterSrc}), which
 *    is not a separate asset at all: it is `?poster=1` on the video's own
 *    reference.
 *
 * ⚠️ `generated` is REQUIRED for the second, and it is the whole reason this
 * function exists rather than a `??` at each call site. `mediaPosterSrc`
 * answers for any CDN-form reference and its own documentation says plainly
 * that a URL is **not a promise a poster exists** — a video uploaded before
 * AGL-2742, or one the uploader's browser could not decode, answers 404. That
 * degrades harmlessly behind `<video poster>` and NOT harmlessly in an
 * `<img>` (a broken image) or in a `thumbnailUrl` (a rich result pointing at
 * nothing). So the caller has to have read `poster` off the media document —
 * which the pick does, once, and carries on the node.
 *
 * `width` narrows both candidates to a variant, for the surfaces that take one
 * url and no `srcset`. Omit it to get the full-size still, which is what an
 * `<img>` wants as its `src` beside a `srcSet` of widths.
 */
export function videoPosterSrc(
  options: ResolveMediaSrcOptions & {
    /** The element's own `poster` field — a reference, a URL, or nothing. */
    poster?: unknown
    /** The element's `src`, which the generated poster derives from. */
    src?: unknown
    /** Whether the media document records a generated poster. */
    generated?: unknown
    /** Narrow to a variant width; omit for the full-size still. */
    width?: number
  },
): string | undefined {
  const { poster, src, generated, width, ...resolve } = options ?? {}
  const authored = typeof poster === 'string' ? poster.trim() : ''
  if (authored) {
    return width
      ? mediaVariantSrc(authored, { ...resolve, width })
      : resolveMediaSrc(authored, resolve)
  }
  if (!generated) return undefined
  return mediaPosterSrc(typeof src === 'string' ? src : undefined, {
    ...resolve,
    width,
  })
}
