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
  countCsvDataRows,
  type CrmExportResource,
} from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Button } from '@mui/material'
import { useSnackbar } from 'notistack'
import { useCallback, useState } from 'react'
import { downloadTextFile } from '../model/contacts-csv'

/** The header the export route promises its row count in. */
const EXPORT_ROWS_HEADER = 'X-Aglyn-Export-Rows'

export interface CrmExportAllButtonProps {
  /** Which table to take a complete copy of. */
  resource: CrmExportResource
  /** The organization whose records these are; null holds the button. */
  orgId: string | null
  /**
   * The site being read as.
   *
   * Required for contacts — the file is written through one holder's facet
   * and a facet is per site — and for a scoped reader's leads. Null at the
   * organization level, where an org-wide member takes every site's leads
   * in one file.
   */
  hostId: string | null
  disabled?: boolean
}

/**
 * EXPORT ALL — the whole collection, not the loaded window (AGL-2662).
 *
 * Beside "Export CSV", which writes the rows on screen. The two are
 * deliberately both offered and deliberately named apart: a selection's
 * file is what somebody just picked, and this is the audience.
 *
 * ## The response is checked, not trusted
 *
 * The route reports a `count()` aggregate in `X-Aglyn-Export-Rows`, taken
 * before its first page. A stream that dies halfway produces a perfectly
 * well-formed shorter file, and nothing about the bytes says it is short —
 * which is exactly how the window-sized export stayed invisible for as long
 * as it did. A body with fewer rows than promised is REFUSED rather than
 * saved, because a partial audience saved under a confident name is worse
 * than no file.
 */
export function CrmExportAllButton(props: CrmExportAllButtonProps) {
  const { resource, orgId, hostId, disabled } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)

  const handleExport = useCallback(async () => {
    if (!orgId || busy) return
    setBusy(true)
    try {
      const params = new URLSearchParams({ orgId, resource })
      if (hostId) params.set('hostId', hostId)
      const response = await authorizedFetch(
        user,
        `/api/crm/export?${params.toString()}`,
      )
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}))
        throw new Error(failure?.error ?? 'Export failed')
      }
      const text = await response.text()
      const promised = Number(response.headers.get(EXPORT_ROWS_HEADER) ?? '')
      const received = countCsvDataRows(text)
      if (Number.isFinite(promised) && received < promised) {
        enqueueSnackbar(
          `Export incomplete — ${received} of ${promised} rows arrived. ` +
            'Nothing was saved; try again.',
          { variant: 'error' },
        )
        return
      }
      downloadTextFile(`${resource}.csv`, 'text/csv', text)
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error ? error.message : 'Export failed',
        { variant: 'error' },
      )
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, resource, user, busy, enqueueSnackbar])

  return (
    <Button
      size="small"
      disabled={disabled || busy || !orgId}
      onClick={() => void handleExport()}
    >
      {busy ? 'Exporting…' : 'Export all…'}
    </Button>
  )
}
CrmExportAllButton.displayName = 'CrmExportAllButton'

export default CrmExportAllButton
