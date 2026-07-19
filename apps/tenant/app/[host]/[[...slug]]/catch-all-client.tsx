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

'use client'

import * as Aglyn from '@aglyn/aglyn'
import { AglynNodeRenderer } from '@aglyn/aglyn-node-renderer'
import { observer } from 'mobx-react-lite'
// next/head is a no-op in the App Router; the <Head> blocks below are inert
// and real metadata comes from the route's generateMetadata (AGL-398).
import Head from 'next/head'
import {
  type CSSProperties,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { loadSiteRealmPlugins } from '../../../utils/realm-plugins.client'
import { sitePluginLoader } from '../../../utils/site-plugin-loader'
import MembershipPage from './membership-page'
import type { Props } from './types'

const CatchAllPage = observer(function CatchAllPage(props: Props) {
  // Dynamic site-plugin activation (AGL-417): suspend — SSR included — until
  // the org-enabled plugins register their canvas components. Rendering the
  // canvas before registration is exactly the blank-site failure (AGL-52),
  // so the gate sits above everything.
  use(
    sitePluginLoader.ensure(
      props.enabledPlugins ?? [...Aglyn.DEFAULT_ENABLED_PLUGINS],
      ['site'],
    ),
  )

  // Trusted-realm marketplace plugins (AGL-420): additive runtimes loaded
  // AFTER hydration (never blocking first paint); the tick re-renders so a
  // runtime registered by a remote bundle mounts without a navigation.
  const [, setRealmTick] = useState(0)
  const realmKey = (props.realmPlugins ?? [])
    .map((install) => `${install.listingId}@${install.version}`)
    .join(',')
  useEffect(() => {
    // Dev bundles (AGL-427) load even with no realm installs; the env is
    // inlined and the whole dev path is dead code in production builds.
    if (!realmKey && !process.env.NEXT_PUBLIC_PLUGIN_DEV_BUNDLES) return
    void loadSiteRealmPlugins(props.realmPlugins).then(() =>
      setRealmTick((tick) => tick + 1),
    )
    // realmKey captures the install list's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realmKey])

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

  const site = useMemo(() => ({ hostId: host?.$id }), [host?.$id])

  // Password-protected screens render an unlock form; the composed nodes
  // arrive from /api/protection/unlock after verification (AGL-87).
  // Membership sign-in/up/recovery (AGL-109/552): the theme-wrapped
  // built-in forms (AGL-553). A designated auth screen (host `authScreens`)
  // arrives WITH composed nodes and falls through to the normal canvas
  // render below instead.
  if (props.membershipPage && !nodes) {
    return (
      <>
        <Head>
          <meta key="robots" name="robots" content="noindex" />
        </Head>
        <MembershipPage
          page={props.membershipPage}
          hostId={props.data?.host?.$id}
        />
      </>
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

  // Legacy collection surface (AGL-81): only when AGL-551 could compose
  // neither a template screen nor the themed built-in (`nodes` present means
  // the collection page renders through the normal canvas path below).
  if (props.content?.collection && !nodes) {
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
        {/* Structured data (WebSite/BreadcrumbList) and hreflang alternates
            (AGL-143/164) now render server-side from the route's
            `buildJsonLd` + `generateMetadata.alternates` (page.tsx) — the
            Metadata API has no JSON-LD slot and `next/head` is inert here. */}
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
      {/* Shared hidden class (AGL-562): ships in the SSR HTML so
          elements authors start hidden (interaction show/hide targets)
          paint hidden from the first frame — no flash before the
          automations engine hydrates. The besigner canvas deliberately
          omits this rule so hidden elements stay editable. */}
      <style>{Aglyn.ELEMENT_HIDDEN_STYLE_TEXT}</style>
      {/* Plugin site runtimes (AGL-419): experiment runners, automation
          engines, overlays — each registered from its plugin's site
          surface and reading back the page-props slices its own server
          enricher wrote. */}
      {Aglyn.listSiteRuntimes().map(({ runtimeId, Component }) => (
        <Component
          key={runtimeId}
          hostId={props.data?.host?.$id}
          screens={props.data?.host?.screens}
          page={props as Record<string, any>}
        />
      ))}
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
