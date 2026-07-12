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
import * as MarketingModel from '@aglyn/plugins-marketing/model'
import * as CommerceModel from '@aglyn/plugins-commerce/model'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import getVariables from '@aglyn/tenant-runtime/get-variables'
import { cache } from 'react'
import getClientAutomations, {
  type ClientAutomation,
} from '../../../utils/get-client-automations'
import getCollectionContent from '../../../utils/get-collection-content'
import getHost from '../../../utils/get-host'
import getOverlays from '../../../utils/get-overlays'
import getScreenExperiments, {
  type ScreenExperiment,
} from '../../../utils/get-screen-experiments'
import getTenant from '../../../utils/get-tenant'
import { resolveRedirect } from '../../../utils/resolve-redirect'
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
    const path = ((params.slug || ['/']) as string[]).join('/')
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
    const tenantRes = await getTenant({ hostId })
    if ((tenantRes.tenant as any)?.suspendedAt) {
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

    // Redirect rules (AGL-155) fire before any route resolution, so a
    // rule can move even a published screen. Option A per the issue:
    // ISR-cached with a 30s revalidate; hit counts are sampled.
    const redirectRule = await resolveRedirect(hostRes.host as any, path)
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
      // Product detail routes (AGL-292): /products/{slug} renders the
      // host's designated PDP template screen (settings/store
      // `pdpScreenId`, AGL-295) with product tokens; the product-detail
      // block hydrates variants client-side from the same slug. Same
      // mechanism as entry-template screens below.
      const pdpSegments = path.split('/').filter(Boolean)
      if (pdpSegments.length === 2 && pdpSegments[0] === 'products') {
        const { firebaseAdmin } = await import('@aglyn/tenant-data-admin')
        const adminFirestore = firebaseAdmin.app().firestore()
        const hostDocRef = adminFirestore.collection('hosts').doc(hostId)
        const [storeSettings, productSnapshot] = await Promise.all([
          hostDocRef.collection('settings').doc('store').get(),
          hostDocRef
            .collection('products')
            .where('slug', '==', pdpSegments[1])
            .limit(1)
            .get(),
        ])
        const pdpScreenId = storeSettings.get('pdpScreenId')
        const productRaw = productSnapshot.docs[0]?.data() as any
        if (
          pdpScreenId &&
          productRaw &&
          !productRaw.deletedAt &&
          productRaw.status === 'active'
        ) {
          const product = CommerceModel.liftLegacyProduct(productRaw)
          const templateRes = await getScreen({
            hostId,
            screenId: pdpScreenId,
          })
          if (templateRes.screen) {
            const [minPrice, maxPrice] = CommerceModel.productPriceRange(product)
            const templateNodes = await composeScreenNodes({
              hostId,
              screenId: pdpScreenId,
              screen: templateRes.screen,
              tokens: {
                'product.name': product.name,
                'product.description': product.description ?? '',
                'product.price':
                  minPrice === maxPrice
                    ? `$${minPrice}`
                    : `From $${minPrice}`,
                'product.image':
                  product.mediaUrls?.[0] ?? product.imageUrl ?? '',
                'product.slug': product.slug,
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
                          seo: {
                            ...((templateRes.screen as any).seo ?? {}),
                            title: product.seo?.title ?? product.name,
                            description:
                              product.seo?.description ??
                              product.description ??
                              undefined,
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
      }
      // Commerce collection routes (AGL-298): /collections/{slug} renders
      // the designated collection template with collection tokens; the
      // product-grid block derives the same slug from the URL.
      if (pdpSegments.length === 2 && pdpSegments[0] === 'collections') {
        const { firebaseAdmin } = await import('@aglyn/tenant-data-admin')
        const adminFirestore = firebaseAdmin.app().firestore()
        const hostDocRef = adminFirestore.collection('hosts').doc(hostId)
        const [storeSettings, collectionSnapshot] = await Promise.all([
          hostDocRef.collection('settings').doc('store').get(),
          hostDocRef
            .collection('collections')
            .where('slug', '==', pdpSegments[1])
            .limit(1)
            .get(),
        ])
        const collectionScreenId = storeSettings.get('collectionScreenId')
        const shopCollection = collectionSnapshot.docs[0]?.data() as
          | CommerceModel.HostCollection
          | undefined
        if (collectionScreenId && shopCollection) {
          const templateRes = await getScreen({
            hostId,
            screenId: collectionScreenId,
          })
          if (templateRes.screen) {
            const templateNodes = await composeScreenNodes({
              hostId,
              screenId: collectionScreenId,
              screen: templateRes.screen,
              tokens: {
                'collection.name': shopCollection.name,
                'collection.description': shopCollection.description ?? '',
                'collection.image': shopCollection.imageUrl ?? '',
                'collection.slug': shopCollection.slug,
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
                          seo: {
                            ...((templateRes.screen as any).seo ?? {}),
                            title: shopCollection.name,
                            description:
                              shopCollection.description ?? undefined,
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
      }
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
              !Aglyn.resolveTenantEntitlements(tenantRes.tenant).features
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
    const showBranding = !Aglyn.resolveTenantEntitlements(tenantRes.tenant)
      .features.removeBranding

    // Marketing overlays (AGL-195/196/247): marketingOverlays-gated on the
    // effective plan (plan-less = free = no overlays); binding tokens
    // resolve server-side so the client ships plain text.
    const overlaysEntitled = Aglyn.resolveTenantEntitlements(tenantRes.tenant)
      .features.marketingOverlays
    const contentHash = (value: string) => {
      let hash = 0
      for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0
      }
      return Math.abs(hash).toString(36)
    }
    // Marketing hub overlays (AGL-251): scheduled/targeted overlay docs
    // win over the legacy single announcementBar/popup host fields.
    const overlayPath = `/${path.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
    const overlayDocs = overlaysEntitled ? await getOverlays({ hostId }) : []
    const activeOverlays = MarketingModel.resolveActiveOverlays(overlayDocs, {
      path: overlayPath,
    })
    const barConfig: Aglyn.HostAnnouncementBar | undefined = activeOverlays.bar
      ? { enabled: true, ...activeOverlays.bar.bar }
      : ((hostRes.host as any)?.announcementBar as
          | Aglyn.HostAnnouncementBar
          | undefined)
    const popupConfig: Aglyn.HostPopup | undefined = activeOverlays.popup
      ? {
          enabled: true,
          ...activeOverlays.popup.popup,
          ...(activeOverlays.popup.startAtMs
            ? { startAtMs: activeOverlays.popup.startAtMs }
            : {}),
          ...(activeOverlays.popup.endAtMs
            ? { endAtMs: activeOverlays.popup.endAtMs }
            : {}),
        }
      : ((hostRes.host as any)?.popup as Aglyn.HostPopup | undefined)
    const overlayVariables =
      overlaysEntitled &&
      ((barConfig?.enabled && barConfig.text) ||
        (popupConfig?.enabled && popupConfig.body))
        ? await getVariables({ hostId })
        : {}
    let announcementBar: Props['announcementBar'] = null
    if (overlaysEntitled && barConfig?.enabled && barConfig.text) {
      const text = Aglyn.resolveBindings(barConfig.text, overlayVariables)
      announcementBar = {
        text,
        ...(barConfig.href ? { href: barConfig.href } : {}),
        ...(barConfig.backgroundColor
          ? { backgroundColor: barConfig.backgroundColor }
          : {}),
        ...(barConfig.textColor ? { textColor: barConfig.textColor } : {}),
        dismissible: barConfig.dismissible !== false,
        contentHash: contentHash(text),
        ...(activeOverlays.bar?.$id
          ? { overlayId: activeOverlays.bar.$id }
          : {}),
      }
    }
    let popup: Props['popup'] = null
    if (overlaysEntitled && popupConfig?.enabled && popupConfig.body) {
      const body = Aglyn.resolveBindings(popupConfig.body, overlayVariables)
      const headline = popupConfig.headline
        ? Aglyn.resolveBindings(popupConfig.headline, overlayVariables)
        : undefined
      popup = {
        ...(headline ? { headline } : {}),
        body,
        ...(popupConfig.imageUrl ? { imageUrl: popupConfig.imageUrl } : {}),
        ...(popupConfig.ctaLabel ? { ctaLabel: popupConfig.ctaLabel } : {}),
        ...(popupConfig.ctaHref ? { ctaHref: popupConfig.ctaHref } : {}),
        trigger: popupConfig.trigger ?? 'delay',
        triggerValue: Number(popupConfig.triggerValue ?? 3),
        frequencyDays: Math.max(1, Number(popupConfig.frequencyDays ?? 7)),
        ...(popupConfig.collectEmail ? { collectEmail: true } : {}),
        ...(popupConfig.startAtMs ? { startAtMs: popupConfig.startAtMs } : {}),
        ...(popupConfig.endAtMs ? { endAtMs: popupConfig.endAtMs } : {}),
        contentHash: contentHash(`${headline ?? ''}|${body}`),
        ...(activeOverlays.popup?.$id
          ? { overlayId: activeOverlays.popup.$id }
          : {}),
      }
    }

    // Site-event automations (AGL-256): actions-gated; runJs steps are
    // business-gated (webhooks flag marks the tier).
    const actionsEntitled = Aglyn.resolveTenantEntitlements(tenantRes.tenant)
      .features.actions
    const clientAutomations: ClientAutomation[] = actionsEntitled
      ? await getClientAutomations({
          hostId,
          path: overlayPath,
          allowJs: Aglyn.resolveTenantEntitlements(tenantRes.tenant).features
            .webhooks,
        })
      : []
    // Screen/section experiments (AGL-253): Business-gated; composing a
    // tree per divergent variant is bounded (≤4) and ISR-cached.
    const experiments: ScreenExperiment[] = Aglyn.resolveTenantEntitlements(
      tenantRes.tenant,
    ).features.abTesting
      ? await getScreenExperiments({
          hostId,
          screenId,
          screen: screenRes.screen,
        })
      : []

    // Overlay payloads showOverlay steps reference (AGL-257).
    const automationOverlays: Record<string, any> = {}
    for (const automation of clientAutomations) {
      for (const step of automation.steps) {
        if (step.type === 'showOverlay' && step.overlayId) {
          const overlay = overlayDocs.find(
            (candidate) => candidate.$id === step.overlayId,
          )
          if (overlay) {
            automationOverlays[step.overlayId] = {
              kind: overlay.kind,
              ...(overlay.bar ? { bar: overlay.bar } : {}),
              ...(overlay.popup ? { popup: overlay.popup } : {}),
            }
          }
        }
      }
    }

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
      showBranding,
      announcementBar,
      popup,
      clientAutomations: JSON.parse(JSON.stringify(clientAutomations)),
      experiments: JSON.parse(JSON.stringify(experiments)),
      automationOverlays: Object.keys(automationOverlays).length
        ? JSON.parse(JSON.stringify(automationOverlays))
        : null,
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
