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

import { useCallback, useContext } from 'react'
import usePermissionsOnHost from '../hooks/use-permissions-on-host'
import useBranding from '../hooks/use-branding'
import useCurrentOrg from '../hooks/use-current-org'
import useOrgScope, { useOrgSlug } from '../hooks/use-org-scope'
import useReleaseFlags from '../hooks/use-release-flags'
import { useUrlNamesOrg } from '../hooks/use-secondary-nav'
import { HostIdContext } from './host-id-provider'
import type { ConsoleReleaseVerdict } from '@aglyn/aglyn'
import PluginWidgetSlot from './plugin-widget-slot.component'

/**
 * The console dock (AGL-2940): the `consoleDock` zone, mounted once above
 * every route boundary in both shells — a floating panel a plugin may draw
 * over any console page, such as an assistant — with the shell's own answers
 * handed down as props: which org the URL names and whether the membership
 * contradicts it, the site in view, the brand, the reader's plugin
 * permissions on that site, and a verdict for any release flag. A plugin
 * widget here reads no console hook; it renders what the shell resolved.
 *
 * `scopedOrgId` is the org a widget may speak for, act as, and be METERED
 * against — or `undefined` where the page named none (AGL-1130, AGL-1934).
 * `wrongOrg` is a POSITIVE contradiction only (AGL-1916): `slug` is optional
 * on the membership row, and a legacy row without one must not silence a
 * widget on a route that is perfectly legitimate.
 *
 * `releaseVerdict` answers for ANY flag the widget names (AGL-3080), with the
 * staff bypass applied the way `useReleaseFlag` applies it, so the shell
 * names no plugin's flag: the widget asks for its own.
 */
export default function ConsoleDockSlot() {
  const { flags, isStaff } = useReleaseFlags()
  const releaseVerdict = useCallback(
    (key: string): ConsoleReleaseVerdict => {
      const released = Boolean(
        (flags as Record<string, { released?: boolean } | undefined>)[key]?.released,
      )
      return { visible: released || isStaff, staffPreview: isStaff && !released }
    },
    [flags, isStaff],
  )
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  // A widget named after the product follows the brand (AGL-2319).
  // `useBranding` returns the deployment brand on any route the URL does not
  // scope to an org, which is every non-org console page.
  const { branding } = useBranding()
  const { pathOrgSlug, currentOrg } = useOrgScope()
  const namesOrg = useUrlNamesOrg()
  const wrongOrg = Boolean(
    pathOrgSlug && currentOrg?.slug && currentOrg.slug !== pathOrgSlug,
  )
  const scopedOrgId = namesOrg && !wrongOrg ? orgId : undefined
  const orgSlug = useOrgSlug()
  const hostId = useContext(HostIdContext)
  const permissionsOnHost = usePermissionsOnHost(hostId)
  return (
    <PluginWidgetSlot
      slot="consoleDock"
      orgId={orgId}
      org={org}
      orgReady={orgReady}
      scopedOrgId={scopedOrgId}
      orgSlug={orgSlug}
      hostId={hostId ?? null}
      productName={branding.productName}
      releaseVerdict={releaseVerdict}
      isStaff={isStaff}
      permissionsOnHost={permissionsOnHost}
    />
  )
}
