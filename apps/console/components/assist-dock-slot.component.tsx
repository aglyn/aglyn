'use client'

import { useContext } from 'react'
import useAiPermissions from '../hooks/use-ai-permissions'
import useBranding from '../hooks/use-branding'
import useCurrentOrg from '../hooks/use-current-org'
import useOrgScope, { useOrgSlug } from '../hooks/use-org-scope'
import useReleaseFlags, { useReleaseFlag } from '../hooks/use-release-flags'
import { useUrlNamesOrg } from '../hooks/use-secondary-nav'
import { HostIdContext } from './host-id-provider'
import PluginWidgetSlot from './plugin-widget-slot.component'

/**
 * The assistant dock (AGL-2940): the `assistPanel` zone, mounted once above
 * every route boundary in both shells, with the shell's own answers handed
 * down as props — which org the URL names and whether the membership
 * contradicts it, the site in view, the brand, the release verdicts and
 * the reader's AI permissions. A plugin widget here reads no console hook;
 * it renders what the shell resolved.
 *
 * `scopedOrgId` is the org a widget may speak for, act as, and be METERED
 * against — or `undefined` where the page named none (AGL-1130, AGL-1934).
 * `wrongOrg` is a POSITIVE contradiction only (AGL-1916): `slug` is optional
 * on the membership row, and a legacy row without one must not silence the
 * assistant on a route that is perfectly legitimate.
 */
export default function AssistDockSlot() {
  const assist = useReleaseFlag('release_assist')
  const generative = useReleaseFlag('release_ai_generative')
  const { isStaff } = useReleaseFlags()
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  // The assistant is named after the product, so its name follows the brand
  // (AGL-2319). `useBranding` returns the deployment brand on any route the
  // URL does not scope to an org, which is every non-org console page.
  const { branding } = useBranding()
  const { pathOrgSlug, currentOrg } = useOrgScope()
  const namesOrg = useUrlNamesOrg()
  const wrongOrg = Boolean(
    pathOrgSlug && currentOrg?.slug && currentOrg.slug !== pathOrgSlug,
  )
  const scopedOrgId = namesOrg && !wrongOrg ? orgId : undefined
  const orgSlug = useOrgSlug()
  const hostId = useContext(HostIdContext)
  const aiPermissions = useAiPermissions(hostId)
  return (
    <PluginWidgetSlot
      slot="assistPanel"
      orgId={orgId}
      org={org}
      orgReady={orgReady}
      scopedOrgId={scopedOrgId}
      orgSlug={orgSlug}
      hostId={hostId ?? null}
      productName={branding.productName}
      assistVisible={assist.visible}
      assistStaffPreview={assist.staffPreview}
      generativeVisible={generative.visible}
      isStaff={isStaff}
      aiPermissions={aiPermissions}
    />
  )
}
