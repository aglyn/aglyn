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

import { TransferResumeImport } from '@aglyn/aglyn/app-utils/transfer-resume-import'
import { useTransferLauncher } from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import { Button, Stack } from '@mui/material'
import { COMMERCE_IMPORTABLE_TRANSFERS } from './transfer-keys'

export interface TransferHeaderActionsProps {
  /** The commerce resource key (`transfer-keys.ts`). */
  resource: string
  hostId: string
  /** What the buttons name, when the card holds more than this resource ("categories"). */
  noun?: string
  /** Called when the person leaves the import wizard from its results. */
  onImported?(): void
}

/**
 * A commerce card's Import and Export, for its card header (AGL-3531): the
 * console's import wizard and export dialog on the card's resource, through
 * the core launcher. Each shows only when the launcher's `can` says the
 * person may (AGL-3554) — their access on the site, the resource's
 * `importRoles` (gift cards: a site's admins) and the workspace's plan —
 * and Import only for a resource a file may write. Off the console shell
 * there is no launcher, and nothing renders.
 */
export function TransferHeaderActions(props: TransferHeaderActionsProps) {
  const { resource, hostId, noun, onImported } = props
  const transfer = useTransferLauncher()
  if (!transfer) return null
  const target = { resource, scope: 'host' as const, hostId }
  const canImport = COMMERCE_IMPORTABLE_TRANSFERS.has(resource) && transfer.can('import', target)
  const canExport = transfer.can('export', target)
  if (!canImport && !canExport) return null
  const suffix = noun ? ` ${noun}` : ''
  return (
    <Stack direction="row" spacing={1}>
      {/* An import left unfinished, reopened where it stopped (AGL-3549). */}
      {canImport ? <TransferResumeImport target={target} {...(onImported ? { onFinished: onImported } : {})} /> : null}
      {canImport ? (
        <Button
          size="small"
          onClick={() =>
            transfer.openImport({ resource, scope: 'host', hostId, ...(onImported ? { onFinished: onImported } : {}) })
          }
        >
          {`Import${suffix}`}
        </Button>
      ) : null}
      {canExport ? (
        <Button size="small" onClick={() => transfer.openExport({ resource, scope: 'host', hostId })}>
          {`Export${suffix}`}
        </Button>
      ) : null}
    </Stack>
  )
}
TransferHeaderActions.displayName = 'TransferHeaderActions'

export default TransferHeaderActions
