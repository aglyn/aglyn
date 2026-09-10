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

import { PLATFORM_BRANDING_PROFILE } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import { deferLazyPanelNodes } from '@aglyn/tenant-runtime/defer-lazy-panels'
import {
  ELEMENT_ANIMATION_STYLE_ID,
  pageAnimationAssets,
} from '@aglyn/tenant-runtime/element-animation-assets'
import { getTemplateScreenRouting } from '@aglyn/tenant-runtime/template-screens'
import type { Metadata } from 'next'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { hostShowsPlatformAttribution } from '../../../../utils/platform-attribution'
import CatchAllClient from './catch-all-client'
import { loadPageData } from './load-page-data'
import PageBodyBoundary from './page-body-boundary'
import SiteAnalytics from './site-analytics'
import type { Props } from './types'

// ISR: the old getStaticPaths used `fallback: 'blocking'` with per-page
// revalidate 60s. generateStaticParams returns nothing (nothing prebuilt);
// every path server-renders on demand and caches for `revalidate` seconds.
/**
 * 60s WAS THE BACKSTOP SET TO THE REQUEST RATE (AGL-1152).
 *
 * This is the only value that controls ISR on this route. The `revalidate`
 * fields the loader returns are INERT — Pages Router leftovers that nothing but
 * the specs reads (see the note on `LoadPageDataResult`) — so tuning them
 * changes nothing and this line is the whole lever.
 *
 * At 60s a page is stale again a minute after it is built, so any path requested
 * less often than that regenerates on essentially EVERY visit and pays the full
 * loader. That is the shape of the traffic this platform actually has: the
 * uptime checks alone hit `/` every minute or so from several regions, and each
 * one was triggering a fresh render. Publishing has been instant since AGL-1150
 * (`revalidateTag` + `revalidatePath` the moment content changes), so the timer
 * was never the propagation mechanism — it was a backstop set to the request
 * rate, the same mistake the render-cache TTLs carried until AGL-1302.
 *
 * ## 3600, and what had to be true first (AGL-2690)
 *
 * This was 600 while three states had no bust and would have inherited the
 * full window. Two of them now do, which is what the previous note here made
 * the condition for raising it:
 *
 *   - MAINTENANCE MODE — the console toggle now drops the whole host's cached
 *     HTML as part of flipping it (`entireHost` on `/api/screens/revalidate`),
 *     so the site goes down and — the direction that matters — comes back
 *     when its owner says so, rather than at the end of a window.
 *   - THE BANDWIDTH CEILING notice — this one has no write to hook at all: it
 *     clears when `bandwidthCeilingMonthKey()` stops matching the stamp, which
 *     is the calendar, not an action. So it moved to `/api/lockdown-verdict`
 *     instead, beside the cap, where the middleware re-reads it every thirty
 *     seconds AHEAD of this cache. The month roll now clears within the memo
 *     rather than within the window, and no scheduled job has to watch
 *     midnight for it.
 *   - SOFT 404s — a path that starts resolving should not stay a 404. This is
 *     the remaining exposure, accepted deliberately: the previous note named
 *     it as the one thing that would still inherit the full window here.
 *
 * ## Why the window was the wrong length rather than merely generous
 *
 * Measured 2026-09-08 on the live estate: 90 unique paths served ~1.2K reads
 * in twelve hours — one request per path every ~54 minutes — against a window
 * of ten. A path went stale five times over before anybody asked for it, so
 * nearly every request paid a full regeneration, and Vercel's own
 * `Write Utilization` for the route read **0.8x**: each cache write was read
 * back less than once before it expired. ISR writes cost 10x reads, which made
 * that inversion the expensive half of the bill.
 *
 * A window shorter than the request rate is not a fresher site — it is the
 * same site, rebuilt for each visitor. That was already the argument against
 * the 60s this route started with; 600 was the same mistake one order of
 * magnitude in.
 *
 * ⚠️ The number is a claim about traffic, so it expires when traffic changes.
 * Long-tail pages are still requested less often than an hour and will keep
 * regenerating per visit; that is the floor, not a defect. Re-read
 * Write Utilization before moving this again — above 1.0x means the window is
 * paying for itself, and the raw write count on its own says nothing.
 */
export const revalidate = 3600
export const dynamicParams = true

/**
 * Headroom for a cold render (AGL-1152). The platform default is 10 s, and the
 * first request against a fresh instance was exceeding it — Vercel then serves
 * `502 BAD_GATEWAY` ("Task timed out after 10 seconds", confirmed in runtime
 * errors on this route), so the visitor got a broken page rather than a slow
 * one.
 *
 * This is the safety net, NOT the fix: the render is now roughly half the work
 * it was (see `loadPageDataCached`), which is what should keep a cold render
 * well inside the limit. Raising the ceiling only changes the failure mode from
 * an error page to a slow page that then caches for `revalidate` seconds — a
 * strictly better way to lose.
 */
export const maxDuration = 60

export function generateStaticParams() {
  return []
}

type CatchAllPageProps = {
  params: Promise<{ host: string; slug?: string[] }>
}

/**
 * Metadata replaces the Pages Router `<Head>` blocks (no-ops in the App
 * Router). Derived server-side from the same composed props — screen SEO
 * with host-level defaults, noindex for the gated/soft-404 surfaces.
 */
function buildMetadata(props: Props): Metadata {
  const host = props.data?.host as any
  const screen = props.data?.screen?.data as any
  const siteTitle: string | undefined = host?.seo?.title ?? host?.displayName
  const separator: string | undefined = host?.seo?.separator
  // White-label (White-Label Phase 2): the generic title fallback reads the
  // org's resolved brand name rather than a hard-coded "Aglyn", so a
  // white-label site with no SEO/display title never leaks the Aglyn brand
  // into its <title>/OG. `branding` is Aglyn defaults for non-white-label
  // orgs and absent surfaces, resolved through the one shared resolver.
  const brandName =
    props.branding?.productName ?? PLATFORM_BRANDING_PROFILE.productName
  /**
   * One title rule for every branch below (AGL-1341).
   *
   * `title` is an authored SEO title and wins VERBATIM; `name` is what the
   * page is otherwise called and is the side the site title joins. The host
   * title was previously appended unconditionally, so every page read the
   * brand twice and ran to ~95 characters against a ~60-character budget.
   *
   * Kept as a local so the four branches cannot drift apart again: whichever
   * one a future surface copies, it copies the rule with it.
   */
  const titleFor = (parts: { title?: string; name?: string }) =>
    Aglyn.resolveSeoTitle({
      ...parts,
      siteTitle,
      separator,
      fallback: `${brandName} site`,
    })

  // Site-wide "discourage search engines" (AGL-1263). Read up here, above the
  // early returns, because it has to reach the CONTENT branch too: collection
  // lists and blog entries emitted no robots directive at all, so a discouraged
  // site would have gone dark everywhere except the pages people actually link
  // to from elsewhere.
  const searchDiscouraged = Aglyn.isSearchDiscouraged(host)

  // Gated / fixed surfaces stay out of search (AGL-87/109/131). Their titles
  // are NAMES we generate, not titles anyone authored, so they take the site
  // title the same way an untitled screen does — "Sign in" alone names no
  // site, and a browser with eight tabs open is exactly where that matters.
  if (props.membershipPage) {
    return {
      title: titleFor({
        name:
          props.membershipPage === 'signup'
            ? 'Sign up'
            : props.membershipPage === 'recover'
              ? 'Reset your password'
              : 'Sign in',
      }),
      robots: { index: false, follow: true },
    }
  }
  if (props.maintenanceFallback) {
    return {
      title: titleFor({ name: 'Temporarily unavailable' }),
      robots: { index: false },
    }
  }
  if (props.memberScreen) {
    return {
      title: titleFor({ name: 'Members only' }),
      robots: { index: false, follow: true },
    }
  }

  /**
   * The author page (AGL-2518): the PERSON drives the head.
   *
   * Their name is what the page is CALLED rather than an authored title, so
   * it keeps the site title after it through the shared resolver — the
   * AGL-1341 rule, same as a collection listing's name.
   *
   * A page past the last one, or a slug naming nobody, never reaches here:
   * the loader 404s both. What DOES reach here is a real author with nothing
   * published, and that page is indexable — a masthead entry for someone who
   * has not written yet is a true page about a real person.
   */
  if (props.author) {
    const author = props.author
    const record = author.record
    const authorBase = Aglyn.hostPublicOrigin(host)
    const authorCanonical = authorBase
      ? authorBase +
        Aglyn.contentAuthorPageAtUrl({
          ...(record ? { author: record } : { authorName: author.slug }),
          page: author.page,
        })
      : undefined
    const authorTitle = titleFor({ name: author.name })
    /**
     * The snippet the author wrote for a search result, then the bio.
     *
     * The bio is the one sentence on the record describing this person to a
     * stranger, which is the right shape for a snippet and is why it is the
     * fallback. It is not the right LENGTH: it is printed beside a byline,
     * where it runs as long as the person wants, and a bio of several hundred
     * characters reaches a result page cut off mid-clause. `seoDescription`
     * is where the short version goes.
     */
    const authorDescription =
      record?.seoDescription?.trim() || record?.bio?.trim() || undefined
    /**
     * The card, through the same resolver every other surface's card goes
     * through — so an author page gains the absolute URL, the dimension pair
     * and `og:image:alt` rather than the bare string this emitted.
     *
     * Resolved in two steps because the SHARE CARD and the PORTRAIT are
     * different pictures with different consequences below: a purpose-made
     * 1200×630 asset is what the wide Twitter card is for, and a square
     * portrait is precisely what it crops to a letterbox. Knowing which one
     * won is therefore part of the answer, not an implementation detail.
     */
    const authorCard = Aglyn.resolveSocialImage({
      sources: [{ image: record?.seoImage, imageAlt: record?.seoImageAlt }],
      host,
    })
    const authorImage =
      authorCard ??
      Aglyn.resolveSocialImage({ sources: [{ image: record?.image }], host })
    return {
      title: authorTitle,
      ...(authorDescription ? { description: authorDescription } : {}),
      // Paged archives stay indexable, like the collection listing's — they
      // are distinct sets of posts, not duplicates of page 1.
      ...(searchDiscouraged ? { robots: { index: false, follow: true } } : {}),
      ...(authorCanonical
        ? { alternates: { canonical: authorCanonical } }
        : {}),
      openGraph: {
        title: authorTitle,
        ...(authorDescription ? { description: authorDescription } : {}),
        // `profile`, not `website`: the subject of the page is a person.
        type: 'profile',
        ...(authorCanonical ? { url: authorCanonical } : {}),
        ...(authorImage ? { images: [authorImage] } : {}),
        ...(siteTitle ? { siteName: siteTitle } : {}),
      },
      twitter: {
        // The wide card only for a picture shaped like one. Falling back to
        // the portrait means falling back to `summary`: a square face in a
        // `summary_large_image` slot is cropped to a letterbox, which is a
        // worse card than the small one that fits.
        card: authorCard ? 'summary_large_image' : 'summary',
        title: authorTitle,
        ...(authorDescription ? { description: authorDescription } : {}),
        ...(authorImage ? { images: [authorImage] } : {}),
      },
    }
  }

  // Content collections (AGL-81/117): entry metadata drives the head.
  // Entry model v2 (AGL-582): per-entry SEO overrides with title/excerpt
  // fallbacks, and the cover image as the social card.
  if (props.content) {
    const content = props.content as any
    const entry = content.entry
    // A category listing is its own page and needs its own title (AGL-1321) —
    // five URLs all titled "Blog" are five duplicate results in a SERP.
    const category = content.category
    // Same rule as a screen (AGL-1341): the entry's own `seoTitle` is the
    // authored one and renders verbatim, while a headline or a list name is
    // what the page is CALLED and still earns the site title after it. An
    // entry page never inherits the TEMPLATE screen's SEO title — one authored
    // title would then name every post in the collection.
    const name = entry
      ? entry.title
      : category
        ? [category.name, content.collection?.displayName]
            .filter(Boolean)
            .join(' · ')
        : content.collection?.displayName
    /**
     * A collection LIST is somebody's screen, and its SEO is read here
     * (AGL-1345).
     *
     * `/changelog` emitted no screen metadata at all — the collection's name
     * as the title and the platform boilerplate from the root layout as the
     * description — while `/blog` and `/press`, structurally identical pages
     * on the same host, resolved theirs correctly. The difference is not in
     * the pages but in how each is ROUTED: `/changelog`'s screen is also its
     * collection's `listScreenId`, and a template screen is deliberately
     * dropped from the routing map (AGL-1267), so the request falls past the
     * screen branch into this one. `/blog` and `/press` are ordinary screens,
     * so they reach the screen branch below and always did.
     *
     * That made this branch the head for a page whose body it never described:
     * the screen composes the body (`composeCollectionTemplatePage` hands its
     * doc through as `data.screen`), and only the collection reached the head.
     * Same screen, two answers — the very thing being fixed is that the head
     * and the body now read one record.
     *
     * The ENTRY case is untouched and must stay that way: an entry's `seoTitle`
     * is its own, and inheriting the template's would title every post in the
     * collection identically. A CATEGORY listing likewise keeps its composed
     * name (AGL-1321) — an authored title applied to five filtered URLs is the
     * same duplication in a new place. Both still take the screen's
     * description, which is a summary of the list they are showing and is
     * strictly better than falling through to a site-wide default that is
     * every bit as duplicated and says nothing about the page.
     */
    const listScreenSeo = entry ? undefined : screen?.seo
    const authoredTitle = entry
      ? entry.seoTitle
      : category
        ? undefined
        : listScreenSeo?.title
    /**
     * The same chain the screen branch uses, so the two cannot disagree about
     * where a description comes from — with the routed CATEGORY ahead of it.
     *
     * A category's own description is the only sentence on this list that is
     * about the filtered listing rather than the whole collection. Without
     * one, every `/{collection}/category/{slug}` on a site repeats the list
     * template's description verbatim: as many identical snippets as the
     * taxonomy has categories, which is the duplication the composed category
     * title (AGL-1321) exists to avoid, in the tag beneath it. An undescribed
     * category still inherits, because the list it filters describes it
     * better than the site-wide default does.
     */
    const description: string | undefined = entry
      ? entry.seoDescription || entry.excerpt || undefined
      : category?.description ||
        listScreenSeo?.description ||
        screen?.description ||
        host?.seo?.description
    // The card image (AGL-1337). The entry's own cover wins, then the
    // template screen's, then the site default — the same precedence list the
    // screen branch uses, through the same resolver, so a collection list (an
    // entry-less page that could never have had a cover) now gets the site
    // default instead of sharing as a bare `summary` card.
    //
    // The resolver is what makes the URL ABSOLUTE and attaches the
    // dimensions; before it, a cover stored as a `media:` reference reached
    // `og:image` as the literal string `media:…`.
    const socialImage = Aglyn.resolveSocialImage({
      // The alt travels WITH the reference (AGL-2417) — never taken from a
      // level the image did not come from, which would describe a picture the
      // card does not show.
      sources: [
        { image: entry?.coverImage, imageAlt: entry?.coverImageAlt },
        screen?.seo,
        host?.seo,
      ],
      host,
    })
    const fullTitle = titleFor({ title: authoredTitle, name })
    // Collection pages had NO canonical at all (AGL-1272). This branch returns
    // before the screen path builds one, so every `/blog` and `/blog/{entry}`
    // shipped without the tag — on a site reachable at two origins, that is
    // exactly the set of pages with the most duplicate URLs and the least to
    // say about which one counts. The redirect handles the platform-subdomain
    // twin; this handles the rest (a paginated list is its own page, and an
    // entry reachable through more than one route still resolves to one URL).
    //
    // Derived, not passed: entry routing is `/{collection}/{entry}` and lists
    // are `/{collection}` (`/{collection}/page/{n}` beyond page 1), the same
    // derivation `buildJsonLd` already makes from this payload.
    //
    // Category listings join the same derivation through the shared URL
    // builder (AGL-1321), so the canonical, the pills and the pager cannot
    // disagree about the shape — and "All" resolves to the bare
    // `/{collection}`, never a second address for a page that already exists.
    const collectionBase = Aglyn.hostPublicOrigin(host)
    const collectionSlug: string | undefined = content.collection?.slug
    const listPage = Number(content.pagination?.page) || 1
    const contentCanonical =
      collectionBase && collectionSlug
        ? entry?.slug
          ? `${collectionBase}/${collectionSlug}/${entry.slug}`
          : collectionBase +
            Aglyn.collectionListUrl({
              collectionSlug,
              ...(category ? { categorySlug: category.slug } : {}),
              page: listPage,
            })
        : undefined
    // A category segment that names nothing in the taxonomy AND turned up no
    // entries is an address for content that does not exist — infinitely many
    // of them, since anyone can type one. It renders (honestly, as an empty
    // state, rather than crashing or 404ing a category an author may be about
    // to fill), but it must not invite indexing.
    const unknownCategory = Boolean(
      category && !category.known && !content.entries?.length,
    )
    // Feed autodiscovery (AGL-2391). `/{collection}/rss.xml` has been served
    // since AGL-1385, but nothing ever ANNOUNCED it: a reader pointed at
    // `/blog` had no way to find the feed, and `apps/docs` says so out loud
    // ("feed readers don't discover it automatically yet"). A body link to
    // the feed — which aglyn.com/blog has — is a link for people, not for
    // readers; the `<link rel="alternate">` is the one browsers, readers and
    // aggregators actually look at.
    //
    // Announced on entry and category pages too, not just the list root: the
    // collection feed is the only feed the platform produces for that
    // content, and it is the URL a reader should end up subscribed to
    // whichever of its pages they were handed. Skipped on an unknown
    // category for the same reason that branch is `noindex` — that address
    // names no content, so it has no feed to offer.
    const collectionFeed =
      collectionBase && collectionSlug && !unknownCategory
        ? `${collectionBase}/${collectionSlug}/rss.xml`
        : undefined
    return {
      title: fullTitle,
      ...(description ? { description } : {}),
      ...(searchDiscouraged || unknownCategory
        ? { robots: { index: false, follow: true } }
        : {}),
      ...(contentCanonical || collectionFeed
        ? {
            alternates: {
              ...(contentCanonical ? { canonical: contentCanonical } : {}),
              ...(collectionFeed
                ? { types: { 'application/rss+xml': collectionFeed } }
                : {}),
            },
          }
        : {}),
      openGraph: {
        title: fullTitle,
        ...(description ? { description } : {}),
        type: entry ? 'article' : 'website',
        ...(contentCanonical ? { url: contentCanonical } : {}),
        ...(socialImage ? { images: [socialImage] } : {}),
        ...(siteTitle ? { siteName: siteTitle } : {}),
      },
      twitter: {
        card: socialImage ? 'summary_large_image' : 'summary',
        ...(socialImage ? { images: [socialImage] } : {}),
      },
    }
  }

  // Screen render (SEO Toolkit): screen fields with host-level fallbacks.
  // The screen's own SEO title is the authored one and is emitted exactly as
  // typed (AGL-1341); `displayName` is the internal name of the screen, so a
  // screen nobody wrote a title for renders "Contact – Acme" rather than a
  // bare "Contact" or — worse — the site title alone, which every untitled
  // screen would then share.
  const fullTitle = titleFor({
    title: screen?.seo?.title,
    name: screen?.displayName,
  })
  const description: string | undefined =
    screen?.seo?.description || screen?.description || host?.seo?.description
  // Screen image, then the site default (AGL-1337). Clearing a screen's
  // image stores `''`, which is falsy here — so "cleared" means "inherit the
  // site default" rather than "no card", and neither set stays absent.
  const socialImage = Aglyn.resolveSocialImage({
    sources: [screen?.seo, host?.seo],
    host,
  })
  // One policy, four surfaces (AGL-1263): this, the client twin in
  // `catch-all-client.tsx`, `robots.txt` and `sitemap.xml` all ask
  // `isPageIndexable` rather than each keeping their own copy of the rule.
  const noindex =
    !Aglyn.isPageIndexable({ host, screen }) ||
    props.notFoundFallback ||
    props.protectedScreen
  // Shared with the client twin and the email renderer (AGL-1224) — three
  // copies of "which name does this site answer to" would drift.
  const canonicalBase = Aglyn.hostPublicOrigin(host)
  const screenPath = screen?.$id ? host?.screens?.[screen.$id] : undefined
  const canonical =
    canonicalBase && screenPath != null
      ? `${canonicalBase}${Aglyn.screenRoutePathToUrl(screenPath)}`
      : undefined

  // hreflang alternates (AGL-164): the Pages Router emitted `<link
  // rel="alternate" hreflang>` from the inert <Head>; the App Router routes
  // them through `alternates.languages`. Variants resolve through the
  // routing map so slug renames stay correct; the current screen registers
  // under its own locale (or x-default).
  const localeVariants = screen?.localeVariants as
    Record<string, string> | undefined
  const languages: Record<string, string> = {}
  if (canonicalBase && localeVariants) {
    for (const [locale, variantId] of Object.entries(localeVariants)) {
      const variantPath = host?.screens?.[variantId]
      if (variantPath != null) {
        languages[locale] =
          `${canonicalBase}${Aglyn.screenRoutePathToUrl(variantPath)}`
      }
    }
    if (canonical) languages[screen?.locale || 'x-default'] = canonical
  }
  const hasLanguages = Object.keys(languages).length > 0
  /*
    The Markdown representation, advertised in the head (AGL-2716).

    `<link rel="alternate" type="text/markdown">` is what llmstxt.org names as
    the way a page points at its own clean-text form, and it is the only route
    for an agent that reads HTML but sets no `Accept` header — which is most of
    them. The `.md` spelling rather than the negotiated one, deliberately: a
    link has no request headers to carry, so the URL has to be the thing that
    asks.

    Withheld from a noindex page for the same reason its canonical is: a page
    the site has asked crawlers to skip should not be advertising a second
    address for the same content.
  */
  const markdownAlternate =
    canonical && !noindex
      ? // The home page has no filename to hang the suffix on, so it takes the
        // directory-index spelling — `https://site/` becomes
        // `https://site/index.md`, which the middleware maps back to the root.
        canonical.endsWith('/')
        ? `${canonical}index.md`
        : `${canonical}.md`
      : undefined
  const alternates = {
    ...(canonical ? { canonical } : {}),
    ...(hasLanguages ? { languages } : {}),
    ...(markdownAlternate
      ? { types: { 'text/markdown': markdownAlternate } }
      : {}),
  }

  return {
    title: fullTitle,
    ...(description ? { description } : {}),
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    ...(canonical || hasLanguages || markdownAlternate ? { alternates } : {}),
    openGraph: {
      title: fullTitle,
      ...(description ? { description } : {}),
      type: 'website',
      ...(canonical ? { url: canonical } : {}),
      // A DESCRIPTOR, not a bare string: Next emits `og:image:width` and
      // `og:image:height` only for the object form, and the bare string is
      // what left every card without them (AGL-1337).
      ...(socialImage ? { images: [socialImage] } : {}),
      ...(siteTitle ? { siteName: siteTitle } : {}),
    },
    twitter: {
      // The upgrade the whole issue is about: a page with an image shares as
      // the large card, and a page without one keeps the small `summary`
      // rather than promising an image it has not got.
      card: socialImage ? 'summary_large_image' : 'summary',
      ...(socialImage ? { images: [socialImage] } : {}),
    },
  }
}

/**
 * Structured data (AGL-143). The Metadata API has no JSON-LD slot, so the
 * Pages Router `<Head>` `<script type="application/ld+json">` blocks (inert
 * under the App Router) are rebuilt here and rendered server-side in the page
 * body: an `Article` for content entries, otherwise a `WebSite` for the host
 * plus a `BreadcrumbList` for nested screen paths. Gated surfaces (membership,
 * maintenance, members-only) emit nothing, matching the old markup.
 */
function buildJsonLd(props: Props): string[] {
  if (props.membershipPage || props.maintenanceFallback || props.memberScreen) {
    return []
  }
  const host = props.data?.host as any
  // `hostPublicOrigin`, not a re-derived apex (AGL-2195). This branch was a
  // hand-copied twin of it with `aglyn.app` written in, so every JSON-LD `@id`
  // and `url` a self-hosted deployment emitted named OUR apex for a site we do
  // not serve — published into the structured data search engines read, on a
  // site the operator owns. The `<link rel="canonical">` above already asks the
  // shared helper; there is no reason for the same question to have two answers.
  const canonicalBase = Aglyn.hostPublicOrigin(host)
  // Through the shared serializer (AGL-2486) rather than an inline ternary, so
  // the site entity and a post author answer `Person` or `Organization` the
  // same way — see `content-authors.ts`. It also FIXES that answer: the Setup
  // → SEO → Entity Select persists its option value as the STRING `"2"` (its
  // options are template literals) and this compared it with the numeric enum
  // `HostEntityType.PERSON`, so a site that declared itself a Person published
  // `"@type": "Organization"` on every page. Strict equality across a string
  // and a number is always false; nothing here could ever have said Person.
  const publisher = Aglyn.hostSeoEntityJsonLd(host?.seo?.entity)

  /*
    THE SITE'S OWN ENTITY, as a top-level node (AGL-2716).

    `publisher` above already names the entity, and it is not enough for the
    readers this exists for: it is nested two levels inside a `WebSite` or an
    `Article`, it carries a name and a picture and nothing else, and it is
    absent entirely on the sites whose author never found the Entity form. An
    assistant asked "who runs this site and how do I reach them", or an audit
    checking whether a business is identifiable, looks for a TOP-LEVEL
    `Organization` with `name`, `description`, `contactPoint` and `address`.

    `siteEntityJsonLd` falls back to the site's own identity, so every site
    publishes a complete entity rather than only the configured ones, and it
    shares an `@id` with the nested publisher so a consumer merges the two
    instead of reading a site that names its publisher twice with different
    detail.

    Computed HERE, above every branch, and prepended to each of them. This
    function returns early four times — author page, collection list, content
    entry, and the general case — and a node pushed in only the last of them
    would be missing from exactly the pages an agent is most likely to land on.
    Emitted on every page rather than only the home page for the same reason:
    an agent fetches one URL and reads what is on it.
  */
  const siteEntity = Aglyn.siteEntityJsonLd(host, {
    origin: canonicalBase,
    hostId: host?.$id,
  })
  const siteEntityLd = siteEntity ? [Aglyn.safeJsonLd(siteEntity)] : []

  /**
   * The author page → `ProfilePage` wrapping the `Person` (AGL-2518).
   *
   * `ProfilePage` is the type schema.org defines for "a page about one
   * person or organization", and its `mainEntity` is the entity itself — so
   * the author record serializes through the SAME builder that writes
   * `Article.author` on every post they wrote (`contentAuthorJsonLd`). One
   * `Person` shape, two places, which is what lets a crawler join the byline
   * on an article to the page that collects them.
   *
   * No `ItemList` of their posts beside it. A collection listing emits one
   * because the list IS what that page is; here the page is the PERSON, and
   * every post already names them as its `Article.author` from its own page —
   * which is the edge a crawler follows, and the one that stays true when
   * this archive paginates.
   */
  if (props.author) {
    const author = props.author
    const record = author.record
    const person = Aglyn.contentAuthorJsonLd(record, {
      origin: canonicalBase,
      hostId: host?.$id,
    })
    if (!canonicalBase || !person) return siteEntityLd
    const authorUrl =
      canonicalBase +
      Aglyn.contentAuthorPageAtUrl({
        ...(record ? { author: record } : { authorName: author.slug }),
        page: author.page,
      })
    return [
      ...siteEntityLd,
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        url: authorUrl,
        name: author.name,
        mainEntity: person,
        // The site entity WITH its mark, the same shape the Article branch
        // publishes (AGL-2534). This spread was the bare `publisher` — so an
        // author page named the publisher and an article by that author
        // pictured it, from one `host.seo.entity`. `logo` for an
        // Organization, `image` for a Person; the helper picks, because
        // schema.org gives `logo` only to the first.
        ...(publisher && {
          publisher: {
            ...publisher,
            ...Aglyn.hostSeoEntityImageJsonLd(host?.seo?.entity, {
              origin: canonicalBase,
              hostId: host?.$id,
            }),
          },
        }),
      }),
    ]
  }

  // Content entry → Article; collection list → ItemList (AGL-660).
  if (props.content) {
    const content = props.content as any
    const entry = content.entry
    const collectionSlug: string | undefined = content.collection?.slug
    // Entry routing is /{collectionSlug}/{entrySlug} (list is
    // /{collectionSlug}), so entry URLs are derivable rather than guessed.
    const entryUrl = (slug?: string) =>
      canonicalBase && collectionSlug && slug
        ? `${canonicalBase}/${collectionSlug}/${slug}`
        : undefined

    // A list page carries `entries` but no `entry`, and used to emit nothing
    // at all — so /blog had no structured data whatsoever.
    if (!entry) {
      const entries: any[] = Array.isArray(content.entries)
        ? content.entries
        : []
      if (!canonicalBase || !collectionSlug || entries.length === 0) {
        return siteEntityLd
      }
      // The list a filtered URL describes is the FILTERED one (AGL-1321):
      // naming and addressing it as the whole collection would tell a crawler
      // that five different pages are all the same list.
      const listCategory = content.category
      /*
        A FILTERED listing gets a breadcrumb; the bare one does not
        (AGL-2535).

        `/blog/category/guides` has a real parent — the collection — so the
        trail is two deep and worth publishing. `/blog` is one crumb, which
        `breadcrumbListJsonLd` declines: a single-element list is the page
        restating its own title, and Google treats it as ineligible.
      */
      const listCrumbs = listCategory
        ? Aglyn.breadcrumbListJsonLd(
            [
              {
                name: content.collection?.displayName ?? collectionSlug,
                path: Aglyn.collectionListUrl({ collectionSlug }),
              },
              {
                name: listCategory.name,
                path: Aglyn.collectionListUrl({
                  collectionSlug,
                  categorySlug: listCategory.slug,
                }),
              },
            ],
            canonicalBase,
          )
        : undefined
      return [
        ...siteEntityLd,
        ...(listCrumbs
          ? [
              Aglyn.safeJsonLd({
                '@context': 'https://schema.org',
                ...listCrumbs,
              }),
            ]
          : []),
        Aglyn.safeJsonLd({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: listCategory
            ? [listCategory.name, content.collection?.displayName]
                .filter(Boolean)
                .join(' · ')
            : (content.collection?.displayName ?? collectionSlug),
          url:
            canonicalBase +
            Aglyn.collectionListUrl({
              collectionSlug,
              ...(listCategory ? { categorySlug: listCategory.slug } : {}),
            }),
          numberOfItems: entries.length,
          itemListElement: entries.map((item, index) => ({
            '@type': 'ListItem',
            // Position is 1-based and must reflect the page the reader is
            // on, or paginated lists all claim positions 1..n.
            position:
              ((Number(content.pagination?.page) || 1) - 1) *
                (Number(content.pagination?.perPage) || entries.length) +
              index +
              1,
            ...(entryUrl(item.slug) && { url: entryUrl(item.slug) }),
            name: item.title,
          })),
        }),
      ]
    }
    // Category name resolves against the collection taxonomy (AGL-582):
    // stable categoryId lookup first, legacy free-typed string fallback.
    const categoryName = Aglyn.resolveEntryCategoryName(
      entry,
      content.collection?.categories,
    )
    const articleUrl = entryUrl(entry.slug)
    // The cover through the SAME resolver as `og:image` (AGL-1343).
    //
    // This emitted `entry.coverImage` verbatim, so a cover picked from the DAM
    // reached the structured data as the literal string `media:{scope}/{id}`
    // and a stored path reached it site-relative — unfetchable for a crawler
    // that has no page to resolve it against, which is precisely the defect
    // AGL-1337 fixed one surface over in the meta tags. Nothing about "absolute
    // and crawlable" differs between the two, so neither should the code:
    // whoever changes how a cover resolves must not have to find both.
    //
    // The precedence list is deliberately the ENTRY'S COVER ALONE, where the
    // head passes `[entry, screen, host]`. A missing `og:image` costs a large
    // share card and the site default is a fair stand-in; `Article.image` is a
    // claim about THIS article, and answering it with the site-wide card would
    // tell Google that every coverless post is illustrated by the same asset.
    // Omitted is the honest answer, and it is what this already did.
    const articleImage = Aglyn.resolveSocialImage({
      sources: [{ image: entry.coverImage }],
      host,
    })
    // The author's portrait resolves against the SAME origin and host the
    // cover just did (AGL-2486), so a picture picked from the DAM reaches the
    // structured data as a fetchable absolute URL rather than the literal
    // `media:{scope}/{id}` — the AGL-1343 lesson, one field over.
    const articleAuthor = Aglyn.contentAuthorJsonLd(
      // The loader's resolved record first — it is the only value that still
      // carries the author's TYPE, url, portrait and profiles. Re-deriving
      // from the entry alone would find the denormalized `authorName` and
      // publish an Organization byline as a Person. `resolveEntryAuthor` is
      // the fallback for an entry that reached here without the loader (the
      // legacy `authorName` shape), and returns null when there is no byline
      // at all so the site entity below wins.
      entry.author ?? Aglyn.resolveEntryAuthor(entry),
      { origin: canonicalBase, hostId: host?.$id },
    )
    /*
      The entry's own trail (AGL-2535): the collection, then this piece.

      Two deep, with both names already resolved — `collection.displayName`
      and the entry's `title`. Nothing on a content route published a
      breadcrumb before this, which meant the deepest URLs on the site, and
      the ones a breadcrumb actually helps in a result, were the only ones
      without.

      Named from the DISPLAY values rather than the path segments. The screen
      builder further down splits the routing map and so publishes slugs; here
      the headline is in hand, and `from-a-form-to-a-dataset-in-five-minutes`
      is not a crumb name.
    */
    const entryCrumbs = collectionSlug
      ? Aglyn.breadcrumbListJsonLd(
          [
            {
              name: content.collection?.displayName ?? collectionSlug,
              path: Aglyn.collectionListUrl({ collectionSlug }),
            },
            { name: entry.title, path: `/${collectionSlug}/${entry.slug}` },
          ],
          canonicalBase,
        )
      : undefined
    return [
      ...siteEntityLd,
      ...(entryCrumbs
        ? [
            Aglyn.safeJsonLd({
              '@context': 'https://schema.org',
              ...entryCrumbs,
            }),
          ]
        : []),
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        /*
          The collection says what KIND of article this is (AGL-2536).

          Every entry published as a bare `Article` before this, whatever it
          was — so a press release, a blog post and a changelog note
          serialised identically and none claimed the more specific type
          `schema.org` defines for it. Unset still publishes `Article`, so
          nothing moved under any site that has not chosen.

          The loader already normalizes, so this call is not what keeps an
          unrecognised stored value out of the document — it is what narrows
          the loader's `string` to a type this literal will accept, and what
          answers for the collection being absent entirely.
        */
        '@type': Aglyn.normalizeContentSchemaType(
          content.collection?.schemaType,
        ),
        headline: entry.title,
        ...(entry.excerpt && { description: entry.excerpt }),
        // Absent, never `"image": [null]` — the resolver returns undefined for
        // an empty cover, an unresolvable reference, and a host that names no
        // origin alike, and `strictNullChecks` is off repo-wide so this guard
        // is load-bearing rather than decorative.
        ...(articleImage && { image: [articleImage.url] }),
        // Entry model v2 (AGL-582): taxonomy enriches rich results.
        ...(categoryName && { articleSection: categoryName }),
        ...(Array.isArray(entry.tags) &&
          entry.tags.length && { keywords: entry.tags.join(', ') }),
        ...(entry.publishedAt?.seconds && {
          datePublished: new Date(
            entry.publishedAt.seconds * 1000,
          ).toISOString(),
        }),
        ...(entry.updatedAt?.seconds && {
          dateModified: new Date(entry.updatedAt.seconds * 1000).toISOString(),
        }),
        // Byline (AGL-686, AGL-2486): the entry's own author when it names
        // one, otherwise the site. Every post used to attribute to the same
        // entity, which is not what Article.author means.
        //
        // `entry.author` is the resolved custom-author RECORD — a Person or an
        // Organization with url, portrait, job title and `sameAs` profiles —
        // and the loader falls back to the legacy free-typed `authorName` by
        // promoting it to a bare `{'@type': 'Person', name}`, which is byte
        // for byte what this emitted for it before. So an entry stored in
        // either shape keeps its byline, and neither regresses to the site.
        ...(articleAuthor
          ? { author: articleAuthor }
          : publisher
            ? { author: publisher }
            : {}),
        // The site remains the PUBLISHER regardless — that is the org that
        // put the piece out, distinct from who wrote it.
        ...(publisher && {
          publisher: {
            ...publisher,
            // `logo` for an Organization, `image` for a Person — schema.org
            // gives `logo` only to the first (AGL-2486). This spread wrote
            // `logo` either way, so a Person publisher emitted a property its
            // own `@type` does not define and every consumer ignored it.
            ...Aglyn.hostSeoEntityImageJsonLd(host?.seo?.entity, {
              origin: canonicalBase,
              hostId: host?.$id,
            }),
          },
        }),
        // Google wants an article to say which page it IS — without these it
        // is a floating description with no canonical anchor.
        ...(articleUrl && {
          url: articleUrl,
          mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
        }),
      }),
    ]
  }

  // Screen render → WebSite (+ BreadcrumbList for nested paths).
  const ld: string[] = [...siteEntityLd]

  // Product detail → Product/Offer (AGL-660). Emitted HERE, on the server,
  // from the payload the commerce resolver already resolved (AGL-659). The
  // PDP block used to build this from client state, so it never reached the
  // HTML a crawler reads — which is the whole point of product structured
  // data (rich results, Merchant listings).
  const seededCommerce = (
    props.pageData as
      | {
          commerce?: {
            product?: {
              name: string
              slug: string
              description?: string
              mediaUrls?: string[]
              variants?: Array<{
                priceUsd: number
                soldOut?: boolean
                sku?: string
              }>
            }
            reviews?: { aggregate?: { count: number; average: number } }
          }
        }
      | undefined
  )?.commerce
  const seededProduct = seededCommerce?.product
  if (seededProduct && canonicalBase) {
    const prices = (seededProduct.variants ?? [])
      .map((variant) => Number(variant.priceUsd))
      .filter((price) => Number.isFinite(price))
    const low = prices.length ? Math.min(...prices) : undefined
    const high = prices.length ? Math.max(...prices) : undefined
    // Out of stock only when EVERY variant is — one available size still
    // makes the product purchasable.
    const inStock = (seededProduct.variants ?? []).some(
      (variant) => !variant.soldOut,
    )
    const availability = `https://schema.org/${
      inStock ? 'InStock' : 'OutOfStock'
    }`
    const variants = seededProduct.variants ?? []
    const skus = variants
      .map((variant) => variant.sku)
      .filter((value): value is string => Boolean(value))
    // One variant, one SKU — anything else is ambiguous (see below).
    const sku = variants.length === 1 && skus.length === 1 ? skus[0] : undefined
    const ratingAggregate = seededCommerce?.reviews?.aggregate
    ld.push(
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: seededProduct.name,
        ...(seededProduct.description && {
          description: seededProduct.description,
        }),
        ...(seededProduct.mediaUrls?.length && {
          image: seededProduct.mediaUrls,
        }),
        url: `${canonicalBase}/products/${seededProduct.slug}`,
        ...(publisher && { brand: publisher }),
        // `sku` only when it is unambiguous (AGL-686). Schema.org Product.sku
        // is a single value, but a SKU belongs to a VARIANT — emitting the
        // first of several would advertise one variant's code for the whole
        // product, which is worse than omitting it. Multi-variant products
        // want a ProductGroup, which is a larger modelling change.
        ...(sku && { sku }),
        // Rating nested as a PROPERTY of the product (AGL-686). The reviews
        // block used to emit a free-standing AggregateRating node, which is
        // orphaned and ignored. Only emitted when reviews exist — Google
        // rejects a rating with no reviews behind it.
        ...(ratingAggregate?.count
          ? {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: ratingAggregate.average,
                reviewCount: ratingAggregate.count,
              },
            }
          : {}),
        // Currency isn't modelled on the product yet, so USD is assumed —
        // the same assumption the client block made. Revisit with
        // multi-currency.
        ...(low != null && {
          offers:
            low === high
              ? {
                  '@type': 'Offer',
                  price: low,
                  priceCurrency: 'USD',
                  availability,
                  url: `${canonicalBase}/products/${seededProduct.slug}`,
                }
              : {
                  '@type': 'AggregateOffer',
                  lowPrice: low,
                  highPrice: high,
                  priceCurrency: 'USD',
                  offerCount: prices.length,
                  availability,
                },
        }),
      }),
    )
  }

  const screen = props.data?.screen?.data as any
  const siteTitle: string | undefined = host?.seo?.title ?? host?.displayName
  if (canonicalBase) {
    ld.push(
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteTitle ?? host?.displayName ?? 'Site',
        url: canonicalBase,
        ...(host?.seo?.entity?.name && {
          publisher: {
            ...publisher,
            ...Aglyn.hostSeoEntityImageJsonLd(host.seo.entity, {
              origin: canonicalBase,
              hostId: host?.$id,
            }),
          },
        }),
      }),
    )
  }
  const screenPath = screen?.$id ? host?.screens?.[screen.$id] : undefined
  const segments =
    typeof screenPath === 'string' ? screenPath.split('/').filter(Boolean) : []
  if (canonicalBase && segments.length > 1) {
    ld.push(
      Aglyn.safeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: segments.map((segment, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: segment,
          item: `${canonicalBase}/${segments.slice(0, index + 1).join('/')}`,
        })),
      }),
    )
  }
  return ld
}

/**
 * `<meta name="generator" content="Aglyn" />` on published pages (AGL-2088).
 *
 * The canonical CMS signal — WordPress, Squarespace, Drupal and Ghost all ship
 * one, and it is how tech-stack detectors identify most of the field. Aglyn
 * emitted no generator tag anywhere, which is why Wappalyzer reports a live
 * Aglyn site as "Next.js, React, Emotion, Vercel" and never as Aglyn.
 *
 * WHY IT SITS HERE and not in `buildMetadata`. That function has five early
 * returns (membership, maintenance, members-only, content, screen) and gains
 * more as surfaces are added; threading one field through each is precisely
 * the per-surface re-derivation the branding resolvers exist to prevent, and a
 * branch someone forgets is a branch that silently stops carrying the tag.
 * Applied once, after, it covers every branch including ones not yet written.
 *
 * WHY IT SITS HERE and not in the root layout's static `metadata`, which would
 * be a one-line change: that metadata is unconditional, and this tag must not
 * appear on a white-labelled site under any circumstances. There is no request
 * or host at that layer to gate on — the same reason the version headers could
 * not be gated in `next.config`.
 *
 * The gate FAILS CLOSED inside `hostShowsPlatformAttribution`; see the ⚠️ there
 * for why an unresolved org must not read as "not white-labelled".
 */
export async function generateMetadata({
  params,
}: CatchAllPageProps): Promise<Metadata> {
  const { host, slug } = await params
  const result = await loadPageData(host, slug ?? [])
  if (!('props' in result)) return {}
  const metadata = buildMetadata(result.props)
  return (await hostShowsPlatformAttribution(host))
    ? { ...metadata, generator: Aglyn.PLATFORM_GENERATOR_NAME }
    : metadata
}

/**
 * Catch-all tenant site render (AGL-398), migrated from the Pages Router
 * `[[...slug]]` + getStaticProps. The server loader composes the page and
 * this route maps its result to `notFound()` / `redirect()` / the client
 * renderer. Metadata comes from `generateMetadata`; the two share one
 * `cache`d `loadPageData` call per request — which only holds because the
 * loader keys its cache on a primitive. Passing the slug ARRAY straight through
 * silently defeats that and doubles every render (AGL-1152).
 */
export default async function CatchAllPage({ params }: CatchAllPageProps) {
  const { host, slug } = await params
  const result = await loadPageData(host, slug ?? [])
  if ('notFound' in result) notFound()
  if ('redirect' in result) {
    const { destination, statusCode } = result.redirect
    if (statusCode === 301 || statusCode === 308) permanentRedirect(destination)
    redirect(destination)
  }
  const jsonLd = buildJsonLd(result.props)
  // Withhold the subtrees of lazy tab panels that will not mount (AGL-1285).
  //
  // Applied HERE rather than inside the loader, and the distinction is the
  // whole design. `loadPageData` is what `/api/screen/nodes` calls to serve
  // the full document back, and `generateMetadata` shares its cache entry —
  // pruning inside it would leave nothing to fetch and no way to un-prune.
  // This is the one place the nodes become a CLIENT prop, which is exactly
  // where the payload cost is incurred: what never crosses into
  // `CatchAllClient` is never serialized into the flight payload.
  //
  // A new props object, never a mutated one: `result.props` belongs to the
  // cached loader.
  const deferred = result.props.nodes
    ? deferLazyPanelNodes(result.props.nodes)
    : null
  // `blockingPlugins` is already on `result.props` — the loader computes it
  // from the FULL document, before this prune. That ordering matters: a
  // component sitting inside a withheld panel still belongs to this page, and
  // narrowing on the pruned map would drop its plugin and leave that panel
  // unrenderable the moment someone opened it.
  const prunedProps: Props = deferred?.deferredPanelIds.length
    ? {
        ...result.props,
        nodes: deferred.nodes,
        deferral: { host, slug: slug ?? [] },
      }
    : result.props
  /**
   * Screen links resolve against the routing map the ROUTER honours, not the
   * one publishing wrote (AGL-1998).
   *
   * `host.screens` carries every screen under its own published slug, and the
   * loader then edits that table at serve time: template screens are dropped,
   * and a collection's list template answers at `/{collectionSlug}` instead of
   * the slug it was published under. A screen link rendered from the raw map
   * therefore emitted an href the site itself 404s — on aglyn.com, every link
   * pointing at the blog's list template said `/blog-list-template`.
   *
   * Derived HERE because this is the one place the props become a client prop,
   * and it costs no Firestore read: `load-page-data` has already asked for the
   * same cache entry on this request (it is how the route was matched), so this
   * is a hit on `unstable_cache` rather than a second trip.
   */
  const routedHost = result.props.data?.host as
    { $id?: string; screens?: Record<string, string> } | undefined
  let screenRoutes: Record<string, string> | undefined
  if (routedHost?.$id) {
    const routing = await getTemplateScreenRouting({ hostId: routedHost.$id })
    screenRoutes = Aglyn.linkableScreenRoutes(routedHost.screens, {
      routedElsewhere: routing.listRoutes,
      unrouted: routing.templateScreenIds,
    })
  }
  // A new object again, never a mutated one — `result.props` belongs to the
  // cached loader, and `prunedProps` IS that object whenever nothing was
  // withheld above.
  const clientProps: Props = screenRoutes
    ? { ...prunedProps, screenRoutes }
    : prunedProps
  // Element animations (AGL-2486). Derived from the PRUNED node map, so a
  // deferred tab panel's animations don't drag the stylesheet onto a page that
  // is not shipping them; the runtime re-scans on mutation, so a panel opened
  // later still animates if anything else on the page armed the runtime.
  //
  // Both tags are withheld when nothing animates — which is the point. There
  // is no animation library on a published page at all: these are CSS
  // keyframes plus, only when a scroll trigger is present, ~700 bytes of
  // inline IntersectionObserver. See the module for the full reasoning.
  const animation = pageAnimationAssets(clientProps.nodes)
  return (
    <>
      {animation ? (
        <style
          id={ELEMENT_ANIMATION_STYLE_ID}
          // A build-time constant of our own; no author input reaches it.
          dangerouslySetInnerHTML={{ __html: animation.styleText }}
        />
      ) : null}
      {animation?.scriptText ? (
        // Not `next/script`: this must run before hydration and costs no
        // request inline. The tenant sends no `script-src` (AGL-1228), so no
        // nonce is involved.
        <script dangerouslySetInnerHTML={{ __html: animation.scriptText }} />
      ) : null}
      {jsonLd.map((json, index) => (
        <script
          key={index}
          type="application/ld+json"
          // Server-rendered structured data. Built from editor-authored
          // host/screen fields, so it MUST use safeJsonLd (not JSON.stringify)
          // — the latter leaves `</script>` intact and breaks out (AGL-496).
          dangerouslySetInnerHTML={{ __html: json }}
        />
      ))}
      {/* Measurement and consent, mounted ABOVE the plugin gate (AGL-1550).
          A sibling of `CatchAllClient`, never a descendant: the pageview
          beacon, the GA mounts and the consent machinery need a host and a
          screen id and nothing else — no plugin, no canvas, no observable —
          and living under the gate is what let AGL-1541 silence all three at
          once. This is the ErrorBeacon shape (AGL-1538) one level down, at
          the first point that knows which host and screen it is measuring.

          `result.props.data.host` is the SAME object `CatchAllClient`
          receives below, so Flight serializes it once and this costs no
          payload. Rendered FIRST so it hydrates before the page body.

          NO `nonce` is handed down, and it cannot be from here (AGL-2640).
          `SiteAnalytics` accepts one so its inline boots are ready for a
          nonce'd `script-src`, but this page is ISR-cached: `headers()` in
          it would opt every tenant page out of the cache, and a per-request
          value cannot match cached bytes anyway — the AGL-1228 finding that
          is why the tenant sends no `script-src` at all. The day that policy
          ships, it ships with a way to read its nonce here; until then the
          prop stays unset and nothing on this surface refuses an unnonced
          script. */}
      <SiteAnalytics
        host={result.props.data?.host as any}
        screenId={(result.props.data?.screen?.data as any)?.$id}
      />
      {/* The client suspends until the org-enabled site plugins register
          (AGL-417). Deliberately NO Suspense boundary here (AGL-1541): with
          one, the plugin-gate suspension pushed the ENTIRE page out of the
          streamed shell into a late `<div hidden id="S:0">` segment whose
          reveal — and React's hydration retry for the boundary — both ride
          on `requestAnimationFrame` in the Fizz runtime. rAF is not
          guaranteed to fire (hidden, occluded, or prerendered tabs), so
          those visitors got a page that never hydrated: no analytics, no
          consent surface, dead forms. Without the boundary a cold render
          blocks the shell for the plugin imports (~100ms, once per server
          process — ISR caches the result), every render ships the full HTML
          inline, and client hydration retries ride the normal scheduler,
          which runs everywhere. The ensure promise is status-stamped
          (plugin-loader.ts), so warm renders don't suspend at all.

          The ERROR boundary below is not that boundary and does not bring
          any of it back (AGL-1556): it never intercepts suspension, so the
          gate still blocks the shell exactly as described above. What it
          confines is a gate that THROWS — a plugin chunk 404ing under a
          visitor holding pre-deploy HTML — which without it escapes the
          whole root and takes `SiteAnalytics` and Next's global error
          boundary (i.e. the root layout, `ErrorBeacon` included) with it. */}
      <PageBodyBoundary>
        <CatchAllClient {...clientProps} />
      </PageBodyBoundary>
    </>
  )
}
