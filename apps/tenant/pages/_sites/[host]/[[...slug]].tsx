/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn'
import { AglynNodeRenderer } from '@aglyn/aglyn-node-renderer'
import { registerLegacyMuiPlugin } from '@aglyn/plugins-ui-mui'
import { observer } from 'mobx-react-lite'
import type { GetStaticPaths, GetStaticProps } from 'next/types'
import type { ParsedUrlQuery } from 'querystring'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import applyDuePublishSchedule from '../../../utils/apply-publish-schedule'
import composeScreenNodes from '../../../utils/compose-screen-nodes'
import { resolveRedirect } from '../../../utils/resolve-redirect'
import getCollectionContent, {
  type CollectionContent,
} from '../../../utils/get-collection-content'
import getComponents from '../../../utils/get-components'
import getTenant from '../../../utils/get-tenant'
import getVariables from '../../../utils/get-variables'
import getHost from '../../../utils/get-host'
import getPublishedLayoutVersion from '../../../utils/get-layout-version'
import getScreen from '../../../utils/get-screen'
import getScreenVersion from '../../../utils/get-screen-version'

registerLegacyMuiPlugin()

interface StaticPathsCtx extends ParsedUrlQuery {}

interface Props {
  data: {
    host?: Aglyn.AglynHost
    screen?: {
      data?: Aglyn.AglynScreen
      version?: Aglyn.AglynScreenVersion
    }
  }
  nodes: Record<Aglyn.NodeId, Aglyn.NodeSchema> | null
  /** Free-tier "Made with Aglyn" badge (AGL-69, removeBranding gate). */
  showBranding?: boolean
  /**
   * Site-wide announcement bar (AGL-195): text already binding-resolved
   * server-side; `contentHash` keys the visitor's dismissal so edits
   * re-show the bar. Null when disabled or not entitled.
   */
  announcementBar?: {
    text: string
    href?: string
    backgroundColor?: string
    textColor?: string
    dismissible?: boolean
    contentHash: string
  } | null
  /**
   * Promotional popup (AGL-196): copy binding-resolved server-side; the
   * client owns trigger timing, the schedule window re-check (ISR pages
   * cache up to 60s), and localStorage frequency capping.
   */
  popup?: {
    headline?: string
    body: string
    imageUrl?: string
    ctaLabel?: string
    ctaHref?: string
    trigger: 'delay' | 'scroll' | 'exit'
    triggerValue: number
    frequencyDays: number
    collectEmail?: boolean
    startAtMs?: number
    endAtMs?: number
    contentHash: string
  } | null
  /** Collection list/entry payload when the path is content, not a screen. */
  content?: CollectionContent
  /** Password-protected screen: nodes withheld until unlock (AGL-87). */
  protectedScreen?: boolean
  /** Members-only screen (AGL-109): nodes arrive via /api/membership. */
  memberScreen?: boolean
  /** Membership form route (AGL-109): 'signin' | 'signup'. */
  membershipPage?: string
  /** Rendered as the custom not-found screen (noindex, AGL-87). */
  notFoundFallback?: boolean
  /** Maintenance mode (AGL-131): 503 screen or the built-in notice. */
  maintenanceFallback?: boolean
  /** Composed 401 screen nodes for members-only denials (AGL-131). */
  unauthorizedNodes?: Record<string, any> | null
}

export const getStaticPaths: GetStaticPaths<StaticPathsCtx> = async (ctx) => {
  return {
    paths: [],
    fallback: 'blocking', // ISR server-render if static cache is not available
  }
}

export const getStaticProps: GetStaticProps<Props> = async (context) => {
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

    // Tenant suspension (AGL-202): staff-suspended tenants stop serving
    // every path immediately (short revalidate bounds the lag). Loaded
    // once here and reused by the branding/overlay branches below.
    const tenantRes = await getTenant({ tenantId: hostRes.host.tenantId })
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
            showBranding: Boolean(
              tenantRes.tenant?.plan &&
                !Aglyn.resolveTenantEntitlements(tenantRes.tenant).features
                  .removeBranding,
            ),
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

    // Free-tier branding (AGL-69): shown only once the owning tenant has an
    // explicit plan without the removeBranding feature; pre-billing tenants
    // (no plan) and lookup failures render without the badge.
    const showBranding = Boolean(
      tenantRes.tenant?.plan &&
        !Aglyn.resolveTenantEntitlements(tenantRes.tenant).features
          .removeBranding,
    )

    // Marketing overlays (AGL-195/196): marketingOverlays-gated
    // (dark-launch for plan-less tenants like other AGL-99 gates); binding
    // tokens resolve server-side so the client ships plain text.
    const overlaysEntitled =
      !tenantRes.tenant?.plan ||
      Aglyn.resolveTenantEntitlements(tenantRes.tenant).features
        .marketingOverlays
    const contentHash = (value: string) => {
      let hash = 0
      for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0
      }
      return Math.abs(hash).toString(36)
    }
    const barConfig = (hostRes.host as any)
      ?.announcementBar as Aglyn.HostAnnouncementBar | undefined
    const popupConfig = (hostRes.host as any)?.popup as
      | Aglyn.HostPopup
      | undefined
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
}

/** Overlay metrics beacon (AGL-200): fire-and-forget, never blocks UX. */
function sendOverlayBeacon(hostId: string | undefined, overlay: string) {
  if (!hostId) return
  try {
    navigator.sendBeacon(
      '/api/analytics/collect',
      JSON.stringify({ hostId, overlay }),
    )
  } catch {
    // Beacons are best-effort.
  }
}

/**
 * Site-wide announcement bar (AGL-195). Dismissal is per content-hash in
 * localStorage (no cookies): editing the text re-shows the bar for
 * everyone who hid the old one.
 */
function AnnouncementBar(props: {
  bar: NonNullable<Props['announcementBar']>
  hostId?: string
}) {
  const { bar, hostId } = props
  const storageKey = `aglyn-abar-${bar.contentHash}`
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    try {
      setHidden(Boolean(window.localStorage.getItem(storageKey)))
    } catch {
      setHidden(false)
    }
  }, [storageKey])
  if (hidden) return null
  const style: CSSProperties = {
    position: 'relative',
    zIndex: 1300,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '8px 40px 8px 16px',
    fontSize: 14,
    fontFamily: 'system-ui, sans-serif',
    textAlign: 'center',
    color: bar.textColor || '#fff',
    backgroundColor: bar.backgroundColor || '#111827',
  }
  const text = bar.href ? (
    <a
      href={bar.href}
      onClick={() => sendOverlayBeacon(hostId, 'barClick')}
      style={{ color: 'inherit', textDecoration: 'underline' }}
    >
      {bar.text}
    </a>
  ) : (
    <span>{bar.text}</span>
  )
  return (
    <div role="region" aria-label="Announcement" style={style}>
      {text}
      {bar.dismissible ? (
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={() => {
            try {
              window.localStorage.setItem(storageKey, '1')
            } catch {
              // Storage may be unavailable (private mode); hide anyway.
            }
            sendOverlayBeacon(hostId, 'barDismiss')
            setHidden(true)
          }}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 6,
          }}
        >
          {'✕'}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Promotional popup (AGL-196). Client owns: schedule-window re-check (the
 * page is ISR-cached), trigger timing (delay/scroll/exit), and frequency
 * capping via a per-content-hash localStorage stamp (no cookies). ESC and
 * backdrop close; reduced-motion preferences skip the entrance ease.
 */
function PopupOverlay(props: {
  popup: NonNullable<Props['popup']>
  hostId?: string
}) {
  const { popup, hostId } = props
  const storageKey = `aglyn-popup-${popup.contentHash}`
  const [open, setOpen] = useState(false)
  // Email capture (AGL-200): submits into the forms pipeline (inbox +
  // contacts); success suppresses the popup for ~10 years.
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (open) sendOverlayBeacon(hostId, 'popupImpression')
  }, [open, hostId])

  useEffect(() => {
    const now = Date.now()
    if (popup.startAtMs && now < popup.startAtMs) return
    if (popup.endAtMs && now > popup.endAtMs) return
    try {
      const stamp = Number(window.localStorage.getItem(storageKey) ?? 0)
      if (stamp && now - stamp < popup.frequencyDays * 86400000) return
    } catch {
      // Storage unavailable: show at most per-pageview.
    }
    let cleanup: (() => void) | undefined
    if (popup.trigger === 'scroll') {
      const threshold = Math.min(100, Math.max(0, popup.triggerValue)) / 100
      const onScroll = () => {
        const height =
          document.documentElement.scrollHeight - window.innerHeight
        if (height <= 0 || window.scrollY / height >= threshold) {
          setOpen(true)
        }
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      cleanup = () => window.removeEventListener('scroll', onScroll)
    } else if (popup.trigger === 'exit') {
      const onLeave = (event: MouseEvent) => {
        if (event.clientY <= 0) setOpen(true)
      }
      document.addEventListener('mouseout', onLeave)
      cleanup = () => document.removeEventListener('mouseout', onLeave)
    } else {
      const timer = window.setTimeout(
        () => setOpen(true),
        Math.max(0, popup.triggerValue) * 1000,
      )
      cleanup = () => window.clearTimeout(timer)
    }
    return cleanup
  }, [popup, storageKey])

  const close = (kind: 'popupDismiss' | 'popupClick' = 'popupDismiss') => {
    try {
      window.localStorage.setItem(storageKey, String(Date.now()))
    } catch {
      // Private mode etc. — closing still works for this pageview.
    }
    sendOverlayBeacon(hostId, kind)
    setOpen(false)
  }

  const handleEmailSubmit = async () => {
    const value = email.trim()
    if (!value || submitted) return
    try {
      await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          formName: 'Popup',
          fields: { email: value },
          path: window.location.pathname,
          website: '',
        }),
      })
    } catch {
      // Best-effort — still thank the visitor.
    }
    setSubmitted(true)
    try {
      // Far-future stamp: a successful capture never re-prompts.
      window.localStorage.setItem(
        storageKey,
        String(Date.now() + 315360000000),
      )
    } catch {
      // Ignore.
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null
  return (
    <div
      onClick={() => close()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={popup.headline || 'Announcement'}
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: 420,
          width: '100%',
          background: '#fff',
          color: '#111827',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.35)',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => close()}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            border: 'none',
            background: 'rgba(255, 255, 255, 0.85)',
            borderRadius: '50%',
            width: 28,
            height: 28,
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          {'✕'}
        </button>
        {popup.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={popup.imageUrl}
            alt=""
            style={{
              width: '100%',
              maxHeight: 200,
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}
        <div style={{ padding: 24, textAlign: 'center' }}>
          {popup.headline ? (
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>
              {popup.headline}
            </h2>
          ) : null}
          <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>
            {popup.body}
          </p>
          {popup.collectEmail ? (
            <div style={{ marginTop: 16 }}>
              {submitted ? (
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                  {'Thanks — you are on the list!'}
                </p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleEmailSubmit()
                  }}
                  style={{ display: 'flex', gap: 8, justifyContent: 'center' }}
                >
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    style={{
                      flex: 1,
                      maxWidth: 240,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      fontSize: 14,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#111827',
                      color: '#fff',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {'Sign up'}
                  </button>
                </form>
              )}
            </div>
          ) : null}
          {popup.ctaHref && popup.ctaLabel ? (
            <a
              href={popup.ctaHref}
              onClick={() => close('popupClick')}
              style={{
                display: 'inline-block',
                marginTop: 16,
                padding: '10px 24px',
                borderRadius: 8,
                background: '#111827',
                color: '#fff',
                textDecoration: 'none',
                fontSize: 14,
              }}
            >
              {popup.ctaLabel}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const CatchAllPage = observer(function CatchAllPage(props: Props) {
  // const props = { data: exampleData }
  const nodes = props.nodes
  // Unlocked content for password-protected screens (AGL-87).
  const [unlockedNodes, setUnlockedNodes] = useState<Record<
    string,
    any
  > | null>(null)
  const [unlockError, setUnlockError] = useState(false)
  // Members-only content (AGL-109): fetched with the session cookie.
  const [memberNodes, setMemberNodes] = useState<Record<string, any> | null>(
    null,
  )
  const [memberDenied, setMemberDenied] = useState(false)
  const memberHostId = props.data?.host?.$id
  const memberScreenId = props.data?.screen?.data?.$id
  useEffect(() => {
    if (!props.memberScreen || !memberHostId || !memberScreenId) return
    let active = true
    void (async () => {
      const response = await fetch('/api/membership/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId: memberHostId,
          screenId: memberScreenId,
        }),
      })
      if (!active) return
      if (!response.ok) return setMemberDenied(true)
      const payload = await response.json()
      if (payload?.nodes) {
        Aglyn.canvas.setNodes(payload.nodes)
        setMemberNodes(payload.nodes)
      }
    })()
    return () => {
      active = false
    }
  }, [props.memberScreen, memberHostId, memberScreenId])
  // Membership forms (AGL-109).
  const [memberFormError, setMemberFormError] = useState<string | null>(null)

  // Fill the canvas DURING render, not only in an effect: the server
  // otherwise emits an empty page (crawlers see nothing) and hydration
  // mismatches. Safe on the shared server singleton because each render
  // pass runs synchronously — the server always refills so a previous
  // request's tree can't leak into this page. On the client only the very
  // first render fills synchronously (matching the server HTML); later prop
  // changes (client-side navigations) go through the effect below so
  // mounted observers aren't invalidated mid-render.
  if (nodes && (typeof window === 'undefined' || !Aglyn.canvas.rootNode)) {
    Aglyn.canvas.setNodes(nodes)
  }

  useEffect(() => {
    if (!nodes) return
    Aglyn.emitter.emit(Aglyn.AglynEvent.NODE_SET_ITEMS, { nodes: nodes })
  }, [nodes])

  // Pageview beacon (AGL-82): privacy-friendly counter, no cookies.
  const beaconHostId = props.data?.host?.$id
  // Strict format check — the id lands inside an inline script (AGL-138).
  const gaCandidate = String(
    (props.data?.host as any)?.analytics?.gaMeasurementId ?? '',
  )
  const gaMeasurementId = /^G-[A-Z0-9]{4,16}$/.test(gaCandidate)
    ? gaCandidate
    : null
  useEffect(() => {
    if (!beaconHostId || typeof navigator === 'undefined') return
    try {
      navigator.sendBeacon(
        '/api/analytics/collect',
        JSON.stringify({
          hostId: beaconHostId,
          path: window.location.pathname,
          // Per-screen attribution (AGL-151).
          screenId: props.data?.screen?.data?.$id || undefined,
          // External referrer host only; same-site moves are dropped
          // server-side (AGL-138).
          referrer: document.referrer || undefined,
        }),
      )
    } catch {
      // Analytics never breaks the page.
    }
  }, [beaconHostId])

  // Id-based screen links resolve against this routing map at render time;
  // ISR keeps it current (slug renames show up on the next revalidate).
  const screens = props.data?.host?.screens
  // Locale plumbing (AGL-164): the switcher component reads variants of
  // the CURRENT screen from this context.
  const screenLocale = (props.data?.screen?.data as any)?.locale
  const screenLocaleVariants = (props.data?.screen?.data as any)
    ?.localeVariants
  const screenLinks = useMemo(
    () => ({
      screens,
      currentLocale: screenLocale,
      localeVariants: screenLocaleVariants,
    }),
    [screens, screenLocale, screenLocaleVariants],
  )

  // SEO emission (SEO Toolkit): screen seo fields with host-level defaults.
  const host = props.data?.host
  const screen = props.data?.screen?.data
  const siteTitle = host?.seo?.title ?? host?.displayName
  const separator = host?.seo?.separator ?? ' – '
  const pageTitle = (screen as any)?.seo?.title || screen?.displayName
  const fullTitle =
    [pageTitle, siteTitle].filter(Boolean).join(separator) || 'Aglyn site'
  const description =
    (screen as any)?.seo?.description ||
    screen?.description ||
    host?.seo?.description
  // Social image (AGL-117): screen override falls back to the host default.
  const socialImage =
    ((screen as any)?.seo?.image as string) ||
    ((host?.seo?.image as string) ?? undefined)
  // Unlisted pages (AGL-113 visibility) stay reachable but out of search.
  const unlisted =
    screen?.visibility === Aglyn.HostScreenVisibility.UNLISTED
  const canonicalBase = host?.cname
    ? `https://${host.cname}`
    : host?.subdomain
      ? `https://${host.subdomain}.aglyn.app`
      : undefined
  const screenPath = screen?.$id ? host?.screens?.[screen.$id] : undefined
  const canonical =
    canonicalBase && screenPath != null
      ? `${canonicalBase}${Aglyn.screenRoutePathToUrl(screenPath)}`
      : undefined

  // BreadcrumbList (AGL-143) for nested screen paths (a/b/c).
  const breadcrumbSegments =
    typeof screenPath === 'string'
      ? screenPath.split('/').filter(Boolean)
      : []
  const breadcrumbLd =
    canonicalBase && breadcrumbSegments.length > 1
      ? JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: breadcrumbSegments.map((segment, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: segment,
            item: `${canonicalBase}/${breadcrumbSegments
              .slice(0, index + 1)
              .join('/')}`,
          })),
        })
      : null

  const site = useMemo(() => ({ hostId: host?.$id }), [host?.$id])

  // Password-protected screens render an unlock form; the composed nodes
  // arrive from /api/protection/unlock after verification (AGL-87).
  // Membership sign-in/up forms (AGL-109).
  if (props.membershipPage) {
    const isSignup = props.membershipPage === 'signup'
    return (
      <div style={{ maxWidth: 420, margin: '15vh auto', padding: 24 }}>
        <Head>
          <title>{isSignup ? 'Sign up' : 'Sign in'}</title>
          <meta key="robots" name="robots" content="noindex" />
        </Head>
        <h1 style={{ fontSize: 22 }}>
          {isSignup ? 'Create your account' : 'Welcome back'}
        </h1>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setMemberFormError(null)
            const form = new FormData(event.currentTarget)
            const response = await fetch(
              isSignup ? '/api/membership/register' : '/api/membership/login',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  hostId: props.data?.host?.$id,
                  email: String(form.get('email') ?? ''),
                  password: String(form.get('password') ?? ''),
                  ...(isSignup
                    ? { displayName: String(form.get('displayName') ?? '') }
                    : {}),
                }),
              },
            )
            if (!response.ok) {
              const payload = await response.json().catch(() => ({}))
              return setMemberFormError(
                payload?.error ??
                  (isSignup ? 'Sign-up failed' : 'Sign-in failed'),
              )
            }
            window.location.href = '/'
          }}
        >
          {isSignup ? (
            <input
              name="displayName"
              placeholder="Name"
              style={{ width: '100%', padding: 8, marginBottom: 8 }}
            />
          ) : null}
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            style={{ width: '100%', padding: 8, marginBottom: 8 }}
          />
          <input
            name="password"
            type="password"
            required
            minLength={isSignup ? 8 : undefined}
            placeholder="Password"
            style={{ width: '100%', padding: 8 }}
          />
          <button type="submit" style={{ marginTop: 12, padding: '8px 16px' }}>
            {isSignup ? 'Sign up' : 'Sign in'}
          </button>
          {memberFormError ? (
            <p style={{ color: '#c62828' }}>{memberFormError}</p>
          ) : null}
        </form>
        <p style={{ opacity: 0.8 }}>
          {isSignup ? (
            <a href="/signin">{'Already a member? Sign in'}</a>
          ) : (
            <a href="/signup">{'New here? Create an account'}</a>
          )}
        </p>
      </div>
    )
  }

  // Maintenance mode without an assigned 503 screen (AGL-131).
  if (props.maintenanceFallback && !nodes) {
    return (
      <div style={{ maxWidth: 420, margin: '15vh auto', padding: 24 }}>
        <Head>
          <title>{'Temporarily unavailable'}</title>
          <meta key="robots" name="robots" content="noindex" />
        </Head>
        <h1 style={{ fontSize: 22 }}>{'Back soon'}</h1>
        <p style={{ opacity: 0.8 }}>
          {'This site is undergoing maintenance. Please check back shortly.'}
        </p>
      </div>
    )
  }

  // Members-only denial with an assigned 401 screen (AGL-131): render the
  // designed page instead of the built-in prompt. Client-only transition
  // (the server renders the checking state), so the mid-render canvas fill
  // mirrors the first-fill pattern above.
  if (props.memberScreen && memberDenied && props.unauthorizedNodes) {
    Aglyn.canvas.setNodes(props.unauthorizedNodes)
    return (
      <>
        <Head>
          <title>{'Members only'}</title>
          <meta key="robots" name="robots" content="noindex" />
        </Head>
        <AglynNodeRenderer node={Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)} />
      </>
    )
  }

  // Members-only screens (AGL-109): prompt for sign-in until the session
  // cookie verifies and the nodes arrive.
  if (props.memberScreen && !memberNodes) {
    return (
      <div style={{ maxWidth: 420, margin: '15vh auto', padding: 24 }}>
        <Head>
          <title>{'Members only'}</title>
          <meta key="robots" name="robots" content="noindex" />
        </Head>
        {memberDenied ? (
          <>
            <h1 style={{ fontSize: 22 }}>{'This page is for members'}</h1>
            <p style={{ opacity: 0.8 }}>
              <a href="/signin">{'Sign in'}</a>
              {' or '}
              <a href="/signup">{'create an account'}</a>
              {' to view it.'}
            </p>
          </>
        ) : (
          <p style={{ opacity: 0.7 }}>{'Checking your membership…'}</p>
        )}
      </div>
    )
  }

  if (props.protectedScreen && !unlockedNodes) {
    return (
      <div style={{ maxWidth: 420, margin: '15vh auto', padding: 24 }}>
        <Head>
          <title>{fullTitle}</title>
          <meta key="robots" name="robots" content="noindex" />
        </Head>
        <h1 style={{ fontSize: 22 }}>{'This page is protected'}</h1>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setUnlockError(false)
            const form = new FormData(event.currentTarget)
            const response = await fetch('/api/protection/unlock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hostId: host?.$id,
                screenId: screen?.$id,
                password: String(form.get('password') ?? ''),
              }),
            })
            if (!response.ok) return setUnlockError(true)
            const payload = await response.json()
            if (payload?.nodes) {
              Aglyn.canvas.setNodes(payload.nodes)
              setUnlockedNodes(payload.nodes)
            } else {
              setUnlockError(true)
            }
          }}
        >
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoFocus
            style={{ padding: 8, width: '100%', boxSizing: 'border-box' }}
          />
          <button type="submit" style={{ marginTop: 12, padding: '8px 16px' }}>
            {'Unlock'}
          </button>
          {unlockError ? (
            <p style={{ color: '#c62828' }}>{'Wrong password — try again.'}</p>
          ) : null}
        </form>
      </div>
    )
  }

  // Collection surfaces render outside the canvas system (AGL-81).
  if (props.content?.collection) {
    const { collection, entries, entry } = props.content
    const contentTitle = entry?.title ?? collection.displayName
    const contentFullTitle =
      [contentTitle, siteTitle].filter(Boolean).join(separator) || contentTitle
    const formatDate = (value?: { seconds: number } | null) =>
      value ? new Date(value.seconds * 1000).toLocaleDateString() : ''
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
        <Head>
          <title>{contentFullTitle}</title>
          {entry?.excerpt ? (
            <meta key="desc" name="description" content={entry.excerpt} />
          ) : null}
          {/* Social/SEO completeness (AGL-143). */}
          {entry ? (
            <>
              <meta key="og:type" property="og:type" content="article" />
              <meta
                key="og:title"
                property="og:title"
                content={contentFullTitle}
              />
              {entry.excerpt ? (
                <meta
                  key="og:description"
                  property="og:description"
                  content={entry.excerpt}
                />
              ) : null}
              {(entry as any).coverImage ? (
                <>
                  <meta
                    key="og:image"
                    property="og:image"
                    content={(entry as any).coverImage}
                  />
                  <meta
                    key="twitter:image"
                    name="twitter:image"
                    content={(entry as any).coverImage}
                  />
                </>
              ) : null}
              {entry.publishedAt?.seconds ? (
                <meta
                  key="article:published_time"
                  property="article:published_time"
                  content={new Date(
                    entry.publishedAt.seconds * 1000,
                  ).toISOString()}
                />
              ) : null}
              {(entry as any).updatedAt?.seconds ? (
                <meta
                  key="article:modified_time"
                  property="article:modified_time"
                  content={new Date(
                    (entry as any).updatedAt.seconds * 1000,
                  ).toISOString()}
                />
              ) : null}
              <script
                key="ld-article"
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                  __html: JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Article',
                    headline: entry.title,
                    ...(entry.excerpt && { description: entry.excerpt }),
                    ...((entry as any).coverImage && {
                      image: [(entry as any).coverImage],
                    }),
                    ...(entry.publishedAt?.seconds && {
                      datePublished: new Date(
                        entry.publishedAt.seconds * 1000,
                      ).toISOString(),
                    }),
                    ...((entry as any).updatedAt?.seconds && {
                      dateModified: new Date(
                        (entry as any).updatedAt.seconds * 1000,
                      ).toISOString(),
                    }),
                    ...(host?.seo?.entity?.name && {
                      author: {
                        '@type':
                          host.seo.entity.type ===
                          Aglyn.HostEntityType.PERSON
                            ? 'Person'
                            : 'Organization',
                        name: host.seo.entity.name,
                      },
                    }),
                  }),
                }}
              />
            </>
          ) : null}
        </Head>
        {entry ? (
          <article>
            <h1>{entry.title}</h1>
            <p style={{ opacity: 0.7 }}>{formatDate(entry.publishedAt)}</p>
            {(entry as any).coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(entry as any).coverImage}
                alt=""
                style={{ maxWidth: '100%', borderRadius: 8 }}
              />
            ) : null}
            {Aglyn.parseMarkdownLite(entry.body ?? '').map((block, index) => {
              const inline = (inlines: Aglyn.MarkdownInline[]) =>
                inlines.map((item, i) =>
                  item.type === 'bold' ? (
                    <strong key={i}>{item.text}</strong>
                  ) : item.type === 'italic' ? (
                    <em key={i}>{item.text}</em>
                  ) : item.type === 'link' ? (
                    <a key={i} href={item.href}>
                      {item.text}
                    </a>
                  ) : (
                    <span key={i}>{item.text}</span>
                  ),
                )
              if (block.type === 'heading') {
                return block.level === 2 ? (
                  <h2 key={index}>{inline(block.inlines)}</h2>
                ) : (
                  <h3 key={index}>{inline(block.inlines)}</h3>
                )
              }
              if (block.type === 'image') {
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={index}
                    src={block.src}
                    alt={block.alt}
                    style={{ maxWidth: '100%', borderRadius: 8 }}
                  />
                )
              }
              if (block.type === 'list') {
                return (
                  <ul key={index} style={{ lineHeight: 1.7 }}>
                    {block.items.map((item, i) => (
                      <li key={i}>{inline(item)}</li>
                    ))}
                  </ul>
                )
              }
              return (
                <p key={index} style={{ lineHeight: 1.7 }}>
                  {inline(block.inlines)}
                </p>
              )
            })}
            <p>
              <a href={`/${collection.slug}`}>{`← ${collection.displayName}`}</a>
            </p>
          </article>
        ) : (
          <>
            <h1>{collection.displayName}</h1>
            {entries.length === 0 ? (
              <p style={{ opacity: 0.7 }}>{'Nothing published yet.'}</p>
            ) : (
              entries.map((item) => (
                <article key={item.$id} style={{ marginBottom: 32 }}>
                  <h2 style={{ marginBottom: 4 }}>
                    <a
                      href={`/${collection.slug}/${item.slug}`}
                      style={{ color: 'inherit' }}
                    >
                      {item.title}
                    </a>
                  </h2>
                  <p style={{ opacity: 0.7, margin: 0 }}>
                    {formatDate(item.publishedAt)}
                  </p>
                  {item.excerpt ? (
                    <p style={{ lineHeight: 1.7 }}>{item.excerpt}</p>
                  ) : null}
                </article>
              ))
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <Aglyn.SiteContext.Provider value={site}>
    <Aglyn.ScreenLinkContext.Provider value={screenLinks}>
      <Head>
        <title>{fullTitle}</title>
        {description ? (
          <meta key="desc" name="description" content={description} />
        ) : null}
        <meta key="og:title" property="og:title" content={fullTitle} />
        {description ? (
          <meta
            key="og:description"
            property="og:description"
            content={description}
          />
        ) : null}
        <meta key="og:type" property="og:type" content="website" />
        {canonical ? (
          <meta key="og:url" property="og:url" content={canonical} />
        ) : null}
        {socialImage ? (
          <meta key="og:image" property="og:image" content={socialImage} />
        ) : null}
        {socialImage ? (
          <meta
            key="twitter:image"
            name="twitter:image"
            content={socialImage}
          />
        ) : null}
        {siteTitle ? (
          <meta key="og:site_name" property="og:site_name" content={siteTitle} />
        ) : null}
        <meta
          key="twitter:card"
          name="twitter:card"
          content={socialImage ? 'summary_large_image' : 'summary'}
        />
        {/* Structured data (AGL-143): WebSite + host entity, and
            breadcrumbs for nested paths. Event schema arrives with the
            Event Calendar add-on (AGL-145). */}
        {canonicalBase ? (
          <script
            key="ld-website"
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'WebSite',
                name: siteTitle ?? host?.displayName ?? 'Site',
                url: canonicalBase,
                ...(host?.seo?.entity?.name && {
                  publisher: {
                    '@type':
                      host.seo.entity.type === Aglyn.HostEntityType.PERSON
                        ? 'Person'
                        : 'Organization',
                    name: host.seo.entity.name,
                    ...(host.seo.entity.logo && {
                      logo: host.seo.entity.logo,
                    }),
                  },
                }),
              }),
            }}
          />
        ) : null}
        {breadcrumbLd ? (
          <script
            key="ld-breadcrumbs"
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: breadcrumbLd }}
          />
        ) : null}
        {/* hreflang alternates (AGL-164): variants resolve through the
            routing map, so slug renames stay correct. */}
        {canonicalBase && screenLocaleVariants
          ? Object.entries(
              screenLocaleVariants as Record<string, string>,
            ).map(([locale, variantId]) => {
              const variantPath = host?.screens?.[variantId]
              if (variantPath == null) return null
              return (
                <link
                  key={`alt-${locale}`}
                  rel="alternate"
                  hrefLang={locale}
                  href={`${canonicalBase}${Aglyn.screenRoutePathToUrl(variantPath)}`}
                />
              )
            })
          : null}
        {canonicalBase && screenLocaleVariants && canonical ? (
          <link
            key="alt-self"
            rel="alternate"
            hrefLang={screenLocale || 'x-default'}
            href={canonical}
          />
        ) : null}
        {canonical ? (
          <link key="canonical" rel="canonical" href={canonical} />
        ) : null}
        {props.notFoundFallback || props.maintenanceFallback || unlisted ? (
          <meta key="robots" name="robots" content="noindex" />
        ) : null}
        {/* Google Analytics (AGL-138): tenant-configured measurement id. */}
        {gaMeasurementId ? (
          <>
            <script
              key="ga-src"
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
            />
            <script
              key="ga-init"
              dangerouslySetInnerHTML={{
                __html:
                  'window.dataLayer=window.dataLayer||[];' +
                  'function gtag(){dataLayer.push(arguments);}' +
                  "gtag('js', new Date());" +
                  `gtag('config', '${gaMeasurementId}');`,
              }}
            />
          </>
        ) : null}
      </Head>
      {props.announcementBar ? (
        <AnnouncementBar
          bar={props.announcementBar}
          hostId={props.data?.host?.$id}
        />
      ) : null}
      {props.popup ? (
        <PopupOverlay popup={props.popup} hostId={props.data?.host?.$id} />
      ) : null}
      <AglynNodeRenderer node={Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)} />
      {props.showBranding ? (
        <a
          href="https://aglyn.com"
          target="_blank"
          rel="noreferrer"
          style={{
            position: 'fixed',
            bottom: 12,
            right: 12,
            zIndex: 2147483000,
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
            color: '#fff',
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
            textDecoration: 'none',
          }}
        >
          {'Made with Aglyn'}
        </a>
      ) : null}
    </Aglyn.ScreenLinkContext.Provider>
    </Aglyn.SiteContext.Provider>
  )
})

export default CatchAllPage
