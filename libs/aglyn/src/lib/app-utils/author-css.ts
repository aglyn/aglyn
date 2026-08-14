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
 * Scheme rules for `url()` inside AUTHOR-WRITTEN CSS (AGL-1725).
 *
 * Two surfaces on a published tenant site put author CSS into the visitor's
 * document verbatim, and neither is reachable by any control we had:
 *
 * 1. the `css` attribute of the Custom HTML component, emitted as a raw
 *    `<style>` block (`custom-html.tsx`) — DOMPurify there is applied to the
 *    `html` attribute ONLY and never sees this string;
 * 2. `node.sx` from the Styles panel, where `backgroundImage` is a
 *    first-class field and the Custom CSS tab is free-solo, so any property
 *    and any value can be typed.
 *
 * `aglyn/no-remote-image-service` cannot see either — it scans OUR source for
 * host literals, and these arrive at runtime from Firestore. No input
 * validator sees them either: they are free-text CSS, not a URL field.
 *
 * ## What this module does and, deliberately, does not do
 *
 * It does **not** restrict which HOST an author may reach over `https:`.
 * That is the AGL-1701 remedy, and it does not transfer here — see the note
 * on {@link isRefusedAuthorCssUrl}. Hotlinking is an advertised authoring
 * feature (`image.tsx` tells authors to "paste the URL of an image hosted
 * somewhere else"), the author is the site owner, and the report-only
 * `img-src` shipped for AGL-1703 now measures the practice for the first
 * time. Restricting a host list before the first measurement would break
 * live customer sites silently to prevent something nobody has counted.
 *
 * It **does** refuse a scheme that cannot be defended at any volume:
 * anything that is not `https:`, `data:`, `blob:` or same-document.
 * `http:` is the case that matters — mixed passive content on an HTTPS page
 * is already blocked or auto-upgraded by every current browser, so the
 * author gains nothing from it, while the request discloses what the visitor
 * is reading to every observer on the path rather than only to the host the
 * author chose. AGL-1701 found two other paths accepting `http:`
 * (`markdown-lite.ts`, `collection-fallback-nodes.ts`); this is the same
 * rule reaching the two CSS surfaces.
 */

/**
 * The CSS-spec URL guaranteed never to load, used as the replacement.
 *
 * Substituting this rather than deleting the declaration keeps the CSS
 * grammar valid in every position `url()` is valid — `background: url(x)
 * no-repeat` stays a well-formed shorthand — so a refused URL costs the
 * author one image and never corrupts the rest of their stylesheet.
 */
export const INERT_CSS_URL = 'about:invalid'

/**
 * Schemes an author's `url()` may name.
 *
 * `data:` and `blob:` are in because they are inert: the bytes are already
 * in the document and no request leaves the machine. `https:` is in because
 * restricting it is a product decision this module does not take.
 */
const ALLOWED_CSS_URL_SCHEMES = ['https:', 'data:', 'blob:']

/**
 * Matches one `url(...)` token, quoted or bare, capturing the target.
 *
 * Bare targets cannot contain `)` unescaped per the CSS grammar, so the
 * negated class is right for them; quoted targets may, so they are matched
 * to their closing quote. A bare target using a CSS escape (`url(\68 ttps:`)
 * is NOT decoded here and will therefore be refused — fail-closed on an
 * encoding nobody writes by hand, which costs an author who could simply
 * type the URL nothing.
 */
const CSS_URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)/gi

/**
 * Whether a `url()` target must be replaced with {@link INERT_CSS_URL}.
 *
 * The actor analysis behind the narrow rule, because it is the whole reason
 * this is not `isFirstPartyMediaSrc` (AGL-1701):
 *
 * - In AGL-1701 the URL came from a **marketplace publisher** and was
 *   rendered to **other orgs' users**. Aglyn put a stranger's host in front
 *   of people who had no dealing with that publisher, so Aglyn introduced
 *   the recipient and restricting the input was right.
 * - Here the URL comes from the **site owner**, rendered to **the site
 *   owner's own visitors**, on the site owner's own domain. The site owner
 *   is the controller for those visitors and Aglyn is the processor; they
 *   are choosing a recipient for data they already control, which is what a
 *   controller does when they add a font, a pixel or a hotlinked image.
 *   Aglyn did not introduce the recipient and should not silently veto it.
 *
 * Same shape of finding, opposite answer, because the actor and the victim
 * are in a different relationship. What survives is the scheme rule, which
 * protects the visitor without taking the host decision away from the owner.
 */
export function isRefusedAuthorCssUrl(target: string): boolean {
  const trimmed = target.trim()
  // An empty url() names nothing and issues no request.
  if (!trimmed) return false
  // Protocol-relative: resolves against the document, which is https on a
  // published site, so it can never become the mixed-content case.
  if (trimmed.startsWith('//')) return false
  // Same-document / same-origin forms.
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return false
  }
  // A scheme is everything before the first `:`, but only when that `:`
  // precedes any path, query or fragment delimiter — otherwise `a:b` inside
  // a relative path would read as a scheme.
  const colon = trimmed.indexOf(':')
  if (colon <= 0) return false
  const beforeColon = trimmed.slice(0, colon)
  if (/[/?#]/.test(beforeColon)) return false
  return !ALLOWED_CSS_URL_SCHEMES.includes(`${beforeColon.toLowerCase()}:`)
}

/**
 * Rewrites every refused `url()` in an author stylesheet to
 * {@link INERT_CSS_URL}, leaving the rest of the CSS byte-identical.
 *
 * Returns the input BY IDENTITY when nothing is refused, which is the
 * overwhelmingly common case and lets callers on a render path skip work.
 */
export function sanitizeAuthorCss(css: string): string {
  if (!css || !css.includes('url(')) return css
  let changed = false
  const next = css.replace(
    CSS_URL_TOKEN,
    (match, quoted: string, single: string, bare: string) => {
      const target = quoted ?? single ?? bare ?? ''
      if (!isRefusedAuthorCssUrl(target)) return match
      changed = true
      return `url(${INERT_CSS_URL})`
    },
  )
  return changed ? next : css
}

/**
 * {@link sanitizeAuthorCss} over an `sx` object from the Styles panel.
 *
 * Walks arrays (MUI's composition form), nested records (selectors, media
 * queries, breakpoint slices) and scrubs string leaves. Non-string,
 * non-walkable values — numbers, functions, null — pass through untouched.
 *
 * Identity is preserved for any subtree that did not change, so a node whose
 * styles hold no `url()` at all (nearly all of them) gets its own object
 * back and nothing downstream re-renders. That matches the contract
 * `resolvePaletteVarsSx` already states on the same render path.
 */
export function sanitizeAuthorSx<T>(sx: T): T {
  if (typeof sx === 'string') return sanitizeAuthorCss(sx) as unknown as T
  if (!sx || typeof sx !== 'object') return sx
  if (Array.isArray(sx)) {
    let changed = false
    const next = sx.map((entry) => {
      const value = sanitizeAuthorSx(entry)
      if (value !== entry) changed = true
      return value
    })
    return (changed ? next : sx) as unknown as T
  }
  let changed = false
  const next: Record<string, unknown> = {}
  for (const key of Object.keys(sx as Record<string, unknown>)) {
    const entry = (sx as Record<string, unknown>)[key]
    const value = sanitizeAuthorSx(entry)
    if (value !== entry) changed = true
    next[key] = value
  }
  return (changed ? next : sx) as unknown as T
}
