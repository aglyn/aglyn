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

import type * as Aglyn from '@aglyn/aglyn/server'
import type { CollectionContent } from '@aglyn/tenant-runtime/get-collection-content'

/**
 * Composed page payload the server route hands to the client renderer
 * (unchanged from the former `getStaticProps` `Props`, AGL-398). Shared by
 * `load-page-data`, `page`, and `catch-all-client`.
 */
export interface Props {
  data: {
    host?: Aglyn.AglynHost
    screen?: {
      data?: Aglyn.AglynScreen
      version?: Aglyn.AglynScreenVersion
    }
  }
  nodes: Record<Aglyn.NodeId, Aglyn.NodeSchema> | null
  /**
   * Data a site-page resolver or enricher already loaded on the server for
   * this page, keyed by plugin (AGL-659). Reaches blocks through
   * `SiteContext.pageData` so they can render primary content during SSR
   * instead of fetching it in an effect, and feeds server-side structured
   * data (AGL-660).
   */
  pageData?: Record<string, unknown>
  /** Org-enabled site plugins the client must load pre-canvas (AGL-417). */
  enabledPlugins?: string[]
  /**
   * Trusted-realm marketplace installs (AGL-420): sha-pinned, staff-signed
   * bundles the client loads into the app realm after hydration.
   */
  realmPlugins?: Aglyn.RealmPluginInstall[]
  /** Free-tier "Made with Aglyn" badge (AGL-69, removeBranding gate). */
  showBranding?: boolean
  /**
   * Site-wide announcement bar (AGL-195): text already binding-resolved
   * server-side; `contentHash` keys the visitor's dismissal so edits
   * re-show the bar. Null when disabled or not entitled.
   */
  /**
   * Plugin page contributions (AGL-418/419): enricher-written slices the
   * plugin site runtimes read back (announcementBar, popup, experiments,
   * clientAutomations, automationOverlays, ...). Opaque to the app.
   */
  [pluginContribution: string]: unknown
  /** Collection list/entry payload when the path is content, not a screen. */
  content?: CollectionContent
  /** Password-protected screen: nodes withheld until unlock (AGL-87). */
  protectedScreen?: boolean
  /** Members-only screen (AGL-109): nodes arrive via /api/membership. */
  memberScreen?: boolean
  /** Membership form route (AGL-109/552): 'signin' | 'signup' | 'recover'. */
  membershipPage?: string
  /** Rendered as the custom not-found screen (noindex, AGL-87). */
  notFoundFallback?: boolean
  /** Maintenance mode (AGL-131): 503 screen or the built-in notice. */
  maintenanceFallback?: boolean
  /** Composed 401 screen nodes for members-only denials (AGL-131). */
  unauthorizedNodes?: Record<string, any> | null
}

/** Discriminated result of {@link Props} loading — mirrors the old
 * `getStaticProps` return shapes so the page can map them to
 * `notFound()` / `redirect()` / render. */
export type LoadResult =
  | { props: Props; revalidate?: number }
  | { notFound: true; revalidate?: number }
  | {
      redirect: { destination: string; statusCode?: number }
      revalidate?: number
    }
