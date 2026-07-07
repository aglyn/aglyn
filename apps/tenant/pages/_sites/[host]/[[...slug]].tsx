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
import { doc } from 'firebase/firestore'
import { observer } from 'mobx-react-lite'
import type { GetStaticPaths, GetStaticProps } from 'next/types'
import type { ParsedUrlQuery } from 'querystring'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useFirestoreDocData } from 'reactfire'
import Head from 'next/head'
import applyDuePublishSchedule from '../../../utils/apply-publish-schedule'
import composeScreenNodes from '../../../utils/compose-screen-nodes'
import getCollectionContent, {
  type CollectionContent,
} from '../../../utils/get-collection-content'
import getComponents from '../../../utils/get-components'
import getTenant from '../../../utils/get-tenant'
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
}

export const getStaticPaths: GetStaticPaths<StaticPathsCtx> = async (ctx) => {
  return {
    paths: [],
    fallback: 'blocking', // ISR server-render if static cache is not available
  }
}

const useHostRef = (id: string) => {
  const firestore = useFirestore()
  return doc(firestore, 'hosts', id)
}

const useHost = (id: string) => {
  const ref = useHostRef(id)
  return useFirestoreDocData(ref, { idField: '$id' })
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
      const notFoundScreenId = (hostRes.host as any)?.notFoundScreenId
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
      const tenantRes = await getTenant({ tenantId: hostRes.host.tenantId })
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
      return {
        props: JSON.parse(
          JSON.stringify({
            data: {
              host: hostRes.host,
              screen: { data: { ...screenRes.screen, protection: null } },
            },
            nodes: null,
            memberScreen: true,
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
    const tenantRes = await getTenant({ tenantId: hostRes.host.tenantId })
    const showBranding = Boolean(
      tenantRes.tenant?.plan &&
        !Aglyn.resolveTenantEntitlements(tenantRes.tenant).features
          .removeBranding,
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
      showBranding,
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
  useEffect(() => {
    if (!beaconHostId || typeof navigator === 'undefined') return
    try {
      navigator.sendBeacon(
        '/api/analytics/collect',
        JSON.stringify({
          hostId: beaconHostId,
          path: window.location.pathname,
        }),
      )
    } catch {
      // Analytics never breaks the page.
    }
  }, [beaconHostId])

  // Id-based screen links resolve against this routing map at render time;
  // ISR keeps it current (slug renames show up on the next revalidate).
  const screens = props.data?.host?.screens
  const screenLinks = useMemo(() => ({ screens }), [screens])

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
        <meta
          key="twitter:card"
          name="twitter:card"
          content={socialImage ? 'summary_large_image' : 'summary'}
        />
        {canonical ? (
          <link key="canonical" rel="canonical" href={canonical} />
        ) : null}
        {props.notFoundFallback || unlisted ? (
          <meta key="robots" name="robots" content="noindex" />
        ) : null}
      </Head>
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
