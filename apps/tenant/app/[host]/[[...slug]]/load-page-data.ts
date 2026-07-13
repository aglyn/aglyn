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
  getRealmPluginInstalls,
} from '@aglyn/tenant-data-admin'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import getVariables from '@aglyn/tenant-runtime/get-variables'
import { cache } from 'react'
import { serverPluginLoader } from '../../../utils/server-plugin-loader'
import getCollectionContent from '../../../utils/get-collection-content'
import getHost from '../../../utils/get-host'
import getOrgBilling from '../../../utils/get-org-billing'
import type { LoadResult, Props } from './types'

/**
 * Server data loader for the catch-all tenant render (AGL-398). This is the
 * former `getStaticProps` body verbatim — same host/screen resolution,
 * redirects, collections, protected/member gating, overlays, experiments,
 * automations, and SEO composition — wrapped so the App Router page and its
 * `generateMetadata` share one `cache`d call per request. Returns the same
 * `{ props | notFound | redirect }` shapes; the page maps them to
 * `notFound()` / `redirect()` / render.
 */
export const loadPageData = cache(
  async (hostParam: string, slug: string[]): Promise<LoadResult> => {
    const context = { params: { host: hostParam, slug } }
  console.debug('!!!!!getStaticProps', context)

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
    console.debug('hostRes', hostRes, params)

    if (hostRes.error || !hostRes.host) {
      return {
        notFound: true,
        revalidate: 60, // never=false, always=1, since=SECONDS
      }
    }

    /*==========================================
     *
     * MARK - FIND SCREEN ID FROM SLUG
     *
     *=========================================*/

    const hostId = hostRes.host.$id
    const pathsByScreenId = hostRes.host.screens || {}

    // Org suspension (AGL-202/238): staff-suspended orgs stop serving
    // every path immediately (short revalidate bounds the lag). Loaded
    // once here and reused by the branding/overlay branches below.
    const orgRes = await getOrgBilling({ hostId })
    if ((orgRes.org as any)?.suspendedAt) {
      return {
        props: JSON.parse(
          JSON.stringify({
            data: { host: hostRes.host },
            nodes: null,
            maintenanceFallback: true,
          }),
        ),
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

    // Redirect rules (AGL-155) fire before any route resolution, so a
    // rule can move even a published screen (plugins-redirects' resolver;
    // ISR-cached with a 30s revalidate, hit counts sampled).
    const redirectRule = await Aglyn.resolveSiteRedirect({
      hostId,
      host: hostRes.host,
      tenant: orgRes.org,
      path,
      slugSegments: [...(slug ?? [])],
    })
    if (redirectRule) {
      return {
        redirect: {
          destination: redirectRule.destination,
          statusCode: redirectRule.statusCode,
        },
        revalidate: 30,
      }
    }

    // Membership routes (AGL-109): fixed sign-in/up surfaces per site.
    if (path === 'signin' || path === 'signup') {
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
    const screenEntry = Object.entries(pathsByScreenId).find(([, slug]) => {
      return slug === path
    })
    console.debug('screenEntry', screenEntry)

    if (!Array.isArray(screenEntry)) {
      // Plugin page resolvers (AGL-418): commerce composes PDP/PLP
      // template pages for /products/* and /collections/* — first
      // non-undefined answer is the page.
      const resolved = await Aglyn.resolveSitePage({
        hostId,
        host: hostRes.host,
        tenant: orgRes.org,
        path,
        slugSegments: [...(slug ?? [])],
      })
      if (resolved) return resolved as never

      // Content collections fallback (AGL-81): /{collection} and
      // /{collection}/{entry} paths that aren't screens render the themed
      // blog surfaces.
      const segments = path.split('/').filter(Boolean)
      if (segments.length >= 1 && segments.length <= 2) {
        const content = await getCollectionContent({
          hostId,
          collectionSlug: segments[0],
          entrySlug: segments[1],
        })
        if (content.collection && (segments.length === 1 || content.entry)) {
          // Entry-template screens (AGL-105): a collection can designate a
          // besigner-built screen that renders each entry with {{entry.*}}
          // tokens; fall through to the built-in article otherwise.
          const templateScreenId = content.collection.templateScreenId
          if (content.entry && templateScreenId) {
            const templateRes = await getScreen({
              hostId,
              screenId: templateScreenId,
            })
            if (templateRes.screen) {
              const entry = content.entry
              const templateNodes = await composeScreenNodes({
                hostId,
                screenId: templateScreenId,
                screen: templateRes.screen,
                tokens: {
                  'entry.title': entry.title ?? '',
                  'entry.excerpt': entry.excerpt ?? '',
                  'entry.body': entry.body ?? '',
                  'entry.coverImage': (entry as any).coverImage ?? '',
                  'entry.date': entry.publishedAt
                    ? new Date(
                        entry.publishedAt.seconds * 1000,
                      ).toLocaleDateString()
                    : '',
                },
              })
              if (templateNodes) {
                return {
                  props: JSON.parse(
                    JSON.stringify({
                      data: {
                        host: hostRes.host,
                        screen: {
                          data: {
                            ...templateRes.screen,
                            // Entry metadata drives the head (AGL-117 merge).
                            seo: {
                              ...((templateRes.screen as any).seo ?? {}),
                              title: entry.title,
                              description: entry.excerpt || undefined,
                            },
                          },
                        },
                      },
                      nodes: templateNodes,
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
                content,
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
    console.debug('screenRes', screenRes)

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

    const denormalized = await composeScreenNodes({
      hostId,
      screenId,
      screen: screenRes.screen,
    })
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

    // Plugin page enrichers (AGL-418): marketing contributes overlays
    // (announcement bar/popup), site-event automations, and experiments —
    // all entitlement-gated inside the plugin, shapes unchanged.
    const enriched = await Aglyn.runSitePageEnrichers({
      hostId,
      host: hostRes.host,
      tenant: orgRes.org,
      path,
      slugSegments: [...(slug ?? [])],
      screenId,
      screen: screenRes.screen,
    })

    // Trusted-realm marketplace plugins (AGL-420): the workspace's install
    // pins joined server-side with the staff-only trust grants; the client
    // loads them post-hydration. Fail-open to none — a lookup error can't
    // take the page down.
    const realmPlugins = await getRealmPluginInstalls({ hostId }).catch(
      (error) => {
        console.error('realm plugin lookup failed:', error)
        return []
      },
    )

    // Plugin release gate (AGL-422): flagged-off plugins vanish from the
    // published site too — the platform kill switch. Subject = the org, so
    // rollout verdicts match the console's. Site visitors get no staff
    // bypass; fail-open inside falls back to registry defaults.
    const enabledPlugins = await filterEnabledPluginsByReleaseFlags(
      Aglyn.resolveEnabledPlugins(orgRes.org as never),
      { subjectId: (orgRes.org as { $id?: string })?.$id ?? hostId },
    )

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
      ...enriched,
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
  }
  },
)
