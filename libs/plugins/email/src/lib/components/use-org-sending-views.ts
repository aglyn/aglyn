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
import {
  useSendingApi,
  type SendingIdentityView,
} from '@aglyn/tenant-feature-instance/hooks/use-sending-identity-api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** What the organization's page knows about each site's sending identity. */
export interface OrgSendingViews {
  /** Each site's identity, as the route resolved it, by site id. */
  views: Record<string, SendingIdentityView>
  /** The route's own refusal for a site whose identity could not be read. */
  errors: Record<string, string>
  /** Some site on the page has not answered yet. */
  loading: boolean
  /** Re-reads one site, or every site on the page. */
  reload: (hostId?: string) => Promise<void>
  /**
   * The first site that answered.
   *
   * The organization-wide half of every answer is the same whichever site is
   * asked — the org's domains, whether the reader may manage them, and whether
   * the plan carries a domain of the customer's own — so the page reads those
   * from here rather than asking the domains route a second time.
   */
  first: SendingIdentityView | null
}

/**
 * EACH SITE'S SENDING IDENTITY, for a page of the organization's sites.
 *
 * One `GET /api/email/sending-identity?hostId=` per site, because what a site
 * sends as is resolved per site — its selection, its senders and its issued
 * domain — through the same resolver the send path calls. It is the read the
 * site's own Sending section makes, once per site on a page, and never more:
 * paging asks for the sites not yet read, and a write re-reads only the site
 * it changed.
 *
 * The same response carries the organization's domains, which is why the page
 * has no second read for them. It is also why an editor can see the domains
 * here: the identity route's read gate is the site role, where the domains
 * route is owner-or-admin, and the site's own page shows editors the same
 * table read-only.
 */
export function useOrgSendingViews(
  sites: readonly ConsolePluginOrgHost[],
): OrgSendingViews {
  const call = useSendingApi()
  const [views, setViews] = useState<Record<string, SendingIdentityView>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(
    async (hostId: string) => {
      let failure = ''
      let view: SendingIdentityView | null = null
      try {
        const { response, payload } = await call({
          path: 'sending-identity',
          method: 'GET',
          query: { hostId },
        })
        if (response.ok) view = payload as SendingIdentityView
        else {
          failure =
            payload?.error ?? 'This site’s sending identity could not be read.'
        }
      } catch {
        failure = 'This site’s sending identity could not be read.'
      }
      if (!mounted.current) return
      if (view) {
        const answered = view
        setViews((current) => ({ ...current, [hostId]: answered }))
        setErrors((current) => {
          if (!(hostId in current)) return current
          const rest = { ...current }
          delete rest[hostId]
          return rest
        })
      } else {
        setErrors((current) => ({ ...current, [hostId]: failure }))
      }
    },
    [call],
  )

  useEffect(() => {
    for (const site of sites) {
      if (requested.current.has(site.id)) continue
      requested.current.add(site.id)
      void load(site.id)
    }
  }, [sites, load])

  const reload = useCallback(
    async (hostId?: string) => {
      await Promise.all(
        (hostId ? [hostId] : sites.map((site) => site.id)).map(load),
      )
    },
    [sites, load],
  )

  const loading = sites.some((site) => !views[site.id] && !errors[site.id])
  // The page on screen first, then any site read earlier: the org half of
  // the answer is the same from every site, and a page still loading must
  // not blank the domain table for the moment it takes.
  const first = useMemo(
    () =>
      sites.map((site) => views[site.id]).find((view) => Boolean(view)) ??
      Object.values(views)[0] ??
      null,
    [sites, views],
  )
  return { views, errors, loading, reload, first }
}
