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
'use client'

import type { ConsolePluginOrgHost } from '@aglyn/aglyn'
import { useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { createContext, useContext, type ReactNode } from 'react'

/**
 * The organization the Marketing hub is mounted over, when it is mounted at
 * the ORGANIZATION level rather than under one site.
 *
 * Campaigns, their sends and their sequence rollups belong to the org, so the
 * same cards render at `/[orgSlug]/marketing/…` over every site and at
 * `/[orgSlug]/hosts/[host]/marketing/…` over one. What differs at the org
 * level is that there is no site to take a sender, a design or a conversion
 * list from — so the page hands its cards the org and its sites instead, and
 * each card asks for them here rather than through a prop threaded down
 * every level of a detail page.
 *
 * `null` under a site. A card branches on that and nothing else: a
 * `hostId` of `null` without a mount is a bug, not an org page.
 */
export interface MarketingOrgMount {
  orgId: string
  orgSlug: string
  /** The org's sites, as the shell resolved them. */
  hosts: readonly ConsolePluginOrgHost[]
  /** False until `hosts` has settled; an empty list before then means nothing. */
  hostsReady: boolean
  /** `/[orgSlug]/hosts` — every site's own hub hangs beneath it. */
  hostsPath: string
  /** The org Marketing hub's own path, `/[orgSlug]/marketing`. */
  basePath: string
}

const MarketingOrgMountContext = createContext<MarketingOrgMount | null>(null)

export function MarketingOrgMountProvider(props: {
  value: MarketingOrgMount | null
  children: ReactNode
}) {
  return (
    <MarketingOrgMountContext.Provider value={props.value}>
      {props.children}
    </MarketingOrgMountContext.Provider>
  )
}

/** The org mount, or `null` when the hub is mounted under a site. */
export function useMarketingOrgMount(): MarketingOrgMount | null {
  return useContext(MarketingOrgMountContext)
}

/**
 * The org whose campaign collections a card reads, at either level.
 *
 * At the org level the mount names it and there is nothing to wait for. Under
 * a site it is the site's owning org, resolved through `hostIndex` — and
 * `ready` is false while that lookup is in flight, so a card that writes can
 * hold rather than build `orgs/null/…`.
 */
export function useMarketingOrgId(hostId: string | null | undefined): {
  orgId: string | null
  ready: boolean
} {
  const mount = useMarketingOrgMount()
  const { orgId, ready } = useOrgDataScope({
    hostId: hostId || undefined,
    orgId: mount?.orgId || undefined,
  })
  return { orgId: orgId ?? null, ready }
}

/** A site's display name from the mount, or its id when the mount lacks it. */
export function orgSiteName(
  mount: MarketingOrgMount | null,
  hostId: string | null | undefined,
): string {
  if (!hostId) return ''
  return mount?.hosts.find((host) => host.id === hostId)?.name || hostId
}

/**
 * One site's own hub for a plugin — `/[orgSlug]/hosts/{subdomain}/{slug}` —
 * or `null` when the site is not in the mount or has no subdomain yet.
 *
 * What an org page links to for anything that stays a SITE fact: a send's
 * template, a site's conversions list, the screens and forms filed under a
 * campaign.
 */
export function orgSiteHubPath(
  mount: MarketingOrgMount | null,
  hostId: string | null | undefined,
  pluginSlug: string,
): string | null {
  if (!mount || !hostId) return null
  const subdomain = mount.hosts.find((host) => host.id === hostId)?.subdomain
  return subdomain ? `${mount.hostsPath}/${subdomain}/${pluginSlug}` : null
}

/** The org's sites as picker options, by name. */
export function orgSiteOptions(
  mount: MarketingOrgMount,
): Array<{ value: string; label: string }> {
  return mount.hosts.map((host) => ({
    value: host.id,
    label: host.name || host.subdomain || host.id,
  }))
}

/**
 * The site the topic catalog is resolved through.
 *
 * Topics are the organization's, and the zone that reports them resolves the
 * org from a site. Under a site that is the site; on the org hub any of the
 * org's sites answers with the same catalog, so the first one is asked.
 */
export function topicCatalogHostId(
  hostId: string | null,
  mount: MarketingOrgMount | null,
): string {
  return hostId ?? mount?.hosts[0]?.id ?? ''
}
