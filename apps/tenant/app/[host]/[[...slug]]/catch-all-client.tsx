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
import Script from 'next/script'
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

/**
 * In-flight and settled requests for a page's full node document (AGL-1285),
 * keyed by the exact page asked for.
 *
 * Module scope, not a ref or effect-local, because neither survives what
 * actually happens here: the swap re-renders the canvas, and a remount of
 * `CatchAllPage` past that point resets any per-instance guard — so the next
 * tab press refetches a document that can run to a megabyte. Measured: a
 * `pointerdown` followed by its own `click` produced two identical requests.
 *
 * Keyed rather than a bare flag so a client-side navigation to a different
 * page still fetches its own document, and returns the promise (not a boolean)
 * so a second caller arriving mid-flight waits on the first rather than
 * starting a second.
 */
const deferredNodeRequests = new Map<
  string,
  Promise<Record<string, any> | null>
>()

function fetchDeferredNodes(
  host: string,
  slug: string,
): Promise<Record<string, any> | null> {
  const key = `${host}\x00${slug}`
  const pending = deferredNodeRequests.get(key)
  if (pending) return pending
  const request = (async () => {
    const query = new URLSearchParams({ host, slug })
    const response = await fetch(`/api/screen/nodes?${query}`).catch(() => null)
    if (!response?.ok) {
      // Drop the entry so a later press can retry — a transient failure must
      // not leave those panels empty for the rest of the visit.
      deferredNodeRequests.delete(key)
      return null
    }
    const payload = await response.json().catch(() => null)
    const nodes = payload?.nodes ?? null
    if (!nodes) deferredNodeRequests.delete(key)
    return nodes
  })()
  deferredNodeRequests.set(key, request)
  return request
}

const CatchAllPage = observer(function CatchAllPage(props: Props) {
  // Dynamic site-plugin activation (AGL-417): suspend — SSR included — until
  // the org-enabled plugins register their canvas components. Rendering the
  // canvas before registration is exactly the blank-site failure (AGL-52),
  // so the gate sits above everything.
  //
  // `blockingPlugins` is the narrowed set when the server could prove nothing
  // else has work to do on this page (AGL-1289); without it this is the org's
  // whole enabled list, which is what it always was.
  const enabledPlugins = props.enabledPlugins ?? [
    ...Aglyn.DEFAULT_ENABLED_PLUGINS,
  ]
  use(sitePluginLoader.ensure(props.blockingPlugins ?? enabledPlugins, ['site']))

  // The plugins that did NOT have to block: load them straight after
  // hydration, so they are registered for anything that needs them later
  // without having sat in front of first render. Same shape as the realm
  // plugins below — load, then tick so a runtime that registers late still
  // mounts. Nothing is dropped here; only the waiting moved.
  const [, setLatePluginTick] = useState(0)
  const blockingKey = props.blockingPlugins?.join(',')
  const enabledKey = enabledPlugins.join(',')
  useEffect(() => {
    if (blockingKey == null || blockingKey === enabledKey) return
    let active = true
    void sitePluginLoader
      .ensure(enabledKey.split(','), ['site'])
      .then(() => active && setLatePluginTick((tick) => tick + 1))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [blockingKey, enabledKey])

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

  // Withheld lazy-panel subtrees, once fetched back (AGL-1285/1287). A PATCH —
  // the dropped descendants plus the original panel nodes — not the whole
  // document, so merging it over `props.nodes` is what reconstitutes the page.
  //
  // Read THROUGH `nodes` rather than pushed straight at the canvas: the canvas
  // fill below and the `NODE_SET_ITEMS` effect both key off `nodes`, so a
  // component remount after the swap would otherwise re-announce the pruned
  // document and empty every panel again.
  const [deferredPatch, setDeferredPatch] = useState<Record<
    string,
    any
  > | null>(null)
  // const props = { data: exampleData }
  const nodes = useMemo(
    () =>
      deferredPatch && props.nodes
        ? { ...props.nodes, ...deferredPatch }
        : props.nodes,
    [props.nodes, deferredPatch],
  )
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

  // Withheld lazy-panel subtrees (AGL-1285). The server pruned the panels that
  // will not mount out of `nodes`; this fetches the whole document back and
  // swaps it in, the same wholesale replacement `unlockedNodes` and
  // `memberNodes` above already do.
  //
  // The trigger is a capture-phase listener on the document rather than
  // anything inside `muiTabs`, deliberately: the tabs component knows nothing
  // about deferral and should not start to. `pointerdown` gets the request
  // moving before the click that opens the panel resolves, and `click` and
  // `keydown` cover keyboard activation and anything synthetic — all three
  // funnel into one fetch that runs at most once.
  const deferralHost = props.deferral?.host
  const deferralSlug = props.deferral ? JSON.stringify(props.deferral.slug) : null
  useEffect(() => {
    if (!deferralHost || deferralSlug == null) return
    let active = true
    const load = () => {
      void (async () => {
        const payload = await fetchDeferredNodes(deferralHost, deferralSlug)
        if (!active || !payload) return
        setDeferredPatch(payload)
      })()
    }
    const onInteract = (event: Event) => {
      const target = event.target as Element | null
      if (typeof target?.closest === 'function' && target.closest('[role="tab"]')) {
        load()
      }
    }
    // `pointerover` is the head start: a cold fetch is a full server compose
    // and was measured at 3.8s, which is a long time to sit looking at an empty
    // panel. Hovering a tab is the earliest honest signal that someone is about
    // to open one, and it costs nothing on touch, where the pointer only
    // arrives with the press. The other three are the actual commitment —
    // keyboard activation and anything synthetic included.
    document.addEventListener('pointerover', onInteract, true)
    document.addEventListener('pointerdown', onInteract, true)
    document.addEventListener('click', onInteract, true)
    document.addEventListener('keydown', onInteract, true)
    return () => {
      active = false
      document.removeEventListener('pointerover', onInteract, true)
      document.removeEventListener('pointerdown', onInteract, true)
      document.removeEventListener('click', onInteract, true)
      document.removeEventListener('keydown', onInteract, true)
    }
  }, [deferralHost, deferralSlug])

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

  // The SEO head — title, description, social image, canonical, noindex — is
  // derived server-side in `buildMetadata`/`generateMetadata` (page.tsx). The
  // client twin that used to recompute all of it here fed only inert
  // `next/head` blocks and was deleted with them (AGL-1274).
  const host = props.data?.host
  const screen = props.data?.screen?.data

  // `pageData` carries whatever the site-page resolver already loaded on the
  // server for this path (AGL-659), so blocks can render their primary
  // content during SSR instead of fetching it in an effect.
  const site = useMemo(
    () => ({
      hostId: host?.$id,
      pageData: props.pageData as Record<string, unknown> | undefined,
    }),
    [host?.$id, props.pageData],
  )

  // Password-protected screens render an unlock form; the composed nodes
  // arrive from /api/protection/unlock after verification (AGL-87).
  // Membership sign-in/up/recovery (AGL-109/552): the theme-wrapped
  // built-in forms (AGL-553). A designated auth screen (host `authScreens`)
  // arrives WITH composed nodes and falls through to the normal canvas
  // render below instead.
  if (props.membershipPage && !nodes) {
    return (
      <MembershipPage
        page={props.membershipPage}
        hostId={props.data?.host?.$id}
      />
    )
  }

  // Maintenance mode without an assigned 503 screen (AGL-131).
  if (props.maintenanceFallback && !nodes) {
    return (
      <div style={{ maxWidth: 420, margin: '15vh auto', padding: 24 }}>
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
    return <AglynNodeRenderer node={Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)} />
  }

  // Members-only screens (AGL-109): prompt for sign-in until the session
  // cookie verifies and the nodes arrive.
  if (props.memberScreen && !memberNodes) {
    return (
      <div style={{ maxWidth: 420, margin: '15vh auto', padding: 24 }}>
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
    const formatDate = (value?: { seconds: number } | null) =>
      value ? new Date(value.seconds * 1000).toLocaleDateString() : ''
    // The cover through the ONE shared resolver (AGL-1407). A `media:`
    // reference becomes the CDN path for THIS site; a raw storage URL, an
    // AGL-175 relative CDN path and an author's own hotlinked URL all pass
    // through untouched, per the precedence documented in `media-ref.ts`.
    //
    // A site-RELATIVE result is correct on this surface, unlike `og:image`
    // (AGL-1337) or a manifest icon: a browser rendering the page has a base
    // URL to resolve it against. And a reference that does not parse resolves
    // to undefined, so the `<img>` is dropped rather than emitted with a
    // literal `src="media:…"`.
    const entryCover = Aglyn.resolveMediaSrc((entry as any)?.coverImage, {
      hostId: host?.$id,
    })
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
        {entry ? (
          <article>
            <h1>{entry.title}</h1>
            <p style={{ opacity: 0.7 }}>{formatDate(entry.publishedAt)}</p>
            {entryCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entryCover}
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
              // A numbered list (AGL-1320) — a real `<ol>`, so the markers are
              // the browser's and the author's `start` survives.
              if (block.type === 'orderedList') {
                return (
                  <ol key={index} start={block.start} style={{ lineHeight: 1.7 }}>
                    {block.items.map((item, i) => (
                      <li key={i}>{inline(item)}</li>
                    ))}
                  </ol>
                )
              }
              // A blockquote (AGL-1315). Without this it fell to the paragraph
              // case below and rendered as ordinary prose — no type error to
              // catch it, because a quote carries `inlines` like a paragraph.
              if (block.type === 'quote') {
                return (
                  <blockquote
                    key={index}
                    style={{
                      margin: '24px 0',
                      paddingLeft: 20,
                      borderLeft: '3px solid rgba(127, 127, 127, 0.4)',
                      fontStyle: 'italic',
                      lineHeight: 1.6,
                    }}
                  >
                    {inline(block.inlines)}
                  </blockquote>
                )
              }
              // Code blocks and tables (AGL-974) — both scroll instead of
              // wrapping, so a wide one never widens the article itself.
              if (block.type === 'code') {
                return (
                  <pre
                    key={index}
                    style={{
                      overflowX: 'auto',
                      padding: 16,
                      borderRadius: 8,
                      background: 'rgba(127, 127, 127, 0.12)',
                    }}
                  >
                    <code>{block.text}</code>
                  </pre>
                )
              }
              if (block.type === 'table') {
                return (
                  <div key={index} style={{ overflowX: 'auto' }}>
                    <table
                      style={{ borderCollapse: 'collapse', width: '100%' }}
                    >
                      <thead>
                        <tr>
                          {block.header.map((cell, i) => (
                            <th
                              key={i}
                              style={{
                                border: '1px solid rgba(127, 127, 127, 0.4)',
                                padding: '8px 12px',
                                textAlign: block.align[i] ?? 'left',
                                background: 'rgba(127, 127, 127, 0.12)',
                              }}
                            >
                              {inline(cell)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, i) => (
                              <td
                                key={i}
                                style={{
                                  border: '1px solid rgba(127, 127, 127, 0.4)',
                                  padding: '8px 12px',
                                  textAlign: block.align[i] ?? 'left',
                                }}
                              >
                                {inline(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
      {/* The `next/head` <Head> blocks that used to render the title,
          canonical, og:/twitter: meta and the noindex rule here were inert
          under the App Router — `next/head` is a no-op inside `app/`, so none
          of it ever shipped a byte (AGL-1274). The real head comes from the
          route's `generateMetadata` (page.tsx), which derives the same
          canonical (`hostPublicOrigin` + `screenRoutePathToUrl`) and asks the
          same `isPageIndexable` for robots/noindex (AGL-1263), for the screen,
          content, membership, maintenance, member-gate and protected branches
          alike. JSON-LD renders server-side via `buildJsonLd` (AGL-143). */}
      {/* Google Analytics (AGL-138/661): tenant-configured measurement id.
          This used to live inside an inert `next/head` <Head> block — so
          every site that configured GA collected nothing. `next/script`
          renders for real, and Next stamps it with the CSP nonce from the
          request header that middleware sets, so it keeps working when
          AGL-523 flips the policy from report-only to enforcing. */}
      {gaMeasurementId ? (
        <>
          <Script
            id="ga-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
          />
          <Script id="ga-init" strategy="afterInteractive">
            {'window.dataLayer=window.dataLayer||[];' +
              'function gtag(){dataLayer.push(arguments);}' +
              "gtag('js', new Date());" +
              `gtag('config', '${gaMeasurementId}');`}
          </Script>
        </>
      ) : null}
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
        // White-label badge (White-Label Phase 2): the "Made with …" credit
        // reads the org's resolved brand — product name, support URL, logo,
        // primary color — instead of the hard-coded Aglyn brand. `branding`
        // rides in from load-page-data via `resolveBrandingProfile`, the one
        // shared resolver, and falls back to the Aglyn defaults when absent
        // (non-white-label orgs, or surfaces that don't carry it), so this
        // can never drift or partly-render as Aglyn. `showBranding` still
        // decides whether the badge shows at all.
        (() => {
          const brand = props.branding ?? Aglyn.AGLYN_BRANDING_PROFILE
          // Same resolver as every other surface (AGL-1407). The org branding
          // card writes a typed URL today, which passes straight through; this
          // is what stops a picked `media:` reference reaching the badge as a
          // literal string once `logoUrl` is converted.
          const brandLogo = Aglyn.resolveMediaSrc(brand.logoUrl, {
            hostId: host?.$id,
          })
          return (
            <a
              href={brand.supportUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                position: 'fixed',
                bottom: 12,
                right: 12,
                zIndex: 2147483000,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'system-ui, sans-serif',
                color: '#fff',
                backgroundColor: brand.primaryColor ?? 'rgba(0, 0, 0, 0.72)',
                textDecoration: 'none',
              }}
            >
              {brandLogo ? (
                <img
                  src={brandLogo}
                  alt=""
                  aria-hidden
                  style={{ height: 14, width: 'auto', display: 'block' }}
                />
              ) : null}
              {`Made with ${brand.productName}`}
            </a>
          )
        })()
      ) : null}
    </Aglyn.ScreenLinkContext.Provider>
    </Aglyn.SiteContext.Provider>
  )
})

export default CatchAllPage
