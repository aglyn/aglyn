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
  /**
   * Whether this person may import here, for a resource that narrows who
   * may (gift cards: owners and admins, AGL-3551). The server asks again.
   */
  canImport?: boolean
}

/**
 * A commerce card's Import and Export, for its card header (AGL-3531): the
 * console's import wizard and export dialog on the card's resource, through
 * the core launcher. Import shows only for a resource a file may write, to a
 * person who may write it. Off
 * the console shell there is no launcher, and nothing renders.
 */
export function TransferHeaderActions(props: TransferHeaderActionsProps) {
  const { resource, hostId, noun, onImported, canImport = true } = props
  const transfer = useTransferLauncher()
  if (!transfer) return null
  const suffix = noun ? ` ${noun}` : ''
  return (
    <Stack direction="row" spacing={1}>
      {COMMERCE_IMPORTABLE_TRANSFERS.has(resource) && canImport ? (
        <Button
          size="small"
          onClick={() =>
            transfer.openImport({ resource, scope: 'host', hostId, ...(onImported ? { onFinished: onImported } : {}) })
          }
        >
          {`Import${suffix}`}
        </Button>
      ) : null}
      <Button size="small" onClick={() => transfer.openExport({ resource, scope: 'host', hostId })}>
        {`Export${suffix}`}
      </Button>
    </Stack>
  )
}
TransferHeaderActions.displayName = 'TransferHeaderActions'

export default TransferHeaderActions
