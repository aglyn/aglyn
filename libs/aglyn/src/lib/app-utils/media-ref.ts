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
 * ## What is NOT stored
 *
 * The reference deliberately omits the content hash: it names the asset, so
 * it always resolves to the asset's current bytes, which is what makes a
 * **replace** propagate instead of breaking. It also omits the entitlement
 * decision — see {@link mediaNodeSrc}, which is why a free-tier org keeps
 * getting a raw storage URL rather than a reference.
 */

/**
 * The media delivery route. The ONE literal a route change has to touch —
 * everything else derives from it. Kept in the framework package rather than
 * next to the handler because the handler lives in a server-only lib that a
 * plugin component cannot import.
 */
export const MEDIA_CDN_ROUTE = '/api/media/cdn'

/**
 * Scheme of a stored media reference. Chosen so `startsWith` is a decision:
 * no URL, path, or `{{binding}}` an author can type begins with it, and it
 * is not a registered URL scheme, so a browser handed one by mistake fails
 * loudly rather than fetching something.
 */
export const MEDIA_REF_PREFIX = 'media:'

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
}

/** Whether a scope segment is one the CDN would accept. */
export function isMediaCdnScope(scope: string): boolean {
  if (!scope.startsWith(ORG_SCOPE_PREFIX)) return SEGMENT.test(scope)
  const parts = scope.slice(ORG_SCOPE_PREFIX.length).split(':')
  if (parts.length < 1 || parts.length > 2) return false
  return parts.every((part) => SEGMENT.test(part))
}

/** Mints the stored form. Returns undefined rather than emitting junk. */
export function formatMediaRef(
  scope: string | undefined | null,
  mediaId: string | undefined | null,
): string | undefined {
  if (!scope || !mediaId) return undefined
  if (!isMediaCdnScope(scope) || !SEGMENT.test(mediaId)) return undefined
  return `${MEDIA_REF_PREFIX}${scope}/${mediaId}`
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
  const mediaId = rest.slice(slash + 1)
  if (!isMediaCdnScope(scope) || !SEGMENT.test(mediaId)) return null
  return { scope, mediaId }
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
  return `${MEDIA_CDN_ROUTE}/${scope}/${ref.mediaId}`
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
]

function isFirstPartyHost(host: string): boolean {
  const lower = host.toLowerCase()
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
 * A content-hashed path (`…/{mediaId}/{hash}`) yields the plain reference:
 * the stored form names the asset, never a snapshot of its bytes, so a
 * replace keeps working instead of 404ing that exact URL by design.
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
 */
export function mediaNodeSrc(media: {
  url?: string | null
  cdnPath?: string | null
}): string | undefined {
  return mediaRefFromCdnPath(media.cdnPath) ?? media.url ?? undefined
}
