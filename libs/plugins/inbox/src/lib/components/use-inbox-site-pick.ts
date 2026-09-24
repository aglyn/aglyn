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

import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * The site the organization's Inbox is narrowed to (AGL-3303).
 *
 * `hostId` is `null` for every site at once — the default — or the one site
 * the reader picked, whose own view the page then draws: its submissions
 * with their form filter, its members beside its leads, its campaigns and
 * its ceiling notices. An organization with ONE site has nothing to choose
 * between, so that site is the pick and no picker is offered.
 */
export interface InboxSitePick {
  hostId: string | null
  /**
   * False until the remembered pick has been read and the org's sites have
   * settled. A section drawn before then would open the every-site reads for
   * a page about to switch to one site's, and bill both.
   */
  ready: boolean
  /** The sites to choose between, by name — empty when there is one or none. */
  options: ReadonlyArray<{ value: string; label: string }>
  setHostId: (hostId: string | null) => void
}

const NO_HOSTS: ConsolePluginOrgMount['hosts'] = []

/**
 * The session's memory of the pick, per org. Session storage, as the CRM's
 * create-site pick is kept: the section rail is a set of routes, so the page
 * mounts again on every section, and a filter that reset on each one would
 * read as the rail having thrown the reader's choice away.
 */
export const inboxSitePickKey = (orgId: string) => `aglyn.inbox.site.${orgId}`

function readPick(orgId: string): string | null {
  try {
    return window.sessionStorage.getItem(inboxSitePickKey(orgId))
  } catch {
    return null
  }
}

function writePick(orgId: string, hostId: string | null): void {
  try {
    if (hostId) window.sessionStorage.setItem(inboxSitePickKey(orgId), hostId)
    else window.sessionStorage.removeItem(inboxSitePickKey(orgId))
  } catch {
    // A browser that refuses storage still gets the pick for this page.
  }
}

/**
 * The org Inbox's site filter. Handed no mount — under a site — it answers
 * no pick and is never ready, and the page reads its own `hostId` instead.
 */
export function useInboxSitePick(
  mount: ConsolePluginOrgMount | undefined,
): InboxSitePick {
  const orgId = mount?.orgId ?? null
  const hosts = mount?.hosts ?? NO_HOSTS
  const hostsReady = Boolean(mount?.hostsReady)
  /*
   * Read after mount, not in the initializer, so the server and the first
   * client paint agree. Held with the org it was read for, so a switch of
   * workspace never applies one org's pick to another's sites.
   */
  const [memory, setMemory] = useState<{
    orgId: string
    hostId: string | null
  } | null>(null)
  useEffect(() => {
    if (orgId) setMemory({ orgId, hostId: readPick(orgId) })
  }, [orgId])
  const loaded = Boolean(orgId) && memory?.orgId === orgId

  const hostId = useMemo(() => {
    if (!hostsReady) return null
    if (hosts.length === 1) return hosts[0].id
    const remembered = loaded ? memory?.hostId : null
    // A remembered site the list no longer carries is forgotten, not read.
    return remembered && hosts.some((host) => host.id === remembered)
      ? remembered
      : null
  }, [hostsReady, hosts, loaded, memory])

  const options = useMemo(
    () =>
      hosts.length > 1
        ? hosts.map((host) => ({
            value: host.id,
            label: host.name || host.subdomain || host.id,
          }))
        : [],
    [hosts],
  )

  const setHostId = useCallback(
    (next: string | null) => {
      if (!orgId) return
      setMemory({ orgId, hostId: next })
      writePick(orgId, next)
    },
    [orgId],
  )

  return { hostId, ready: loaded && hostsReady, options, setHostId }
}

export default useInboxSitePick
