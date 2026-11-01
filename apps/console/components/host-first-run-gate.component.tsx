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

import {
  readSiteBrandMissed,
  SITE_BRAND_MISSED_PARAM,
  siteBrandMissedNotice,
} from '@aglyn/aglyn/app-utils/site-brand-files'
import SiteLiveNotice from '@aglyn/shared-ui-jsx/components/site-live-notice.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import useCurrentOrg from '../hooks/use-current-org'
import { useHost } from '../hooks/use-host'
import { useOrgSlug } from '../hooks/use-org-scope'
import { buildRoute, Route } from '../constants/route-links'
import { readHostStarterChoice } from '@aglyn/aglyn/app-utils/site-styles'
import { hostIsBlankSite, hostLiveUrl, requestStarterSite } from '../utils/host-first-run'
import { useHostId, useHostSubdomain } from './host-id-provider'
import PluginWidgetSlot from './plugin-widget-slot.component'

/**
 * The query parameter site creation lands with (AGL-3596): `?start=site`
 * asks the `hostFirstRun` zone to offer the site's start, once.
 */
export const SITE_START_PARAM = 'start'
export const SITE_START_VALUE = 'site'
/**
 * The same parameter's other value (AGL-3761): a site "Create site" just made
 * with the starter lands with `?start=live`, which says "Your site is live",
 * once, as choosing the starter on a created site always has.
 */
export const SITE_START_LIVE_VALUE = 'live'
/**
 * Beside `?start=live`, the name of the starter a site was made from
 * (AGL-4049), as the create answered it, so "Your site is live" says what it
 * was made from. Shown only on a site whose own record says it was made from
 * a starter listing.
 */
export const SITE_LIVE_STARTER_PARAM = 'starterName'

/**
 * The guided start, offered where a new site LANDS and nowhere else.
 *
 * Asked for by creation alone — the parameter the create dialog adds — and
 * only while the site is still empty, so opening any page of an established
 * site never draws it, whatever this browser remembers. It used to sit on
 * Setup → Basic details and be gated on "nothing published", which every
 * site with drafts and no live page also satisfies, so it came back on every
 * visit to Setup.
 *
 * Choosing removes the parameter, so a reload or a back button does not ask
 * again. The starter is written by the server only on a site with no page
 * and no layout (`provisionStarterSite`), so it can never replace one.
 */
export function HostFirstRunGate() {
  const hostId = useHostId()
  const searchParams = useSearchParams()
  const asked = searchParams?.get(SITE_START_PARAM)
  const missed = searchParams?.get(SITE_BRAND_MISSED_PARAM)
  if (!hostId) return null
  return (
    <>
      {missed ? <SiteBrandMissedLanding named={missed} /> : null}
      {asked === SITE_START_LIVE_VALUE ? (
        <HostLiveLanding hostId={hostId} starterName={searchParams?.get(SITE_LIVE_STARTER_PARAM) ?? null} />
      ) : asked === SITE_START_VALUE ? (
        <HostFirstRunOffer hostId={hostId} />
      ) : null}
    </>
  )
}

/**
 * A create's notice, for a landing reached by a full page load (AGL-4119):
 * the files that did not make it, said once, and dropped from the address so a
 * reload does not say it again.
 */
function SiteBrandMissedLanding({ named }: { named: string }) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const said = useRef(false)
  useEffect(() => {
    if (said.current) return
    said.current = true
    const notice = siteBrandMissedNotice(readSiteBrandMissed(named))
    if (notice) enqueueSnackbar(notice, { variant: 'warning', persist: true, allowDuplicate: true })
    const rest = new URLSearchParams(searchParams?.toString() ?? '')
    rest.delete(SITE_BRAND_MISSED_PARAM)
    if (pathname) router.replace(rest.size ? `${pathname}?${rest.toString()}` : pathname)
  }, [enqueueSnackbar, named, pathname, router, searchParams])
  return null
}

/** "Your site is live", for a site born with the starter it was created for. */
function HostLiveLanding({ hostId, starterName }: { hostId: string; starterName: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(true)
  const close = useCallback(() => {
    setOpen(false)
    if (pathname) router.replace(pathname)
  }, [pathname, router])
  if (!open) return null
  return <HostLiveNotice hostId={hostId} onClose={close} starterName={starterName} />
}

/** The notice itself, read off the site's own document. */
function HostLiveNotice({
  hostId,
  onClose,
  starterName = null,
}: {
  hostId: string
  onClose: () => void
  starterName?: string | null
}) {
  const {
    doc: { data: host },
  } = useHost({ hostId })
  // The starter's name only for a site whose own record says it came from a
  // starter listing (AGL-4049): an address can say anything.
  const madeFromListing = Boolean(readHostStarterChoice(host?.['starterChoice'])?.listingId)
  const madeFrom = madeFromListing && starterName?.trim() ? starterName.trim().slice(0, 120) : null
  const orgSlug = useOrgSlug()
  const params = useParams<{ host?: string }>()
  const routeHost = params?.host ?? hostId
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-label="Your site is live">
      <DialogContent sx={{ py: 4 }}>
        <SiteLiveNotice
          liveUrl={hostLiveUrl(host)}
          pagesHref={orgSlug ? buildRoute(Route.HOST_SCREENS, { orgSlug, host: routeHost }) : null}
          starterName={madeFrom}
        />
      </DialogContent>
    </Dialog>
  )
}

function HostFirstRunOffer({ hostId }: { hostId: string }) {
  const {
    doc: { data: host, status },
  } = useHost({ hostId })
  const { orgId } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const subdomain = useHostSubdomain()
  const router = useRouter()
  const pathname = usePathname()
  const { data: user } = useUser()
  // Held in a ref so the request reads who is signed in, never the identity
  // of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const [open, setOpen] = useState(true)
  // The starter published the site: say so, with its address, until the
  // person closes it. Read before the blank-site check, which the starter
  // itself just turned false.
  const [live, setLive] = useState(false)

  const leaveUrl = useCallback(() => {
    if (pathname) router.replace(pathname)
  }, [pathname, router])
  const close = useCallback(() => {
    setOpen(false)
    leaveUrl()
  }, [leaveUrl])
  // Leaving the guided start for the starter site (AGL-3594), in the style
  // the person chose for it (AGL-4049). The `start` parameter stays until the
  // notice is closed: dropping it unmounts this.
  const startBlank = useCallback((options?: { style?: string }) => {
    setOpen(false)
    void requestStarterSite(userRef.current, hostId, { style: options?.style }).then((provisioned) => {
      if (provisioned) setLive(true)
      else leaveUrl()
    })
  }, [hostId, leaveUrl])
  const closeLive = useCallback(() => {
    setLive(false)
    leaveUrl()
  }, [leaveUrl])

  if (live) return <HostLiveNotice hostId={hostId} onClose={closeLive} />
  if (!open || status !== 'success' || !hostIsBlankSite(host)) return null
  return (
    <PluginWidgetSlot
      slot="hostFirstRun"
      hostId={hostId}
      orgId={orgId}
      orgSlug={orgSlug}
      host={subdomain ?? null}
      startBlank={startBlank}
      leave={close}
    />
  )
}

export default HostFirstRunGate
