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
  buildRoute,
  Route,
  type ConsolePluginInstallStatusZoneProps,
} from '@aglyn/aglyn'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Alert, Button } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { resolveUpdateState, updateStateLabel } from '../model/update-state'

/**
 * How loudly each update state reads (AGL-1016). `unknown` and `ahead` are
 * warnings rather than neutral text: both mean the workspace is running
 * something the marketplace cannot vouch for right now.
 */
const UPDATE_SEVERITY = {
  current: 'success',
  'update-available': 'info',
  ahead: 'warning',
  unknown: 'warning',
} as const

/**
 * The version an installation runs, said plainly — the `pluginInstallStatus`
 * zone on the shell's installation page (AGL-1016, drawn here since
 * AGL-3080).
 *
 * The page knows the installation by its pin; whether the version pinned is
 * still what the publisher ships is a question about this plugin's listing
 * and its kill switch, so it is answered here. Read-only: applying an update
 * is the listing's, which the notice links to when there is one to apply.
 */
export function PluginInstallStatus(props: ConsolePluginInstallStatusZoneProps) {
  const { orgSlug, pluginRef, pin } = props
  const firestore = useFirestore()

  // The listing behind the pin. A public read, keyed by the pin's own id.
  const { data: listing } = useFirestoreDoc<any>(
    () => (pluginRef ? doc(firestore, 'marketplaceListings', pluginRef) : null),
    [firestore, pluginRef],
  )
  // The kill switch behind that listing (AGL-2368). A revoked version stays
  // `approved` — revocation does not clear a review verdict — so without this
  // the notice offered bytes `install-plugin` answers 409 to. Public read,
  // listing-scoped, one document.
  const { data: revocation } = useFirestoreDoc<any>(
    () => (pluginRef ? doc(firestore, 'revocations', pluginRef) : null),
    [firestore, pluginRef],
  )
  const status = useMemo(
    () => resolveUpdateState(pin as never, listing ?? null, 'plugin', revocation),
    [pin, listing, revocation],
  )

  return (
    <Alert
      severity={UPDATE_SEVERITY[status.state]}
      variant="outlined"
      action={
        status.state === 'update-available' ? (
          <AppLink
            href={buildRoute(Route.ORG_MARKETPLACE_LISTING, {
              orgSlug,
              listingId: pluginRef,
            })}
          >
            <Button size="small" color="inherit" component="span">
              {'View listing'}
            </Button>
          </AppLink>
        ) : undefined
      }
    >
      {updateStateLabel(status)}
    </Alert>
  )
}

export default PluginInstallStatus
