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
import { useEffect, useMemo } from 'react'
import { useFirestore, useFirestoreDocData } from 'reactfire'
import Head from 'next/head'
import applyDuePublishSchedule from '../../../utils/apply-publish-schedule'
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
  nodes: Record<Aglyn.NodeId, Aglyn.NodeSchema>
  /** Free-tier "Made with Aglyn" badge (AGL-69, removeBranding gate). */
  showBranding?: boolean
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
    const screenEntry = Object.entries(pathsByScreenId).find(([, slug]) => {
      return slug === path
    })
    console.debug('screenEntry', screenEntry)

    if (!Array.isArray(screenEntry)) {
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

    // Apply a due scheduled publication before resolving the version
    // (AGL-61): ISR revalidation doubles as the schedule executor.
    const effectiveVersionId = await applyDuePublishSchedule({
      hostId,
      collectionName: 'screens',
      docId: screenId,
      parent: screenRes.screen,
    })

    const versionRes = await getScreenVersion({
      hostId,
      screenId: screenId,
      versionId: effectiveVersionId ?? screenRes.screen.versionId,
    })
    console.debug('versionRes', versionRes)

    if (versionRes.error || !versionRes.version) {
      return {
        notFound: true,
        revalidate: 60, // never=false, always=1, since=SECONDS
      }
    }

    /*==========================================
     *
     * MARK - COMPOSE LAYOUT (SHARED CHROME)
     *
     *=========================================*/

    const layoutId = screenRes.screen.layoutId
    const layoutRes = layoutId
      ? await getPublishedLayoutVersion({ hostId, layoutId })
      : undefined
    console.debug('layoutRes', layoutRes)

    /*==========================================
     *
     * MARK - FORMAT NODES
     *
     *=========================================*/

    const composedNodes = Aglyn.composeLayoutAndScreenNodes(
      layoutRes?.version?.nodes,
      versionRes.version.nodes,
    )
    // Reusable components: graft each instance node's definition subtree
    // (fail-open — a missing/broken definition leaves an empty wrapper).
    const componentsRes = await getComponents({ hostId })
    const nodes = Aglyn.composeReusableComponentNodes(
      composedNodes as any,
      componentsRes.definitions as any,
    )
    const denormalized = Aglyn.canvas.processNodesToDenormalized(nodes as any)

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
          screen: {
            data: screenRes.screen,
            version: versionRes.version,
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
    Aglyn.emitter.emit(Aglyn.AglynEvent.NODE_SET_ITEMS, { nodes: nodes })
  }, [nodes])

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
        <meta key="twitter:card" name="twitter:card" content="summary" />
        {canonical ? (
          <link key="canonical" rel="canonical" href={canonical} />
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
