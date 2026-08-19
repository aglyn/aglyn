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

import * as Aglyn from '@aglyn/aglyn/server'
import {
  filterEnabledPluginsByReleaseFlags,
  firebaseAdmin,
  getPlatformLockdown,
  getRealmPluginInstalls,
} from '@aglyn/tenant-data-admin'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
} from '@aglyn/tenant-runtime/compose-collection-page'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import getTemplateScreenIds from '@aglyn/tenant-runtime/template-screens'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import getVariables from '@aglyn/tenant-runtime/get-variables'
import { requiredSitePlugins } from '@aglyn/tenant-runtime/required-site-plugins'
import { cache } from 'react'
import { serverPluginLoader } from '../../../utils/server-plugin-loader'
import getHost, { CNAME_HOST_PREFIX } from '../../../utils/get-host'
import getOrgBilling from '../../../utils/get-org-billing'
import { startRenderTimer } from '../../../utils/render-timings'
import type { LoadResult, Props } from './types'

/**
 * The composition body — the former `getStaticProps` verbatim (AGL-398): host
 * and screen resolution, redirects, collections, protected/member gating,
 * overlays, experiments, automations and SEO. Returns the same
 * `{ props | notFound | redirect }` shapes; the page maps them to
 * `notFound()` / `redirect()` / render.
 *
 * Keyed on PRIMITIVES so `cache` can actually dedupe (AGL-1152).
 *
 * `cache()` keys on argument IDENTITY, not structure. The previous signature
 * took `slug: string[]`, and both call sites pass `slug ?? []` — a fresh array
 * literal per call — so `generateMetadata` and the page component never shared
 * a cache entry and every tenant render ran this whole function TWICE,
 * concurrently. Production timing lines showed the pair 1 ms apart, each paying
 * every Firestore round trip in full.
 *
 * That doubling is what pushed a cold render past the 10 s function limit and
 * turned the first request after a deploy into a 502. Keying on a JSON string
 * makes the two calls collide on one entry; JSON round-tripping is lossless for
 * a string array, so a segment containing `/` survives (a plain `join`/`split`
 * would not).
 */
/**
 * `blockingPlugins` for one exit path (AGL-1289), or nothing when no narrowing
 * was safe — in which case the client blocks on the whole enabled list, as it
 * always did.
 *
 * A helper because the loader has several exits that render nodes, and each
 * has to answer this for itself. Collection and auth-screen pages pass no
 * enrichment at all, and that is correct rather than lazy: those branches
 * return before `runSitePageEnrichers`, so no plugin contributed anything to
 * them and only their nodes can require one.
 */
const blockingPluginsFor = (
  nodes: Record<string, any> | null | undefined,
  enabledPlugins: string[] | undefined,
  enrichment?: { contributors: string[]; unattributed: boolean },
): { blockingPlugins?: string[] } => {
  const blockingPlugins = requiredSitePlugins({
    nodes,
    contributors: enrichment?.contributors,
    unattributed: enrichment?.unattributed,
    enabledPlugins,
  })
  return blockingPlugins ? { blockingPlugins } : {}
}

const loadPageDataCached = cache(
  async (hostParam: string, slugKey: string): Promise<LoadResult> => {
    const slug = JSON.parse(slugKey) as string[]
    const context = { params: { host: hostParam, slug } }

  // AGL-1152: one structured timing line per render, reported in `finally` so
  // every exit path (404, redirect, maintenance, throw) is measured, not just
  // the happy one.
  const timer = startRenderTimer()

  try {
    const { params } = context
    // Root of the optional catch-all: the App Router page passes `slug ?? []`,
    // so the home page arrives as an EMPTY ARRAY (not undefined). An empty
    // array is truthy, so the old `slug || ['/']` guard left `path` as `''`
    // and the `'/'` routing-map entry never matched — every home page 404'd.
    // Collapse an empty (or missing) slug to the root path explicitly.
    const slugSegments = (params.slug ?? []) as string[]
    const path = slugSegments.length
      ? slugSegments.join('/')
      : Aglyn.SCREEN_ROOT_PATH
    const host = (params.host || 'tenant') as string

    /*==========================================
     *
     * MARK - GET HOST
     *
     *=========================================*/

    const hostRes = await getHost({ host })
    timer.mark('getHost')

    if (hostRes.error || !hostRes.host) {
      return {
        notFound: true,
        revalidate: 60, // never=false, always=1, since=SECONDS
      }
    }

    /*==========================================
     *
     * MARK - CANONICAL ORIGIN
     *
     *=========================================*/

    // One site, one address (AGL-1272). A host with a live custom domain was
    // serving byte-identical HTML at BOTH that domain and `{sub}.aglyn.app`,
    // so search engines indexed two copies and split the ranking signal
    // between them — with no say in which one they'd elect canonical.
    //
    // Hooked HERE, immediately after `getHost`, for two reasons. It is the
    // first point where the answer is knowable, and it is knowable at zero
    // cost: `hostRes.host` is already in hand, so the whole decision is field
    // reads on a document this render had to load anyway. No round trip is
    // added to the cold-start budget (AGL-1152) — the redirecting render in
    // fact does strictly LESS work than before, returning before org billing,
    // the plugin loader and screen composition. Middleware is the other
    // obvious home and is where an origin redirect normally belongs, but the
    // edge runtime cannot reach Firestore (it is why the `cname--` sentinel
    // exists at all), so putting it there would mean a per-request lookup on
    // the single hottest path in the product to answer a question that is
    // free right here.
    //
    // Three independent guards, each of which is an outage if it is wrong:
    //
    //  1. THE LOOP GUARD. A request that arrived ON the custom domain reaches
    //     this loader as `cname--{hostname}` (the middleware sentinel), and
    //     must render. Without this the custom domain redirects to itself and
    //     the site is gone — not degraded, gone, and gone in exactly the case
    //     where the customer has the most to lose. Testing the REQUESTED host
    //     rather than comparing hostnames is what makes it airtight: the
    //     sentinel is assigned by the one branch of middleware that handles
    //     custom domains, so it cannot disagree with itself.
    //
    //  2. THE LIVENESS GUARD. `liveCustomDomain` refuses a domain that is
    //     merely claimed — see its own reasoning. "Has a cname" is NOT the
    //     same question as "that cname serves".
    //
    //  3. THE DEPLOYMENT GUARD. Only the production deployment redirects.
    //     Preview and branch deployments, `*.vercel.app` and local dev all
    //     resolve their tenant host from `?tenantHost=`/`AGLYN_TENANT_DEMO`,
    //     which yields a BARE subdomain — indistinguishable here from a real
    //     `{sub}.aglyn.app` request, because both deliberately share one ISR
    //     entry. Rather than split that cache to tell them apart, refuse to
    //     redirect anywhere but production: a preview that bounced reviewers
    //     onto the customer's live site would be useless, and a dev machine
    //     that did it would be baffling.
    const canonicalDomain = Aglyn.liveCustomDomain(hostRes.host)
    if (
      canonicalDomain &&
      !host.startsWith(CNAME_HOST_PREFIX) &&
      // Any PRODUCTION deployment, not Vercel's alone (AGL-2180). Gated on
      // `VERCEL_ENV === 'production'`, this never fired on a self-host
      // container, so every site was served at BOTH its platform subdomain and
      // its connected custom domain — the split-ranking outcome our own docs
      // warn about, on the deployment shape that had no way to avoid it.
      //
      // Production specifically, not `isDeployedRuntime`: the comment above
      // explains why a preview must not redirect, and the broader predicate
      // would have started bouncing reviewers onto customers' live sites.
      Aglyn.isProductionDeployment()
    ) {
      // Path preserved segment by segment, re-encoded: `params` arrives
      // URL-decoded, and a decoded segment goes straight into a `Location`
      // header. Encoding keeps a slug carrying `/`, `?` or a control
      // character from rewriting the destination it is supposed to be part of.
      const destinationPath = slugSegments.length
        ? `/${slugSegments.map(encodeURIComponent).join('/')}`
        : '/'
      return {
        redirect: {
          destination: `https://${canonicalDomain}${destinationPath}`,
          // 307, NOT 301/308 — and the difference is the customer's site.
          //
          // 301/308 is the stronger consolidation signal, and it is also
          // cacheable by default (RFC 9110 §15.4.2/§15.4.9): a browser that
          // sees one may never ask us again. We have no way to take that
          // back. Custom domains are disconnected routinely (AGL-742) and
          // domains lapse, so a permanent redirect would pin returning
          // visitors to a name the customer no longer controls — possibly one
          // somebody else now owns — with the platform origin that still
          // works sitting right there, unreachable.
          //
          // 307 is not cacheable unless a response says so (§15.4.8), so the
          // moment `cname` is cleared the redirect stops: the ISR entry
          // rebuilds within `revalidate` and every visitor re-asks. Nothing
          // in this codebase can invalidate an already-cached redirect —
          // checked — so "revocable" has to come from the status code itself.
          //
          // The SEO cost is smaller than it looks. Google follows and
          // consolidates a consistently-served temporary redirect; and the
          // signal that actually elects a canonical here is the
          // self-referential `<link rel="canonical">` the destination emits
          // (`hostPublicOrigin`, same field, same answer). The redirect
          // removes the duplicate from circulation; the tag names the winner.
          statusCode: 307,
        },
        revalidate: 30,
      }
    }

    /*==========================================
     *
     * MARK - FIND SCREEN ID FROM SLUG
     *
     *=========================================*/

    const hostId = hostRes.host.$id
    const pathsByScreenId = hostRes.host.screens || {}

    // Template screens are not pages (AGL-1267, and commerce's PDP/catalog
    // templates since AGL-1270). Started HERE, unawaited, and collected at the
    // routing decision below: by then this render has already awaited org
    // billing, the plugin loader and the redirect resolver, so the round trip
    // overlaps work the page pays for anyway rather than adding one to the
    // critical path (AGL-1152). Widening it to the store templates added a
    // second Firestore RPC but no second round trip — the two reads are issued
    // concurrently inside. `getTemplateScreenIds` never rejects, so a floating
    // promise here cannot become an unhandled rejection.
    const templateScreenIdsPromise = getTemplateScreenIds({ hostId })

    // Lockdown (AGL-1501, superset of the AGL-202 org-suspension branch):
    // platform, org and host scopes resolved through the one shared
    // resolver, with the sanitized notice carried in props so the fallback
    // UI can say WHY. Defence in depth — the middleware's request-level
    // verdict (which runs before the ISR cache) is the primary gate; this
    // branch is what keeps a freshly-REGENERATED page honest, and it still
    // covers any path that reaches the loader without the middleware. The
    // org doc is loaded once here and reused by the branding/overlay
    // branches below, as before.
    const orgRes = await getOrgBilling({ hostId })
    timer.mark('getOrgBilling')
    const lockdownState = Aglyn.resolveLockdown(
      {
        platform: await getPlatformLockdown(),
        org: Aglyn.normalizeOrgLockdown(orgRes.org as any),
        host: Aglyn.normalizeHostLockdown(hostRes.host as any),
      },
      Date.now(),
    )
    // READ-ONLY (AGL-1511) renders the page normally. A read-only lock is a
    // WRITE freeze; replacing the page with the maintenance fallback here
    // would undo the middleware's decision one layer down and take the site
    // off the air anyway — the exact outcome the mode exists to avoid. The
    // site's write endpoints refuse on their own path.
    if (lockdownState && !Aglyn.isReadOnlyLockdown(lockdownState)) {
      const notice = Aglyn.lockdownNotice(lockdownState)
      return {
        props: JSON.parse(
          JSON.stringify({
            data: { host: hostRes.host },
            nodes: null,
            maintenanceFallback: true,
            lockdown: {
              reason: lockdownState.reason,
              title: notice.title,
              message: notice.body,
              ...(notice.contact ? { contact: notice.contact } : {}),
              ...(typeof lockdownState.untilMs === 'number'
                ? { untilMs: lockdownState.untilMs }
                : {}),
            },
          }),
        ),
        revalidate: 30,
      }
    }

    // Bandwidth abuse ceiling (AGL-2155) — the free tier's missing brace.
    //
    // COSTS THIS PATH ZERO EXTRA READS, and that is the whole reason the flag
    // has the shape it does. `hostRes.host` is already in hand (the redirect,
    // screen-directory and lockdown branches above all read it), so the
    // containment is a field test on a document this render already paid for.
    // The alternative — reading a page-view counter before every render — is
    // the objection that kept this hole open, and it is answered by
    // evaluating the ceiling where the counter is WRITTEN
    // (`/api/analytics/collect`) and reading only the verdict here.
    //
    // Placed after lockdown and before maintenance: a staff takedown outranks
    // a billing containment, and a contained site must not be able to look
    // like it is merely under maintenance.
    //
    // Only `degraded` trips serve this — a metered plan's overage bills, so
    // its ceiling flags and escalates without changing what a visitor gets.
    // Month-scoped, so this clears itself on the 1st with no write and no
    // staff action.
    if (
      Aglyn.bandwidthCeilingDegradesHost(
        hostRes.host as any,
        Aglyn.bandwidthCeilingMonthKey(),
      )
    ) {
      const notice = Aglyn.bandwidthCeilingNotice()
      return {
        props: JSON.parse(
          JSON.stringify({
            data: { host: hostRes.host },
            nodes: null,
            maintenanceFallback: true,
            // Reuses the notice slot the lockdown branch renders through
            // (`catch-all-client`), with its own reason code so a contained
            // site is distinguishable from a takedown by anything reading
            // props. Deliberately NOT a `LockdownReasonCode`: lockdown is a
            // staff action, this is arithmetic on a counter.
            lockdown: {
              reason: Aglyn.BANDWIDTH_CEILING_CODE,
              title: notice.title,
              message: notice.body,
            },
          }),
        ),
        // Shorter than the lockdown branch's 30s would gain nothing: the
        // containment lasts until the month ends or the owner upgrades, and
        // an upgrade already revalidates. 60s bounds how long a cleared flag
        // keeps serving the notice.
        revalidate: 60,
      }
    }

    // Maintenance mode (AGL-131): every path renders the assigned 503
    // screen (noindex) or a built-in notice; short revalidate so flipping
    // the toggle recovers quickly.
    if ((hostRes.host as any)?.maintenance) {
      const unavailableId = (hostRes.host as any)?.errorScreens?.unavailable
      if (unavailableId) {
        const unavailable = await getScreen({
          hostId,
          screenId: unavailableId,
        })
        if (unavailable.screen) {
          const unavailableNodes = await composeScreenNodes({
            host: hostRes.host as any,
            hostId,
            screenId: unavailableId,
            screen: unavailable.screen,
          })
          if (unavailableNodes) {
            return {
              props: JSON.parse(
                JSON.stringify({
                  data: {
                    host: hostRes.host,
                    screen: { data: unavailable.screen },
                  },
                  nodes: unavailableNodes,
                  maintenanceFallback: true,
                }),
              ),
              revalidate: 30,
            }
          }
        }
      }
      return {
        props: JSON.parse(
          JSON.stringify({
            data: { host: hostRes.host },
            nodes: null,
            maintenanceFallback: true,
          }),
        ),
        revalidate: 30,
      }
    }

    // Plugin site-page hooks (AGL-417/418) register through the tenant
    // server manifest; ensure they're loaded before any hook runs.
    await serverPluginLoader.ensureAll(['tenantApi'])
    // Was suspect #1 for the cold-start cost; MEASURED AND CLEARED (AGL-1152).
    // Production timing lines put this at 0–45 ms on the very first render of a
    // fresh instance, against a 2–5 s total. It is not the cold-start cost, so
    // do not remove it on that theory — the API dispatcher needs it.
    timer.mark('ensureAll')

    // Redirect rules (AGL-155) fire before any route resolution, so a
    // rule can move even a published screen (plugins-redirects' resolver;
    // ISR-cached with a 30s revalidate, hit counts sampled).
    const redirectRule = await Aglyn.resolveSiteRedirect({
      hostId,
      host: hostRes.host,
      org: orgRes.org,
      path,
      slugSegments: [...(slug ?? [])],
    })
    timer.mark('resolveSiteRedirect')
    if (redirectRule) {
      return {
        redirect: {
          destination: redirectRule.destination,
          statusCode: redirectRule.statusCode,
        },
        revalidate: 30,
      }
    }

    // Membership routes (AGL-109): fixed sign-in/up surfaces per site,
    // plus /recover for password recovery (AGL-552).
    if (path === 'signin' || path === 'signup' || path === 'recover') {
      // Designable auth screens (AGL-553): a host can designate a
      // besigner-built screen per auth route (host doc `authScreens`, set
      // from Setup like `errorScreens`); it renders through the normal
      // composition pipeline (theme + shared layout + nodes). Fallback =
      // the built-in forms below.
      const authScreens = (hostRes.host as any)?.authScreens ?? {}
      const designatedScreenId =
        path === 'signin'
          ? authScreens.signinScreenId
          : path === 'signup'
            ? authScreens.signupScreenId
            : authScreens.recoveryScreenId
      if (designatedScreenId) {
        const designated = await getScreen({
          hostId,
          screenId: designatedScreenId,
        })
        if (designated.screen) {
          const designatedNodes = await composeScreenNodes({
            host: hostRes.host as any,
            hostId,
            screenId: designatedScreenId,
            screen: designated.screen,
          })
          if (designatedNodes) {
            // The member auth blocks live in the commerce plugin, so the
            // client needs the real enabled-plugin set (same gate as the
            // published-screen path below).
            const authEnabledPlugins =
              await filterEnabledPluginsByReleaseFlags(
                // Per-site enablement (AGL-1014): org set minus this host's deny-list.
              Aglyn.resolveHostEnabledPlugins(
                orgRes.org as never,
                hostRes.host as never,
              ),
                {
                  orgId: (orgRes.org as { $id?: string })?.$id ?? null,
                },
              )
            return {
              props: JSON.parse(
                JSON.stringify({
                  data: {
                    host: hostRes.host,
                    screen: { data: designated.screen },
                  },
                  nodes: designatedNodes,
                  membershipPage: path,
                  enabledPlugins: authEnabledPlugins,
                  ...blockingPluginsFor(designatedNodes, authEnabledPlugins),
                  showBranding: !Aglyn.resolveOrgEntitlements(orgRes.org)
                    .features.removeBranding,
                }),
              ),
              revalidate: 60,
            }
          }
        }
      }
      return {
        props: JSON.parse(
          JSON.stringify({
            data: { host: hostRes.host },
            nodes: null,
            membershipPage: path,
          }),
        ),
        revalidate: 60,
      }
    }
    const routedScreenEntry = Object.entries(pathsByScreenId).find(
      ([, slug]) => {
        return slug === path
      },
    )

    // A template screen is NOT a page of this site (AGL-1267 for a content
    // collection's list/entry screens; AGL-1270 for commerce's `pdpScreenId`
    // and `collectionScreenId`, which live on `settings/store`). Publishing one
    // is how the compose pipeline picks it up, but publishing also writes its
    // id into the host's routing map, so the template became reachable at its
    // own slug and rendered its `{{entry.*}}` / `{{product.*}}` tokens raw —
    // there is no routed subject to substitute.
    //
    // Dropped from the routing map rather than 404'd outright, so the request
    // continues down the normal non-screen chain (plugin resolvers → content
    // collections → custom 404 → 404). That is what preserves the legitimate
    // cases: a LIST template published at its own collection's root (`/blog`
    // for the `blog` collection) is picked up two branches down by
    // `composeCollectionTemplatePage`, which renders the same screen WITH the
    // entries and `{{collection.*}}` tokens it needs; and a store template
    // published at a real catalog route falls through to the commerce resolver
    // one branch down, which renders it WITH the product or collection. The
    // entry template has no such branch and correctly 404s.
    const templateScreenIds = await templateScreenIdsPromise
    timer.mark('collectionTemplateScreens')
    const screenEntry =
      routedScreenEntry && templateScreenIds.has(routedScreenEntry[0])
        ? undefined
        : routedScreenEntry

    if (!Array.isArray(screenEntry)) {
      // Plugin page resolvers (AGL-418): commerce composes PDP/PLP
      // template pages for /products/* and /collections/* — first
      // non-undefined answer is the page.
      const resolved = await Aglyn.resolveSitePage({
        hostId,
        host: hostRes.host,
        org: orgRes.org,
        path,
        slugSegments: [...(slug ?? [])],
      })
      if (resolved) return resolved as never

      // Content collections fallback (AGL-81): /{collection},
      // /{collection}/{entry}, the paginated list /{collection}/page/{n}
      // (AGL-620) and the category-filtered list
      // /{collection}/category/{slug}[/page/{n}] (AGL-1321). The shapes live
      // in one pure parser so the loader and its tests cannot disagree about
      // what the route table is.
      //
      // Category is a PATH SEGMENT, not `?category=`, and the reason is this
      // very function: it is ISR-cached per URL PATH, and a query string is
      // not part of that key — `/blog?category=product` and
      // `/blog?category=guides` would share one cache entry and serve
      // whichever category happened to render first to everybody. Reading
      // `searchParams` at all would opt the entire tenant catch-all out of
      // static rendering, which is the opposite of AGL-1152's whole point.
      const segments = path.split('/').filter(Boolean)
      const route = Aglyn.parseCollectionRoute(segments)
      if (route) {
        const entrySlug = route.entrySlug
        const isList = !entrySlug
        const page = route.page
        const content = await getCollectionContent({
          hostId,
          collectionSlug: route.collectionSlug,
          entrySlug,
          ...(isList
            ? {
                page,
                perPage: Aglyn.COLLECTION_LIST_PAGE_SIZE,
                ...(route.categorySlug
                  ? { categorySlug: route.categorySlug }
                  : {}),
              }
            : {}),
        })
        // A paged list beyond the last page 404s (page 1 always renders).
        const pageInRange =
          !content.pagination || page <= content.pagination.totalPages
        if (content.collection && (isList ? pageInRange : content.entry)) {
          // Collection pages are first-class designed pages (AGL-551): both
          // routes carry the same plugin switchboard + branding flag as
          // published screens so shared-layout chrome renders faithfully.
          const collectionEnabledPlugins =
            await filterEnabledPluginsByReleaseFlags(
              // Per-site enablement (AGL-1014): org set minus this host's deny-list.
              Aglyn.resolveHostEnabledPlugins(
                orgRes.org as never,
                hostRes.host as never,
              ),
              {
                orgId: (orgRes.org as { $id?: string })?.$id ?? null,
              },
            )
          const collectionShowBranding = !Aglyn.resolveOrgEntitlements(
            orgRes.org,
          ).features.removeBranding

          // Template screens (AGL-105/551): the collection's designated
          // list/entry screens render through the NORMAL published pipeline
          // — theme, shared layout, {{entry.*}}/{{collection.*}} tokens,
          // Collection entries blocks — mirroring commerce PDP templates.
          const templated = await composeCollectionTemplatePage({
            hostId,
            content,
          })
          if (templated) {
            return {
              props: JSON.parse(
                JSON.stringify({
                  data: {
                    host: hostRes.host,
                    screen: { data: templated.screen },
                  },
                  nodes: templated.nodes,
                  // Entry JSON-LD + metadata read this (the client renders
                  // the composed nodes because they are present).
                  content,
                  enabledPlugins: collectionEnabledPlugins,
                  ...blockingPluginsFor(
                    templated.nodes,
                    collectionEnabledPlugins,
                  ),
                  showBranding: collectionShowBranding,
                }),
              ),
              revalidate: 60,
            }
          }

          // No template designated: the designed built-in still composes
          // through the site theme + the host's default shared layout
          // (AGL-551). Only if that fails does the legacy plain article
          // render (nodes: null).
          const fallback = await composeCollectionFallbackPage({
            hostId,
            host: hostRes.host,
            content,
          })
          return {
            props: JSON.parse(
              JSON.stringify({
                data: { host: hostRes.host },
                nodes: fallback?.nodes ?? null,
                content,
                ...(fallback
                  ? {
                      enabledPlugins: collectionEnabledPlugins,
                      ...blockingPluginsFor(
                        fallback.nodes,
                        collectionEnabledPlugins,
                      ),
                      showBranding: collectionShowBranding,
                    }
                  : {}),
              }),
            ),
            revalidate: 60,
          }
        }
      }
      // Custom not-found screen (AGL-87): render the designated screen's
      // content with noindex — SSG can't emit a real 404 status for
      // dynamic content, so noindex keeps soft-404s out of search.
      const notFoundScreenId =
        (hostRes.host as any)?.errorScreens?.notFound ??
        (hostRes.host as any)?.notFoundScreenId
      if (notFoundScreenId) {
        const fallbackScreen = await getScreen({
          hostId,
          screenId: notFoundScreenId,
        })
        if (fallbackScreen.screen) {
          const fallbackNodes = await composeScreenNodes({
            host: hostRes.host as any,
            hostId,
            screenId: notFoundScreenId,
            screen: fallbackScreen.screen,
          })
          if (fallbackNodes) {
            return {
              props: JSON.parse(
                JSON.stringify({
                  data: {
                    host: hostRes.host,
                    screen: { data: fallbackScreen.screen },
                  },
                  nodes: fallbackNodes,
                  notFoundFallback: true,
                }),
              ),
              revalidate: 60,
            }
          }
        }
      }
      return {
        notFound: true,
        revalidate: 60, // never=false, always=1, since=SECONDS
      }
    }

    /*==========================================
     *
     * MARK - GET SCREEN
     *
     *=========================================*/

    const screenId = screenEntry[0]
    const screenRes = await getScreen({ hostId, screenId })
    timer.mark('getScreen')

    if (screenRes.error || !screenRes.screen) {
      return {
        notFound: true,
        revalidate: 60, // never=false, always=1, since=SECONDS
      }
    }

    /*==========================================
     *
     * MARK - GET SCREEN VERSION
     *
     *=========================================*/

    // Password protection (AGL-87): never embed a protected screen's nodes
    // in the static HTML — the client unlocks via /api/protection/unlock.
    const protection = (screenRes.screen as any)?.protection
    if (protection?.passwordHash) {
      return {
        props: JSON.parse(
          JSON.stringify({
            data: {
              host: hostRes.host,
              screen: { data: { ...screenRes.screen, protection: null } },
            },
            nodes: null,
            protectedScreen: true,
            showBranding:
              !Aglyn.resolveOrgEntitlements(orgRes.org).features
                .removeBranding,
          }),
        ),
        revalidate: 60,
      }
    }

    // Members-only screens (AGL-109): like protected screens, the nodes
    // never ship in static HTML — the client fetches them with its member
    // session via /api/membership/content.
    if (
      (screenRes.screen as any)?.visibility ===
      Aglyn.HostScreenVisibility.AUTHENTICATED
    ) {
      // Assigned 401 screen (AGL-131): pre-composed so a signed-out
      // visitor sees the designed page instead of the built-in prompt.
      const unauthorizedId = (hostRes.host as any)?.errorScreens?.unauthorized
      let unauthorizedNodes: Record<string, any> | null = null
      if (unauthorizedId) {
        const unauthorized = await getScreen({
          hostId,
          screenId: unauthorizedId,
        })
        if (unauthorized.screen) {
          unauthorizedNodes = await composeScreenNodes({
            host: hostRes.host as any,
            hostId,
            screenId: unauthorizedId,
            screen: unauthorized.screen,
          })
        }
      }
      return {
        props: JSON.parse(
          JSON.stringify({
            data: {
              host: hostRes.host,
              screen: { data: { ...screenRes.screen, protection: null } },
            },
            nodes: null,
            memberScreen: true,
            unauthorizedNodes,
          }),
        ),
        revalidate: 60,
      }
    }

    /**
     * The two plugin lookups, STARTED here and collected after composition
     * (AGL-1225).
     *
     * Both were awaited at the very end of the loader, one after the other,
     * and neither ever looked at anything composition produces:
     * `getRealmPluginInstalls` takes `hostId` and nothing else, and the
     * release gate takes the org and host documents. Every input has been in
     * hand since `getOrgBilling`, so the awaits were pure tail latency —
     * measured at 539 ms and 0–611 ms respectively on a cache-MISS render of
     * `/product/besigner`, against a 2210 ms total.
     *
     * Issued here rather than at the top of the loader on purpose. Every exit
     * above this line — 404, redirect, maintenance, the auth screens, a
     * protected or members-only screen — returns without either value, and
     * starting these earlier would spend Firestore reads on paths that throw
     * them away. This is the first point where the render is committed to
     * producing a full page, so it is the earliest launch that costs nothing
     * extra (AGL-1302 is exactly the read-amplification lesson).
     *
     * `composeScreenNodes` + `runSitePageEnrichers` measured ~1158 ms between
     * here and the collection point, so the slower of the two lookups hides
     * inside that window completely.
     */
    const realmPluginsPromise = getRealmPluginInstalls({ hostId }).catch(
      (error) => {
        console.error('realm plugin lookup failed:', error)
        return []
      },
    )
    const enabledPluginsPromise = filterEnabledPluginsByReleaseFlags(
      // Per-site enablement (AGL-1014): org set minus this host's deny-list.
      Aglyn.resolveHostEnabledPlugins(
        orgRes.org as never,
        hostRes.host as never,
      ),
      {
        orgId: (orgRes.org as { $id?: string })?.$id ?? null,
      },
    )
    // The release gate keeps its original failure semantics — a throw still
    // reaches the outer catch and 404s — but it is no longer awaited on the
    // next line, so a rejection would sit unhandled across several macrotasks
    // of composition and could surface as an `unhandledRejection` before the
    // `await` below ever sees it. This marks it handled without consuming it.
    enabledPluginsPromise.catch(() => undefined)

    const denormalized = await composeScreenNodes({
      host: hostRes.host as any,
      hostId,
      screenId,
      screen: screenRes.screen,
    })
    timer.mark('composeScreenNodes')
    if (!denormalized) {
      return {
        notFound: true,
        revalidate: 60, // never=false, always=1, since=SECONDS
      }
    }

    // Free-tier branding (AGL-69/247): plan-less orgs resolve as free and
    // show the badge; only plans with removeBranding drop it.
    const showBranding = !Aglyn.resolveOrgEntitlements(orgRes.org)
      .features.removeBranding

    // White-label brand (White-Label Phase 1): the org's agency brand when
    // the `whiteLabel` entitlement is present, else the Aglyn defaults. The
    // client reads this to render the agency brand where it currently shows
    // Aglyn; resolved through the one shared resolver so it can't drift.
    const branding = Aglyn.resolveBrandingProfile(orgRes.org)

    // Multilingual (AGL-471): locale variants are a Business+ entitlement.
    // Strip them at serve time — the console gate alone doesn't stop
    // variants written directly to Firestore from serving (hreflang
    // alternates and the client locale switcher both read this payload).
    if (
      (screenRes.screen as any)?.localeVariants &&
      !Aglyn.checkEntitlement(orgRes.org, 'multilingual')
    ) {
      screenRes.screen = {
        ...(screenRes.screen as any),
        localeVariants: null,
      }
    }

    // Plugin page enrichers (AGL-418): marketing contributes overlays
    // (announcement bar/popup), site-event automations, and experiments —
    // all entitlement-gated inside the plugin, shapes unchanged.
    const enriched = await Aglyn.runSitePageEnrichers({
      hostId,
      host: hostRes.host,
      org: orgRes.org,
      path,
      slugSegments: [...(slug ?? [])],
      screenId,
      screen: screenRes.screen,
      // Composed nodes (AGL-659): commerce walks them to seed each product
      // grid's first page into `pageData`, so /products server-renders its
      // catalog instead of a skeleton.
      nodes: denormalized,
    })
    timer.mark('runSitePageEnrichers')

    // Trusted-realm marketplace plugins (AGL-420): the workspace's install
    // pins joined server-side with the staff-only trust grants; the client
    // loads them post-hydration. Fail-open to none — a lookup error can't
    // take the page down. Issued before composition (AGL-1225); by here it
    // has almost always already resolved, so this phase now reads ~0.
    const realmPlugins = await realmPluginsPromise
    timer.mark('getRealmPluginInstalls')

    // Plugin release gate (AGL-422): flagged-off plugins vanish from the
    // published site too — the platform kill switch. Subject = the org, so
    // rollout verdicts match the console's. Site visitors get no staff
    // bypass; fail-open inside falls back to registry defaults.
    const enabledPlugins = await enabledPluginsPromise
    timer.mark('filterEnabledPluginsByReleaseFlags')

    const props = {
      data: JSON.parse(
        JSON.stringify({
          host: hostRes.host,
          // Version nodes ride in `nodes` (composed inside
          // composeScreenNodes since AGL-87); nothing reads a version prop.
          screen: {
            data: screenRes.screen,
          },
        }),
      ),
      nodes: denormalized,
      // Plugin switchboard (AGL-416/417/422): which site plugins the
      // client loads before rendering the canvas — org-enabled minus
      // release-flagged-off.
      enabledPlugins,
      ...(realmPlugins.length ? { realmPlugins } : {}),
      showBranding,
      branding,
      ...enriched.props,
      // The full composed document, before the AGL-1285 prune in `page.tsx`:
      // a component inside a withheld panel still belongs to this page.
      ...blockingPluginsFor(denormalized, enabledPlugins, enriched),
    }

    return {
      props: props,
      revalidate: 60, // never=false, always=1, since=SECONDS
    }
  } catch (e) {
    console.error(e)
    return {
      // props: {},
      notFound: true,
      revalidate: 60,
    }
  } finally {
    timer.report({ host: hostParam, path: (slug ?? []).join('/') || '/' })
  }
  },
)

/**
 * Server data loader for the catch-all tenant render (AGL-398). Thin, uncached
 * wrapper that normalises the slug into a primitive cache key — see
 * `loadPageDataCached` for why the key cannot be the array itself.
 */
export const loadPageData = (
  hostParam: string,
  slug: string[],
): Promise<LoadResult> => loadPageDataCached(hostParam, JSON.stringify(slug))
