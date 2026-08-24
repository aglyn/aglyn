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
 * The tenant image-sink inventory is DERIVED from the repo, not remembered
 * (AGL-1725).
 *
 * An image sink is any line on the published render path that turns a stored
 * string into a URL a browser — or a crawler, or an inbox, or an OS install
 * prompt — will fetch. Every one of them is a third-party host learning a
 * VISITOR's IP and a `Referer` naming our customer's site, and the visitor is
 * not our user and has no channel to tell us. That is the whole reason this
 * issue outranks its console twin (AGL-1701).
 *
 * ## Why a guard and not a list
 *
 * AGL-1725 has been re-swept by hand three times — 2026-08-14, 08-17 and
 * 08-20 — and every sweep found the previous list wrong. Not wrong at the
 * edges: the 08-20 pass found four sinks recorded as unguarded that had been
 * fixed weeks earlier, a fifth commit against the issue the body never
 * mentioned, and a count of "26 remaining" that was really 11. The prose in
 * `security-origins.js` still says "28 image sinks" and that number has not
 * been true since. A list of sinks maintained by remembering to update it is
 * the thing this codebase demonstrably cannot do.
 *
 * So the population is swept off the source tree on every run and compared,
 * in BOTH directions, against the declarations below. A new sink fails the
 * build. A sink that goes away fails the build. A sink that moves between
 * guard classes fails the build.
 *
 * ## The unknown case FAILS
 *
 * There is no "probably fine" branch. A file that matches a marker and is not
 * declared is a red build with one decision to make, and the decision has to
 * be written down as a reason, not as a classification alone. That is the
 * `host-content-media-coverage.spec.ts` shape (AGL-1867), for the same reason:
 * the dangerous mistake is not a wrong entry, it is a MISSING one, and nothing
 * about the running code can notice a missing one.
 *
 * ## What this guard does NOT claim
 *
 * It does not claim the classifications are correct — a human wrote those. It
 * claims that every sink has one, that no sink is outside the inventory, and
 * that changing a file's sink population forces somebody to look again. It
 * also cannot see a sink whose marker it has no pattern for; the
 * non-emptiness floor in the first case is the only defence against a marker
 * list that has quietly stopped matching, and it is a floor, not a proof.
 *
 * FORCED RED, both directions, before this was committed. See the report on
 * AGL-1725 for the exact runs.
 */

import { readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')

/**
 * Everything that can put an image URL on a published tenant page.
 *
 * `libs/aglyn` and `libs/aglyn-node-renderer` are in scope because the two
 * sinks this issue is named for live there and in `libs/plugins/mui`: the
 * author `<style>` block and the Styles-panel `sx`. `libs/plugins` is swept
 * WHOLE rather than plugin-by-plugin — a new plugin is exactly the event that
 * adds a sink nobody remembers to record, and a scope list of plugin names
 * would have to be maintained by the same memory this guard replaces.
 */
const SOURCE_ROOTS = [
  'apps/tenant/app',
  'apps/tenant/components',
  'libs/plugins',
  'libs/tenant',
  'libs/aglyn-node-renderer/src',
  'libs/aglyn/src',
]

/**
 * Built output and agent worktrees.
 *
 * `.claude` matters here in a way a `.next` bundle does not: a worktree is a
 * full second checkout of this repo, so a sink another agent is mid-way
 * through adding would be swept in as if it were committed, and this guard
 * would demand a classification for a line that does not exist on this branch.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nx',
  'coverage',
  'out',
  '.turbo',
  '.claude',
])

/**
 * The marker patterns, one line at a time.
 *
 * Deliberately syntactic rather than semantic. A precise sink detector would
 * have to resolve `src={someExpression}` back to its origin, which is a type
 * checker's job and would fail open on every indirection; these match the
 * SHAPE that emits an image, and the declaration below carries the judgement
 * about where the value came from.
 *
 * The count they produce is a fingerprint, not a semantic sink count: a
 * `<CardMedia component="img">` contributes one marker, and so does a
 * `<style>` block. What matters is that the number MOVES when the file's
 * image surface changes, which is the event that has to be noticed.
 */
const MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
  // `<Box component="img">` / `<CardMedia component="img">` — MUI's form, and
  // the most common sink in the repo by a wide margin.
  ['element', /component=\s*(?:"img"|'img'|\{\s*['"]img['"]\s*\})/],
  // A bare `<img`, including the line-broken JSX form. `\b` and not `[\s/>]`:
  // the attribute usually starts on the NEXT line, so an end-of-line `<img`
  // is the normal case and matching it was not optional.
  ['element', /<img\b/],
  ['poster', /\bposter\s*=\s*\{/],
  // CSS `url()` reached through a style object — the collection cover's
  // `background-image`, and anything else composed the same way.
  ['css-url', /backgroundImage\s*:/],
  ['css-url', /\bbackground\s*:\s*[`'"][^`'"]*url\(/],
  // A raw `<style>` element is the sink no source-level allowlist can ever
  // see, which is this issue's headline. Matching the ELEMENT rather than the
  // author field means a new one — ours or an author's — has to be declared
  // either way, and "it is only our own constant CSS" becomes a claim written
  // down rather than assumed.
  ['author-css', /<style\b/],
  ['author-css', /sanitizeAuthorSx\s*\(/],
  // Out-of-band consumers: no browser, no CSP, so `img-src` structurally
  // cannot govern any of these however AGL-1726 is decided.
  ['metadata', /\bopenGraph\s*:/],
  ['metadata', /\btwitter\s*:\s*\{/],
  ['metadata', /rel=["']icon["']/],
  ['manifest', /\bicons\b\s*[:=]/],
  ['jsonld', /\bimage\s*:\s*[A-Za-z_$[]/],
  // A template token that renders a product or collection image into a
  // merchant's own page copy.
  ['token', /['"][a-zA-Z]+\.image['"]/],
  // Google Merchant feed.
  ['feed', /image_link/],
]

/**
 * How the value reaching the sink is constrained TODAY. Never a prediction,
 * never an intention — what the code does on this commit.
 */
type SinkGuard =
  /**
   * Routed through `resolveMediaSrc` / `siteRelativeMediaSrc` /
   * `absoluteMediaSrc`. That resolves the three stored generations of a media
   * reference and passes ANY other string through untouched — no scheme
   * check, no host check (`media-ref.ts`, and the docblock says it is
   * deliberate). So: an arbitrary host, including over `http:`.
   */
  | 'media-ref'
  /**
   * Additionally refuses a scheme with no defence — `isRefusedAuthorImageSrc`,
   * `sanitizeAuthorCss`, `sanitizeAuthorSx`, markdown-lite's `safeImageUrl`,
   * or the collection cover's own `https:`-or-relative regex. Host still open,
   * by AGL-1725's decision: the site owner is the controller for their own
   * visitors and hotlinking is an advertised feature.
   */
  | 'scheme-guard'
  /**
   * The stored string reaches the sink with NOTHING applied. This is the open
   * work, and the set of files carrying it is pinned exactly below so it can
   * neither grow nor shrink unnoticed.
   */
  | 'raw'
  /** A platform constant or platform-computed URL; no author string reaches it. */
  | 'platform'
  /**
   * Hands the stored string on to a consumer that resolves it. The resolver is
   * the sink; this line is a projection. Recorded rather than ignored because
   * "somebody downstream handles it" is exactly the assumption that has to be
   * re-checked when the downstream changes.
   */
  | 'projection'
  /**
   * Not a published tenant page — a console surface, the besigner, an email
   * body, a marketplace listing. The actor pair is AGL-1701's (our own user's
   * IP, a host their org chose), not this issue's (a stranger's IP).
   */
  | 'off-tenant'

interface DeclaredSinkFile {
  /** Marker hits this file is expected to produce. */
  readonly markers: number
  /**
   * The WEAKEST guard in the file, not a summary. A file with six resolved
   * sinks and one raw one is `raw` — that is the one that decides the risk,
   * and averaging it away is how a hole hides inside a mostly-fine file.
   */
  readonly guard: SinkGuard
  /** What reaches the sink, and why that is the guard it has. */
  readonly why: string
}

/**
 * Verified against `b432a5ed3` by reading every line, not by trusting the
 * previous sweep. Three corrections to the issue body are recorded in the
 * reasons below: the commerce storefront sinks are no longer raw (`9a517e5ec`
 * gave them `siteRelativeMediaSrc`), plugin stylesheets are a FOURTH raw-CSS
 * surface the inventory never named, and what remains raw is the out-of-band
 * set — JSON-LD, the merchant feed, the page tokens — not the storefront.
 */
const DECLARED: Readonly<Record<string, DeclaredSinkFile>> = {
  'apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx': {
    markers: 4,
    guard: 'media-ref',
    why: 'The fallback renderer: entry cover, markdown body images and the white-label brand logo, each through resolveMediaSrc. Its <style> carries ELEMENT_HIDDEN_STYLE_TEXT, a build-time constant.',
  },
  'apps/tenant/app/[host]/[[...slug]]/page.tsx': {
    markers: 9,
    guard: 'raw',
    why: 'og:image/twitter:image and Article.image go through resolveSocialImage → absoluteMediaSrc. The Product JSON-LD emits seededProduct.mediaUrls with no resolver at all, and a crawler fetches it with no browser and no CSP, so no img-src can ever cover it.',
  },
  'apps/tenant/app/[host]/admin-bar/admin-bar.tsx': {
    markers: 2,
    guard: 'media-ref',
    why: "The bar mounts only for an authenticated editor of this site, and its favicon is resolved by the edit-context route with the same resolver the layout's <link rel=icon> uses. Its <style> is BAR_CSS, ours.",
  },
  'apps/tenant/app/[host]/layout.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: 'The site favicon, the org brand favicon and the navigation loader logo, all three through resolveMediaSrc since AGL-1407. Site-relative is correct here: a page is present to resolve against.',
  },
  'apps/tenant/app/api/_legal-intake/chrome.ts': {
    markers: 1,
    guard: 'platform',
    why: 'The DMCA/counter-notice intake page chrome. PAGE_STYLE is a module constant in this file and no host document is read to build it.',
  },
  'apps/tenant/app/api/host/[hostId]/route.ts': {
    markers: 1,
    guard: 'projection',
    why: 'The host projection API hands seo.image on as stored; resolveSocialImage absolutizes it at the surface that renders it. Nothing is fetched here.',
  },
  'apps/tenant/app/api/locked/route.ts': {
    markers: 1,
    guard: 'platform',
    why: 'The lockdown interstitial, served when a site is suspended. Inline constant CSS, deliberately self-contained so it renders with no host document read at all.',
  },
  'apps/tenant/app/api/manifest/route.ts': {
    markers: 1,
    guard: 'media-ref',
    why: 'The PWA icon through absoluteMediaSrc, which is the correct resolver precisely because the install prompt and the OS icon cache fetch it with no page to resolve a relative URL against.',
  },
  'apps/tenant/components/site-status-screen.component.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: 'The last-resort status screen renders brandLogoUrl out of the host-brand context, which the layout resolved before putting it there.',
  },
  'libs/aglyn-node-renderer/src/lib/components/leaf.tsx': {
    markers: 1,
    guard: 'scheme-guard',
    why: "node.sx is the Styles panel's output and backgroundImage is a first-class field there, so sanitizeAuthorSx scrubs it before the merge — never props.sx, which is our own components' styles.",
  },
  'libs/aglyn/src/lib/app-utils/author-css.ts': {
    markers: 2,
    guard: 'scheme-guard',
    why: 'This file IS the scheme rule: sanitizeAuthorCss, sanitizeAuthorSx and isRefusedAuthorImageSrc. The markers are its own recursion over nested sx slices.',
  },
  'libs/aglyn/src/lib/app-utils/content-authors.ts': {
    markers: 1,
    guard: 'raw',
    why: "An author profile's avatar, read out of the raw document with only a length bound applied, and emitted into Article.author JSON-LD. Out of band, so no browser policy sees it.",
  },
  'libs/aglyn/src/lib/plugin-manager/plugin-styles-ui.tsx': {
    markers: 1,
    guard: 'scheme-guard',
    why: "A FOURTH raw-CSS surface, never in the issue's inventory: a marketplace plugin's own stylesheet, rendered unlayered into the published document. registerPluginStyles and capturePluginStyles both run sanitizeAuthorCss, so it carries the same scheme rule — but the actor pair is AGL-1701 case #4 (a publisher's host in front of another org's visitors), not this issue's.",
  },
  'libs/plugins/commerce/src/lib/components/cart.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: 'The cart line image, given siteRelativeMediaSrc by 9a517e5ec so a white-label storefront stops naming aglyn.app. Resolution only — the scheme is still open here, unlike the events and marketing sinks.',
  },
  'libs/plugins/commerce/src/lib/components/console/product-editor-dialog.component.tsx': {
    markers: 1,
    guard: 'off-tenant',
    why: 'The merchant editing their own catalogue in the console, picker-only. The IP at risk is the merchant\'s own.',
  },
  'libs/plugins/commerce/src/lib/components/product-detail.tsx': {
    markers: 3,
    guard: 'raw',
    why: 'The gallery and its thumbnail strip take siteRelativeMediaSrc, but the Product JSON-LD emits resolved.mediaUrls wholesale with no resolver, deliberately — and that is the copy a crawler fetches.',
  },
  'libs/plugins/commerce/src/lib/components/product-grid.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: 'Storefront grid tile through siteRelativeMediaSrc (9a517e5ec). Resolution only; no scheme refusal.',
  },
  'libs/plugins/commerce/src/lib/components/related-products.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: 'Related-product strip through siteRelativeMediaSrc (9a517e5ec). Resolution only; no scheme refusal.',
  },
  'libs/plugins/commerce/src/lib/components/wishlist.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: 'Wishlist tile through siteRelativeMediaSrc (9a517e5ec). Resolution only; no scheme refusal.',
  },
  'libs/plugins/commerce/src/lib/server/feed.ts': {
    markers: 1,
    guard: 'raw',
    why: 'g:image_link in the Google Merchant feed takes product.mediaUrls[0] with escapeXml and nothing else. Google fetches it, so a relative stored value is also simply broken there.',
  },
  'libs/plugins/commerce/src/lib/server/site-page-resolver.ts': {
    markers: 2,
    guard: 'raw',
    why: 'The product.image and collection.image page tokens substitute the stored string straight into a merchant\'s own page copy, with no resolver between the store and the render.',
  },
  'libs/plugins/email/src/lib/components/email-blocks.tsx': {
    markers: 1,
    guard: 'off-tenant',
    why: 'An email body, not a page. A remote image here is an open-tracking pixel aimed at the RECIPIENT, which is a different problem with a different owner — recorded so it is not mistaken for a tenant sink.',
  },
  'libs/plugins/events-calendar/src/lib/components/event-list.tsx': {
    markers: 3,
    guard: 'media-ref',
    why: "The rendered cover refuses http: and unknown schemes via isRefusedAuthorImageSrc (8ccf1ce3f); the Event JSON-LD alongside it goes through resolveSocialImage, which resolves but does not refuse.",
  },
  'libs/plugins/events-calendar/src/lib/server.ts': {
    markers: 1,
    guard: 'media-ref',
    why: "The server-rendered Event JSON-LD reads coverImage off the document and hands it to resolveSocialImage, which absolutizes a media: reference and passes any other string through. A crawler fetches this one, so no browser policy applies.",
  },
  'libs/plugins/marketing/src/lib/components/site-runtime.tsx': {
    markers: 1,
    guard: 'scheme-guard',
    why: 'The marketing popup image, refusing http: and unknown schemes via isRefusedAuthorImageSrc (8ccf1ce3f). https to any host renders as stored, by decision.',
  },
  'libs/plugins/marketplace/src/lib/components/listing-content.component.tsx': {
    markers: 4,
    guard: 'off-tenant',
    why: 'A marketplace listing page in the console — a publisher-supplied logo, screenshots and lightbox. AGL-1701 case #4 owns this actor pair; it never renders on a customer site.',
  },
  'libs/plugins/marketplace/src/lib/components/listing-image.component.tsx': {
    markers: 1,
    guard: 'off-tenant',
    why: 'The listing card image on the same console surface, and the besigner standalone preview of it.',
  },
  'libs/plugins/mui/src/lib/components/collection.tsx': {
    markers: 3,
    guard: 'media-ref',
    why: 'Markdown body image, entry cover and author avatar, all three through resolveMediaSrc. The body image is additionally scheme-checked at parse time by markdown-lite (AGL-1713); the cover and the avatar are not.',
  },
  'libs/plugins/mui/src/lib/components/custom-html.tsx': {
    markers: 1,
    guard: 'scheme-guard',
    why: "The author's own <style> block — the first of the two sinks this issue is named for. sanitizeAuthorCss rewrites a refused target to url(about:invalid) so the surrounding shorthand stays well-formed. The style ATTRIBUTE route is covered by sanitizeAuthorHtml, because DOMPurify performs no CSS filtering of its own.",
  },
  'libs/plugins/mui/src/lib/components/form.tsx': {
    markers: 1,
    guard: 'platform',
    why: 'A one-rule <style> hiding the honeypot field. The selector is generated by us and the declaration is a literal; no author string reaches it.',
  },
  'libs/plugins/mui/src/lib/components/image.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: "The advertised hotlink. This component's own field help tells authors to paste the URL of an image hosted somewhere else, which is why a host allowlist is not late here but impossible.",
  },
  'libs/plugins/mui/src/lib/components/markdown.tsx': {
    markers: 1,
    guard: 'scheme-guard',
    why: 'Body images take markdown-lite\'s safeImageUrl at parse time — https and media: only since AGL-1713 — and then resolveMediaSrc.',
  },
  'libs/plugins/mui/src/lib/components/product.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: 'The canvas Product card resolves its stored imageUrl with siteRelativeMediaSrc. Resolution only.',
  },
  'libs/plugins/mui/src/lib/components/video.tsx': {
    markers: 1,
    guard: 'media-ref',
    why: 'The video poster frame through resolveMediaSrc. The video src itself is media-src, a different directive, and out of this inventory on purpose.',
  },
  'libs/tenant/runtime/src/lib/collection-fallback-nodes.ts': {
    markers: 1,
    guard: 'scheme-guard',
    why: "The collection cover background-image, https-or-relative since 8ebf69f9c. It rides props.sx composed by us from a stored field, NOT node.sx, so the leaf scrub does not reach it and this guard is load-bearing.",
  },
  'libs/tenant/runtime/src/lib/compose-collection-page.ts': {
    markers: 2,
    guard: 'projection',
    why: "Composes the entry's coverImage into the screen SEO that page.tsx then hands to resolveSocialImage. Nothing is fetched here.",
  },
}

/**
 * The open work, pinned by name (AGL-1725).
 *
 * Every file whose weakest sink applies nothing at all. Asserted as an EXACT
 * set, which is what makes it a decision record rather than a note: closing
 * one of these turns this guard red and forces the issue to be updated in the
 * same commit, and a new raw sink turns it red the other way.
 *
 * What they have in common is that they are all OUT-OF-BAND consumers —
 * JSON-LD read by a crawler, a Merchant feed read by Google, page tokens
 * substituted server-side. No browser fetches them from a document, so no
 * `img-src` can ever govern them however AGL-1726 is decided. The storefront
 * sinks that dominated earlier readings of this issue are no longer here.
 */
const RAW_SINK_FILES = [
  'apps/tenant/app/[host]/[[...slug]]/page.tsx',
  'libs/aglyn/src/lib/app-utils/content-authors.ts',
  'libs/plugins/commerce/src/lib/components/product-detail.tsx',
  'libs/plugins/commerce/src/lib/server/feed.ts',
  'libs/plugins/commerce/src/lib/server/site-page-resolver.ts',
]

const stripBlockComments = (source: string): string =>
  // Newlines preserved so reported line numbers are the file's own. Replacing
  // a comment with '' renumbers everything after it, which turned an earlier
  // draft of this sweep into a confident liar.
  source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))

const sweep = (() => {
  const files: string[] = []
  const walk = (directory: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(path)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      // Specs excluded for the reason the media-coverage guard gives: a
      // fixture `<img>` in a test is not a render decision, and demanding a
      // declaration for one trains people to declare things they do not mean.
      if (/\.(spec|test)\.tsx?$/.test(entry.name)) continue
      files.push(path)
    }
  }
  for (const root of SOURCE_ROOTS) walk(resolve(REPO_ROOT, root))

  const hits = new Map<string, { count: number; lines: number[] }>()
  for (const path of files) {
    const lines = stripBlockComments(readFileSync(path, 'utf8')).split('\n')
    const matched: number[] = []
    lines.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, '')
      // One marker per line, first match wins: `<CardMedia component="img">`
      // split across two lines is two markers and that is fine, but the same
      // line matching two patterns must not be counted twice.
      if (MARKERS.some(([, pattern]) => pattern.test(code))) {
        matched.push(index + 1)
      }
    })
    if (matched.length > 0) {
      hits.set(relative(REPO_ROOT, path), {
        count: matched.length,
        lines: matched,
      })
    }
  }
  return hits
})()

const HOW_TO_FIX =
  `Declare it in DECLARED in this file, with the guard it actually has ` +
  `TODAY and a reason saying what reaches it:\n` +
  `  • media-ref   — resolveMediaSrc / siteRelativeMediaSrc / ` +
  `absoluteMediaSrc. Resolves a stored reference; passes any other string ` +
  `through untouched, so an arbitrary host over any scheme.\n` +
  `  • scheme-guard — additionally refuses http: and unknown schemes ` +
  `(isRefusedAuthorImageSrc, sanitizeAuthorCss/Sx, safeImageUrl). Host ` +
  `still open, by AGL-1725's decision.\n` +
  `  • raw         — nothing applied. Add the file to RAW_SINK_FILES too, ` +
  `and say on AGL-1725 why it is acceptable to ship that way.\n` +
  `  • platform    — a constant of ours; no author string reaches it. Say ` +
  `WHERE the constant comes from, not that it is one.\n` +
  `  • projection  — handed on to a resolver elsewhere. NAME the resolver.\n` +
  `  • off-tenant  — console, besigner, email or marketplace. Say which ` +
  `surface, because "not a tenant page" is the claim most likely to rot.\n\n` +
  `"It is probably fine" is not a reason. Guessing is the entire failure ` +
  `this guard exists to stop — three hand sweeps of AGL-1725 each found the ` +
  `previous one wrong.`

describe('the tenant image-sink inventory is derived from the repo (AGL-1725)', () => {
  it('sweeps a plausible number of image sinks off the source tree', () => {
    // The floor, and it is first for the reason AGL-1867's guard puts its own
    // floor first: a marker list that stopped matching would empty this sweep
    // and leave every assertion below comparing two empty sets — forever
    // green, having proved nothing, while being believed.
    expect(sweep.size).toBeGreaterThanOrEqual(30)
    const total = [...sweep.values()].reduce((sum, hit) => sum + hit.count, 0)
    expect(total).toBeGreaterThanOrEqual(50)
    // The two sinks this issue is NAMED for, by file. If a refactor moves
    // either one, the count assertion below reports a number; this reports
    // which sink went missing.
    expect([...sweep.keys()]).toEqual(
      expect.arrayContaining([
        'libs/plugins/mui/src/lib/components/custom-html.tsx',
        'libs/aglyn-node-renderer/src/lib/components/leaf.tsx',
        'libs/plugins/mui/src/lib/components/image.tsx',
      ]),
    )
  })

  it('declares every file the sweep finds', () => {
    const undeclared = [...sweep.entries()].filter(([file]) => !(file in DECLARED))
    if (undeclared.length > 0) {
      throw new Error(
        `These files emit an image URL on the tenant render path and the ` +
          `AGL-1725 inventory does not name them:\n\n` +
          undeclared
            .map(([file, hit]) => `  • ${file}  (lines ${hit.lines.join(', ')})`)
            .join('\n') +
          `\n\nEvery one is a third-party host that can learn a VISITOR's IP ` +
          `and a Referer naming our customer's site. The visitor is not our ` +
          `user and has no channel to tell us, which is why this outranks ` +
          `its console twin.\n\n${HOW_TO_FIX}`,
      )
    }
  })

  it('names no file the repo has stopped emitting images from', () => {
    const stale = Object.keys(DECLARED).filter((file) => !sweep.has(file))
    // A declaration for a sink that no longer exists is worse than no
    // declaration: it is a decision about something that is not there, and it
    // is what a reader counts when they ask how big the problem is.
    expect(stale).toEqual([])
  })

  it('agrees with each file about how many sinks it has', () => {
    const drifted = Object.entries(DECLARED)
      .filter(([file]) => sweep.has(file))
      .map(([file, declared]) => ({
        file,
        declared: declared.markers,
        found: sweep.get(file)!.count,
        lines: sweep.get(file)!.lines,
      }))
      .filter((row) => row.declared !== row.found)
    if (drifted.length > 0) {
      throw new Error(
        `The declared sink count no longer matches the file:\n\n` +
          drifted
            .map(
              (row) =>
                `  • ${row.file}: declared ${row.declared}, found ` +
                `${row.found} (lines ${row.lines.join(', ')})`,
            )
            .join('\n') +
          `\n\nA count that moved UP is a new sink — classify it. A count ` +
          `that moved DOWN is a sink that went away, or a refactor that put ` +
          `two markers on one line; either way somebody has to look, because ` +
          `the alternative is the number in this file drifting from the code ` +
          `exactly as the number in the issue body did.\n\n${HOW_TO_FIX}`,
      )
    }
  })

  it('pins the set of sinks that apply nothing at all', () => {
    const raw = Object.entries(DECLARED)
      .filter(([, declared]) => declared.guard === 'raw')
      .map(([file]) => file)
      .sort()
    // Exact, in both directions. Closing one of these has to turn this red so
    // the issue is updated in the same commit — the failure mode AGL-1725's
    // own body demonstrated by recording four fixed sinks as unfixed.
    expect(raw).toEqual([...RAW_SINK_FILES].sort())
  })

  it('makes every declaration say what reaches the sink', () => {
    for (const [file, declared] of Object.entries(DECLARED)) {
      // Length is a crude proxy and it is the honest one available: the
      // entries that rot are the ones somebody added in a hurry, and a
      // one-liner is what that looks like.
      expect([file, declared.why.length > 80]).toEqual([file, true])
      expect([file, declared.markers > 0]).toEqual([file, true])
    }
  })

  it('keeps the two author-CSS sinks scheme-guarded', () => {
    // The headline of this issue, asserted by name rather than by count. Both
    // are free-text CSS: no input validator and no source allowlist can see
    // either, and a CSP cannot discriminate them from the advertised <img>
    // hotlink, so the source-level scheme rule is the only control they have.
    expect(
      DECLARED['libs/plugins/mui/src/lib/components/custom-html.tsx'].guard,
    ).toBe('scheme-guard')
    expect(
      DECLARED['libs/aglyn-node-renderer/src/lib/components/leaf.tsx'].guard,
    ).toBe('scheme-guard')
    // And the third and fourth, found after the issue was filed: the style
    // ATTRIBUTE route through sanitizeAuthorHtml, and plugin stylesheets.
    expect(
      DECLARED['libs/aglyn/src/lib/plugin-manager/plugin-styles-ui.tsx'].guard,
    ).toBe('scheme-guard')
  })
})
