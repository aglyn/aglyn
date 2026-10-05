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
  TransferLauncherContext,
  type TransferExportLaunch,
  type TransferImportLaunch,
  type TransferLauncher,
} from '@aglyn/aglyn'
import { useUser } from '@aglyn/tenant-feature-instance'
import { resolveIdToken } from '@aglyn/shared-util-http/authorized-token'
import dynamic from 'next/dynamic'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useUrlNamedOrg } from '../hooks/use-url-names-org'

/** What the launcher has open. */
export type TransferLaunchState =
  | { kind: 'import'; launch: TransferImportLaunch }
  | { kind: 'export'; launch: TransferExportLaunch }

/**
 * The wizard, the dialog, the kit and the HTTP client, in a chunk the
 * browser fetches when a plugin first opens one: the provider sits in the
 * shell of every console page, and the kit is a large graph none of them
 * needs until then. `ssr: false` because nothing is open on a first paint.
 */
const TransferLauncherSurface = dynamic(
  () => import('./transfer-launcher-surface.component'),
  { ssr: false },
)

/**
 * The console's {@link TransferLauncher} (AGL-3539): a plugin calls
 * `useTransferLauncher()?.openImport(...)` or `.openExport(...)`, and the
 * shell opens the UI kit's wizard or dialog over the page, bound to the
 * workspace the URL names. Outside a workspace there is nothing to import
 * into, so nothing opens.
 */
export function TransferLauncherProvider({ children }: { children?: JSX.Children }) {
  const org = useUrlNamedOrg()
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [open, setOpen] = useState<TransferLaunchState | null>(null)

  const launcher = useMemo<TransferLauncher>(
    () => ({
      openImport: (launch) => setOpen({ kind: 'import', launch }),
      openExport: (launch) => setOpen({ kind: 'export', launch }),
      close: () => setOpen(null),
    }),
    [],
  )
  const getIdToken = useCallback(() => resolveIdToken(userRef.current), [])
  const orgId = org?.$id ?? null

  return (
    <TransferLauncherContext.Provider value={launcher}>
      {children}
      {open && orgId ? (
        <TransferLauncherSurface
          state={open}
          orgId={orgId}
          getIdToken={getIdToken}
          onClose={launcher.close}
        />
      ) : null}
    </TransferLauncherContext.Provider>
  )
}

export default TransferLauncherProvider
