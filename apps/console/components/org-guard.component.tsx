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

import { Box, CircularProgress } from '@mui/material'
import { notFound, usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useOrgScope } from '../hooks/use-org-scope'
import { useOrgReach, useReachableSites } from '../hooks/use-org-reach'
import { collaboratorRedirect } from '../utils/collaborator-navigation'

function GuardSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  )
}

/**
 * `/[orgSlug]/…` membership guard (AGL-621/AGL-625). The org in the URL must
 * be one the signed-in user belongs to. An unknown or non-member slug renders
 * the designed 404 (`notFound()`) — NEVER a sign-out (that was the cross-org
 * logout bug). A definitive answer is required first, so nothing happens while
 * memberships load.
 *
 * It also decides WHICH org pages a member may see (AGL-1032): a site
 * collaborator belongs to the org but not to it — they are redirected into
 * their site rather than shown org pages the AGL-1026 rules answer with
 * nothing. Guards are not the boundary; the rules are. This one makes the
 * console honest about what a collaborator can do, and nothing here should be
 * relied on for access control.
 */
export function OrgGuard({ children }: { children?: ReactNode }) {
  const { orgs, pathOrgSlug, loading, confirmed, slugExists } = useOrgScope()
  const known = !pathOrgSlug || orgs.some((org) => org.slug === pathOrgSlug)
  const pathname = usePathname()
  const router = useRouter()
  // A site collaborator gets their site, not the org (AGL-1032). Scoped is
  // only ever true on a RESOLVED membership — `orgWide` fails open while the
  // list loads, so without `ready` this would bounce every owner on a cold
  // load.
  const { orgWide, ready: reachReady } = useOrgReach()
  const scoped = Boolean(pathOrgSlug) && known && reachReady && !orgWide
  const { sites, ready: sitesReady } = useReachableSites(scoped)
  const target =
    scoped && sitesReady
      ? collaboratorRedirect(pathname, pathOrgSlug ?? '', sites)
      : null

  useEffect(() => {
    // `replace`, not `push`: the org URL they cannot open must not sit in
    // history for Back to walk into, which is a bounce loop.
    if (target) router.replace(target)
  }, [target, router])

  // A slug that DOES NOT EXIST is a 404 immediately, without waiting on
  // memberships (AGL-1149).
  //
  // `orgSlugs` is the only unconditionally public-read collection, so its
  // answer needs no membership and no fresh session — which is exactly why it
  // is the right authority here. Everything below waits for the membership
  // listener to be server-confirmed, and on a URL like `/orgs` that wait never
  // ended: reading a NON-EXISTENT org returns `permission-denied` (a missing
  // doc cannot satisfy a membership rule), the retry helper gave up after five
  // attempts and logged "the session is stale: signing out and back in is the
  // first thing to try", and the page span forever. The advice was wrong, the
  // session was fine, and a mistyped URL looked like a broken account — it
  // misdiagnosed the person reading the console AND the person debugging it.
  if (pathOrgSlug && slugExists === false) notFound()

  // Hold the child tree until memberships resolve to avoid flashing the 404
  // (or a foreign org's shell) before the slug is confirmed.
  if (loading) return <GuardSpinner />
  // A cache-served miss is NOT a confirmed miss (AGL-886, same class as
  // AGL-813/827/875): on a cold load the first snapshot can come from a
  // stale IndexedDB cache and false-404 a valid workspace. Only 404 once
  // the server has echoed the membership list; a hit renders immediately.
  if (!known && !confirmed) return <GuardSpinner />
  if (!known) notFound()
  // Hold the org page a collaborator is being moved off. The navigation is
  // async, so rendering it meanwhile shows exactly the empty Team/Billing
  // page this issue exists to stop them seeing — briefly, but that is the
  // frame people screenshot.
  if (scoped && (!sitesReady || target)) return <GuardSpinner />
  return <>{children}</>
}
OrgGuard.displayName = 'OrgGuard'

export default OrgGuard
