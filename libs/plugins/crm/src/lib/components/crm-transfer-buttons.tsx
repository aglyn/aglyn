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

/*==========================================
 * IMPORT AND EXPORT, FROM ANY CRM LIST (AGL-3527).
 *
 * The CRM never draws the wizard or the dialog itself: the console does,
 * and hands the plugin a launcher (`useTransferLauncher`). These buttons are
 * all a list needs — Import opens the wizard on the list's resource, Export
 * the field-picking dialog on its selection, its filter or everything.
 * Outside the console shell there is no launcher, and no button.
 *
 * At the organization level an import is filed under a site, as every CRM
 * create is (AGL-2630): with one site it is that one, with several the
 * button asks first, remembering the pick for the session like every other
 * create.
 *=========================================*/

import { useTransferLauncher } from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import type { ListQueryPlan } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useCrmOrgMount } from '../hooks/use-crm-org-mount'
import { CrmSitePicker } from './crm-site-picker'

/** A list's served query as an export's filter: its predicates and its order, dates kept as dates. */
export function crmExportFilterOf(plan: Pick<ListQueryPlan, 'filters' | 'orderBy'>): Record<string, unknown> {
  const value = (raw: unknown): unknown =>
    raw instanceof Date ? { $date: raw.toISOString() } : Array.isArray(raw) ? raw.map(value) : raw
  return {
    filters: plan.filters.map((filter) => ({ path: filter.path, op: filter.op, value: value(filter.value) })),
    orderBy: { path: plan.orderBy.path, direction: plan.orderBy.direction },
  }
}

export interface CrmImportButtonProps {
  /** The resource key the CRM declared (`crm.contacts`). */
  resource: string
  /** What one batch is called in a sentence ("contacts"). */
  noun: string
  /** The site the list is read under, or `null` at the organization level. */
  hostId: string | null
  /** What the `importMapping` zone's widgets know the file as (`contacts`). */
  mappingZone?: string
  label?: string
}

/** Opens the import wizard on a CRM resource, under the list's site or one the reader picks. */
export function CrmImportButton(props: CrmImportButtonProps) {
  const { resource, noun, hostId, mappingZone, label = 'Import' } = props
  const transfer = useTransferLauncher()
  const mount = useCrmOrgMount()
  const [asking, setAsking] = useState(false)
  // Importing needs "Manage data" (AGL-3546); a reader sees no Import.
  if (!transfer?.can('import', { resource, scope: 'org', hostId })) return null

  const open = (site: string) =>
    transfer.openImport({ resource, scope: 'org', hostId: site, ...(mappingZone ? { mappingZone } : {}) })

  const site = hostId ?? mount?.createHostId ?? null
  return (
    <>
      <Button
        size="small"
        onClick={() => {
          if (site && (hostId || (mount?.hostsReady && mount.hosts.length === 1))) open(site)
          else setAsking(true)
        }}
      >
        {label}
      </Button>
      <Dialog open={asking} onClose={() => setAsking(false)} aria-labelledby={`${resource}-import-site`}>
        <DialogTitle id={`${resource}-import-site`}>{`Import ${noun}`}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {`Every new record is filed under a site — it decides which of your sites may see the ${noun}.`}
          </Typography>
          <CrmSitePicker hostId={null} helperText={`The site these ${noun} are imported into.`} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(false)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={!mount?.createHostId}
            onClick={() => {
              setAsking(false)
              if (mount?.createHostId) open(mount.createHostId)
            }}
          >
            {'Continue'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
CrmImportButton.displayName = 'CrmImportButton'

export interface CrmExportButtonProps {
  resource: string
  /** The site the list is read under, or `null` at the organization level. */
  hostId: string | null
  /** The rows the reader ticked; the dialog offers exporting just these. */
  selection?: readonly string[]
  /** The list's filter, when one is applied: a name for it and its served query. */
  filter?: { label: string; plan: Pick<ListQueryPlan, 'filters' | 'orderBy'> } | null
  label?: string
  disabled?: boolean
}

/** Opens the export dialog on a CRM resource: the selection, the list's filter, or every record. */
export function CrmExportButton(props: CrmExportButtonProps) {
  const { resource, hostId, selection, filter, label = 'Export…', disabled } = props
  const transfer = useTransferLauncher()
  if (!transfer?.can('export', { resource, scope: 'org', hostId })) return null
  return (
    <Button
      size="small"
      disabled={disabled}
      onClick={() =>
        transfer.openExport({
          resource,
          scope: 'org',
          hostId,
          ...(selection?.length ? { selection } : {}),
          ...(filter ? { filter: { label: filter.label, value: crmExportFilterOf(filter.plan) } } : {}),
        })
      }
    >
      {label}
    </Button>
  )
}
CrmExportButton.displayName = 'CrmExportButton'
