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

import type { ConsolePluginOrgHost, ConsolePluginOrgMount } from '@aglyn/aglyn'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/**
 * The organization-level mount, as every CRM surface beneath the hub reads
 * it (AGL-2630).
 *
 * The shell hands the hub page an org and its sites; the hub publishes them
 * through this context so a drawer four components down — the one that has
 * to ask which site a new record is captured by — reaches them without four
 * components threading a prop they never read. `useCrmScope` reads it too:
 * a surface handed `hostId: null` learns from here which org it is under,
 * which is what lets every existing `useCrmScope({ hostId, org })` call
 * serve the org level unchanged.
 */
export interface CrmOrgMount extends ConsolePluginOrgMount {
  /**
   * The site the next create stamps from: the reader's last pick this
   * session, or the org's only site when it has exactly one, else `null`
   * until somebody picks. A record is always captured BY a site — its
   * `hostId`, its `visibleTo`, the consent group its profile lives on all
   * come from one — and at the org level nothing else can say which.
   */
  createHostId: string | null
  setCreateHostId: (hostId: string) => void
  /** How a site reads on screen — its name, or its id when the list cannot name it. */
  siteName: (hostId: string) => string
  /**
   * The subdomain a console URL under `/hosts/[host]` takes, or `null` for
   * a site the list did not answer for — named, never linked.
   */
  siteSubdomain: (hostId: string) => string | null
  /**
   * The site's own CRM hub — `${hostsPath}/${subdomain}/crm` — or `null`
   * for a site whose subdomain the list could not answer, which is named
   * and not linked.
   */
  siteHubHref: (hostId: string) => string | null
}

const CrmOrgMountContext = createContext<CrmOrgMount | null>(null)

/**
 * The session's memory of the picked site, per org. Session storage rather
 * than local: the pick is a working convenience for one sitting, and a
 * site remembered across weeks would stamp a record onto a site the reader
 * had forgotten choosing.
 */
const pickStorageKey = (orgId: string) => `aglyn.crm.createSite.${orgId}`

function readRememberedPick(orgId: string): string | null {
  try {
    return window.sessionStorage.getItem(pickStorageKey(orgId))
  } catch {
    return null
  }
}

function writeRememberedPick(orgId: string, hostId: string): void {
  try {
    window.sessionStorage.setItem(pickStorageKey(orgId), hostId)
  } catch {
    // A browser that refuses storage still gets the pick for this page.
  }
}

/**
 * Publishes the org-level mount to every surface beneath it.
 *
 * Mounted by the hub page ONLY when the shell handed it an `orgMount`; under
 * a site there is no provider and `useCrmOrgMount` answers `null`, which is
 * how a surface tells the two levels apart without a second prop.
 */
export function CrmOrgMountProvider(props: {
  mount: ConsolePluginOrgMount
  children: ReactNode
}) {
  const { mount, children } = props
  const { orgId, hosts, hostsReady, hostsPath } = mount
  const [picked, setPicked] = useState<string | null>(null)
  // Read after mount rather than in the initializer, so the server and the
  // first client paint agree: the pick only ever affects a drawer somebody
  // has since opened.
  useEffect(() => {
    setPicked(readRememberedPick(orgId))
  }, [orgId])

  const byId = useMemo(() => {
    const index = new Map<string, ConsolePluginOrgHost>()
    for (const host of hosts) index.set(host.id, host)
    return index
  }, [hosts])

  /*
   * A remembered site the list no longer carries is forgotten rather than
   * stamped — the reader may have lost the site, or the site may be gone.
   * An org with exactly one site needs no picker at all; nothing else is
   * picked silently, because a wrong guess files a person under a brand
   * that never met them.
   */
  const createHostId = useMemo(() => {
    if (picked && byId.has(picked)) return picked
    if (hostsReady && hosts.length === 1) return hosts[0].id
    return null
  }, [picked, byId, hostsReady, hosts])

  const setCreateHostId = useCallback(
    (hostId: string) => {
      setPicked(hostId)
      writeRememberedPick(orgId, hostId)
    },
    [orgId],
  )
  const siteName = useCallback(
    (hostId: string) => byId.get(hostId)?.name || hostId,
    [byId],
  )
  const siteSubdomain = useCallback(
    (hostId: string) => byId.get(hostId)?.subdomain ?? null,
    [byId],
  )
  const siteHubHref = useCallback(
    (hostId: string) => {
      const subdomain = byId.get(hostId)?.subdomain
      return subdomain ? `${hostsPath}/${encodeURIComponent(subdomain)}/crm` : null
    },
    [byId, hostsPath],
  )

  const value = useMemo<CrmOrgMount>(
    () => ({
      orgId,
      hosts,
      hostsReady,
      hostsPath,
      createHostId,
      setCreateHostId,
      siteName,
      siteSubdomain,
      siteHubHref,
    }),
    [
      orgId,
      hosts,
      hostsReady,
      hostsPath,
      createHostId,
      setCreateHostId,
      siteName,
      siteSubdomain,
      siteHubHref,
    ],
  )
  return (
    <CrmOrgMountContext.Provider value={value}>
      {children}
    </CrmOrgMountContext.Provider>
  )
}
CrmOrgMountProvider.displayName = 'CrmOrgMountProvider'

/** The org-level mount, or `null` under a site. */
export function useCrmOrgMount(): CrmOrgMount | null {
  return useContext(CrmOrgMountContext)
}

/**
 * THE SITE A CREATE OPENED FROM A RECORD DEFAULTS TO (AGL-2630).
 *
 * A task, an activity or a deal filed from a contact's page belongs, nine
 * times in ten, with the site that captured the contact — not with the
 * site the reader last picked in a list's drawer. So a record page wraps
 * its cards in this, naming its record's own capturing site, and every
 * create under it defaults its Site picker there. A pick the reader makes
 * INSIDE such a create is held for that page alone; the session's pick,
 * which a create opened from a list keeps defaulting to, is untouched.
 *
 * Nothing under a site, nothing for a record no site has captured, and
 * nothing for a site the mount's list does not carry — the reader may not
 * have it: the children render as they are and the session's pick stands.
 */
export function CrmCreateSiteDefault(props: {
  hostId: string | null | undefined
  children: ReactNode
}) {
  const { hostId, children } = props
  const mount = useContext(CrmOrgMountContext)
  const [picked, setPicked] = useState<string | null>(null)
  // Another record on the same page starts from its own site again.
  useEffect(() => {
    setPicked(null)
  }, [hostId])
  const value = useMemo<CrmOrgMount | null>(() => {
    if (!mount || !hostId) return mount
    if (!mount.hosts.some((host) => host.id === hostId)) return mount
    return {
      ...mount,
      createHostId: picked ?? hostId,
      setCreateHostId: setPicked,
    }
  }, [mount, hostId, picked])
  return (
    <CrmOrgMountContext.Provider value={value}>
      {children}
    </CrmOrgMountContext.Provider>
  )
}
CrmCreateSiteDefault.displayName = 'CrmCreateSiteDefault'

export default useCrmOrgMount
