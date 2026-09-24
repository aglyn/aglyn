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
  useOrgDataScope,
  type OrgDataScope,
} from '@aglyn/tenant-feature-instance'
import { MenuItem, TextField } from '@mui/material'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * The organization the Emails page is mounted over, when it is mounted at the
 * ORGANIZATION level — `/[orgSlug]/emails` — rather than under one site.
 *
 * The audiences and the topics are the organization's, so those sections
 * render the same cards over the org. Everything else here is a SITE fact: a
 * template is a screen on one site, the sending identity and the suppression
 * list are one site's, and consent is recorded by one site. So the org page
 * reads those per site, a page of sites at a time, and asks which site
 * whenever it is about to write one.
 *
 * `null` under a site. A card branches on that and nothing else: a `hostId`
 * of `null` without a mount is a bug, not an org page.
 */
export interface EmailOrgMount extends ConsolePluginOrgMount {
  /** The org Emails page's own path, `/[orgSlug]/emails`. */
  basePath: string
  /**
   * The site a site-scoped action defaults to: the reader's last pick this
   * session, or the org's only site when it has exactly one, else `null`
   * until somebody picks. Nothing else is chosen silently — enrolling
   * somebody as the wrong site records consent under a brand that never met
   * them.
   */
  pickedHostId: string | null
  /** Records a pick for the rest of the session. */
  setPickedHostId: (hostId: string) => void
}

const EmailOrgMountContext = createContext<EmailOrgMount | null>(null)

/**
 * The session's memory of the picked site, per org. Session storage rather
 * than local, for the reason the CRM gives for its own: the pick is a working
 * convenience for one sitting, and a site remembered for weeks would default
 * an enrollment to a site the reader had forgotten choosing.
 */
const pickStorageKey = (orgId: string) => `aglyn.emails.site.${orgId}`

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
    // A browser that refuses storage still keeps the pick for this page.
  }
}

/** Publishes the org-level mount to every card beneath the Emails page. */
export function EmailOrgMountProvider(props: {
  mount: ConsolePluginOrgMount
  /** The org Emails page's own path. */
  basePath: string
  children: ReactNode
}) {
  const { mount, basePath, children } = props
  const { orgId, orgSlug, hosts, hostsReady, hostsPath, billingPath } = mount
  const [picked, setPicked] = useState<string | null>(null)
  // Read after mount rather than in the initializer, so the server and the
  // first client paint agree.
  useEffect(() => {
    setPicked(readRememberedPick(orgId))
  }, [orgId])

  /*
   * A remembered site the list no longer carries is forgotten rather than
   * used: the reader may have lost the site, or the site may be gone.
   */
  const pickedHostId = useMemo(() => {
    if (picked && hosts.some((host) => host.id === picked)) return picked
    if (hostsReady && hosts.length === 1) return hosts[0].id
    return null
  }, [picked, hosts, hostsReady])

  const setPickedHostId = useCallback(
    (hostId: string) => {
      setPicked(hostId)
      writeRememberedPick(orgId, hostId)
    },
    [orgId],
  )

  /*
   * Memoized because every card beneath reads it through context, and a fresh
   * object each render would re-render all of them for nothing.
   */
  const value = useMemo<EmailOrgMount>(
    () => ({
      orgId,
      orgSlug,
      hosts,
      hostsReady,
      hostsPath,
      billingPath,
      basePath,
      pickedHostId,
      setPickedHostId,
    }),
    [
      orgId,
      orgSlug,
      hosts,
      hostsReady,
      hostsPath,
      billingPath,
      basePath,
      pickedHostId,
      setPickedHostId,
    ],
  )
  return (
    <EmailOrgMountContext.Provider value={value}>
      {children}
    </EmailOrgMountContext.Provider>
  )
}
EmailOrgMountProvider.displayName = 'EmailOrgMountProvider'

/** The org mount, or `null` when the Emails page is mounted under a site. */
export function useEmailOrgMount(): EmailOrgMount | null {
  return useContext(EmailOrgMountContext)
}

/**
 * The `['orgs', orgId]` parent an org-shared card reads — the audiences and
 * the topics — at either level.
 *
 * Under a site it is the site's owning org, resolved through `hostIndex`, and
 * `scope` is null while that lookup is in flight. On the org page the mount
 * names the org and there is nothing to wait for.
 */
export function useEmailDataScope(
  hostId: string | null | undefined,
): OrgDataScope {
  const mount = useEmailOrgMount()
  return useOrgDataScope({
    hostId: hostId || undefined,
    orgId: hostId ? undefined : mount?.orgId || undefined,
  })
}

/** A site's display name from the mount, or its id when the mount lacks it. */
export function orgSiteName(
  mount: Pick<ConsolePluginOrgMount, 'hosts'> | null,
  hostId: string | null | undefined,
): string {
  if (!hostId) return ''
  const host = mount?.hosts.find((entry) => entry.id === hostId)
  return host?.name || host?.subdomain || hostId
}

/**
 * One site's own Emails page — `/[orgSlug]/hosts/{subdomain}/emails` — or a
 * section beneath it, or `null` when the site is not in the mount or has no
 * subdomain yet (such a site is named, never linked).
 *
 * What an org row links to for anything that stays a site fact: a template,
 * a site's sending identity, a site's suppression list.
 */
export function orgSiteEmailsPath(
  mount: Pick<ConsolePluginOrgMount, 'hosts' | 'hostsPath'> | null,
  hostId: string | null | undefined,
  section?: string,
): string | null {
  if (!mount || !hostId) return null
  const subdomain = mount.hosts.find((host) => host.id === hostId)?.subdomain
  if (!subdomain) return null
  const hub = `${mount.hostsPath}/${encodeURIComponent(subdomain)}/emails`
  return section ? `${hub}/${section}` : hub
}

/**
 * How many sites an org section reads at once, when what it shows is read
 * one site at a time.
 *
 * The same figure as the console's cross-site search fan-out: enough for the
 * organizations that actually run several sites to see all of them on one
 * page, and a ceiling on what one page costs for the agency that runs fifty.
 * It is a fixed page rather than a reader's choice of page size, because
 * every site on a page is a read of its own.
 */
export const ORG_SITES_PER_PAGE = 10

/**
 * The org's sites, one page of {@link ORG_SITES_PER_PAGE} at a time.
 *
 * Ordered by name so a page boundary falls somewhere a reader can predict.
 * Paged on the console's shared footer rather than grown by a button: the
 * site list grows with the organization like any other list, and a section
 * that read each new batch on top of the last would read without end.
 */
export function useOrgSitePage(mount: Pick<ConsolePluginOrgMount, 'hosts'>): {
  /** The sites on the current page. */
  sites: readonly ConsolePluginOrgHost[]
  page: number
  setPage: (page: number) => void
  pageSize: number
  /** Every site the org has. */
  count: number
} {
  const [page, setPage] = useState(0)
  const ordered = useMemo(
    () =>
      [...mount.hosts].sort((a, b) =>
        (a.name || a.subdomain || a.id).localeCompare(
          b.name || b.subdomain || b.id,
        ),
      ),
    [mount.hosts],
  )
  // A page past the end — the org lost sites while it was open — falls back
  // to the last page that has any.
  const lastPage = Math.max(
    0,
    Math.ceil(ordered.length / ORG_SITES_PER_PAGE) - 1,
  )
  const current = Math.min(page, lastPage)
  const sites = useMemo(
    () =>
      ordered.slice(
        current * ORG_SITES_PER_PAGE,
        (current + 1) * ORG_SITES_PER_PAGE,
      ),
    [ordered, current],
  )
  return {
    sites,
    page: current,
    setPage,
    pageSize: ORG_SITES_PER_PAGE,
    count: ordered.length,
  }
}

/** The footer's count line for a page of sites: `Sites 1–10 of 12`. */
export const orgSitePageLabel = (range: {
  from: number
  to: number
  count: number
}) => `Sites ${range.from}–${range.to} of ${range.count}`

/**
 * The picker every site-scoped action on the org page asks with.
 *
 * A pick is remembered for the session, so a reader enrolling people on three
 * audiences as the same site answers the question once.
 */
export function OrgSiteSelect(props: {
  mount: EmailOrgMount
  label: string
  value: string
  onChange: (hostId: string) => void
  helperText?: string
  /** Narrower than the org's whole list, when only some sites apply. */
  sites?: readonly ConsolePluginOrgHost[]
  disabled?: boolean
}) {
  const { mount, label, value, onChange, helperText, sites, disabled } = props
  const options = sites ?? mount.hosts
  return (
    <TextField
      select
      size="small"
      label={label}
      value={options.some((site) => site.id === value) ? value : ''}
      onChange={(event) => {
        const hostId = String(event.target.value)
        mount.setPickedHostId(hostId)
        onChange(hostId)
      }}
      helperText={helperText}
      disabled={disabled}
      sx={{ minWidth: 240, maxWidth: 420 }}
    >
      {options.map((site) => (
        <MenuItem key={site.id} value={site.id}>
          {site.name || site.subdomain || site.id}
        </MenuItem>
      ))}
    </TextField>
  )
}
OrgSiteSelect.displayName = 'OrgSiteSelect'
