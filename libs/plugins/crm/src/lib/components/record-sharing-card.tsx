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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { mdiClose } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Button, Chip, IconButton, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useCrmSharingRules, useCrmSharingSites } from '../hooks/use-crm-sharing'
import type { CrmOrgDoc } from '../hooks/use-crm-scope'
import {
  CRM_SHARING_OBJECT_LABELS,
  type CrmShareChip,
  crmShareChipFor,
  crmShareChipLabel,
  type CrmSharingObject,
  describeRecordSharing,
  describeShareTargets,
} from '../model/crm-sharing'
import { callCrmSharing } from '../model/crm-sharing-api'
import { crmTaskCallScope } from '../model/task-routes'
import { useCanManageCrmSettings } from './settings-section'
import { ShareRecordsDialog } from './share-records-dialog'

/**
 * The chip a list row or a record header shows when this site sees the
 * record only because it was shared with it: "Shared by Dana".
 */
export function CrmShareChipView(props: {
  chip: CrmShareChip | null
  org: CrmOrgDoc
}) {
  const rules = useCrmSharingRules(props.org)
  if (!props.chip) return null
  return (
    <Chip
      size="small"
      variant="outlined"
      color="info"
      label={crmShareChipLabel(props.chip, rules)}
      sx={{ maxWidth: 220 }}
    />
  )
}
CrmShareChipView.displayName = 'CrmShareChipView'

export interface RecordSharingCardProps {
  object: CrmSharingObject
  id: string
  record: Readonly<Record<string, unknown>> | null | undefined
  /** The mounted site, or `null` at the organization level. */
  hostId: string | null
  orgId: string | null
  org: CrmOrgDoc
  /** The viewing site's consent-group sites, for "shared with this site". */
  viewingHostIds?: readonly string[]
}

const when = (atMs: number) => (atMs > 0 ? new Date(atMs).toLocaleDateString() : '')

/**
 * SHARING — where this record is visible, and why (AGL-3336).
 *
 * One line for the sites that hold it (its consent group, or the site that
 * created it), then one per hand share, naming who shared it and when, with
 * the one-click unshare, and one per sharing rule. The held line has no
 * unshare: visibility a site holds is not the sharing's to take away. A
 * rule's line is removed by editing the rule, in Settings.
 *
 * The header's "Share with sites…" is an org manager's, and so is the
 * unshare; every other reader sees the lines and nothing to press. For a
 * reader on a site that sees the record only through a read-only share,
 * the card says so, since the page's edits will be refused.
 */
export function RecordSharingCard(props: RecordSharingCardProps) {
  const { object, id, record, hostId, orgId, org, viewingHostIds = [] } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { canManage, ready: roleReady } = useCanManageCrmSettings(orgId ?? undefined)
  const sites = useCrmSharingSites({ hostId, orgId, enabled: canManage })
  const rules = useCrmSharingRules(org)
  const lines = useMemo(() => describeRecordSharing(record), [record])
  const chip = useMemo(() => crmShareChipFor(record, viewingHostIds), [record, viewingHostIds])
  const [sharing, setSharing] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const scope = crmTaskCallScope(hostId, orgId)
  const label = CRM_SHARING_OBJECT_LABELS[object]
  const shared = lines.some((line) => line.kind !== 'held')
  if (!record || (!shared && !(roleReady && canManage))) return null

  const unshare = async (key: string, token: string) => {
    if (!scope) return
    setBusyKey(key)
    try {
      await callCrmSharing(user, scope, 'unshare', {
        object,
        ids: [id],
        targets: token === 'org' ? 'all' : [token.slice('host:'.length)],
      })
      enqueueSnackbar('No longer shared', { variant: 'success', persist: false })
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusyKey(null)
    }
  }

  const heldLine = lines.find((line) => line.kind === 'held')
  const heldHostIds = heldLine?.kind === 'held' ? heldLine.hostIds : []
  return (
    <CardDisplay
      header={'Sharing'}
      help={pluginDocsHelp('crmSharing')}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action:
          roleReady && canManage ? (
            <Button variant="contained" size="small" onClick={() => setSharing(true)}>
              {'Share with sites…'}
            </Button>
          ) : null,
      }}
    >
      <Stack spacing={1.5}>
        {chip ? (
          <Typography variant="body2">
            {chip.access === 'edit'
              ? `Shared with this site to read and edit. ${crmShareChipLabel(chip, rules)}.`
              : `Shared with this site read-only: you can see this ${label.one} and log activity ` +
                `and tasks on it, but not change it. ${crmShareChipLabel(chip, rules)}.`}
          </Typography>
        ) : null}
        {lines.map((line) => {
          if (line.kind === 'held') {
            return (
              <Typography key="held" variant="body2" color="text.secondary">
                {line.allSites
                  ? 'Visible to every site in the organization.'
                  : line.hostIds.length
                    ? `Held by ${line.hostIds.map(sites.siteName).join(', ')} — where it was captured.`
                    : 'Held by no site.'}
              </Typography>
            )
          }
          if (line.kind === 'manual') {
            const target = describeShareTargets([line.token], sites.siteName)
            return (
              <Stack key={line.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                  {`${target} — shared by ${line.byName || 'a manager'}${
                    line.atMs ? ` on ${when(line.atMs)}` : ''
                  }, ${line.access === 'edit' ? 'read and edit' : 'read-only'}`}
                </Typography>
                {canManage ? (
                  <IconButton
                    size="small"
                    disabled={busyKey !== null}
                    onClick={() => void unshare(line.key, line.token)}
                  >
                    <MdiIcon path={mdiClose.path} size={0.7} />
                    <SrOnly>{`Stop sharing with ${target}`}</SrOnly>
                  </IconButton>
                ) : null}
              </Stack>
            )
          }
          const rule = rules.find((entry) => entry.id === line.ruleId)
          return (
            <Typography key={line.key} variant="body2">
              {`${describeShareTargets(line.tokens, sites.siteName)} — by the rule ${
                rule ? `“${rule.name}”` : 'that shares it'
              }, ${line.access === 'edit' ? 'read and edit' : 'read-only'}`}
            </Typography>
          )
        })}
        {!shared ? (
          <Typography variant="caption" color="text.secondary">
            {`Not shared with any other site. Sharing lets another site see this ${label.one}; it does not share the person's consent.`}
          </Typography>
        ) : null}
      </Stack>
      <ShareRecordsDialog
        open={sharing}
        onClose={() => setSharing(false)}
        object={object}
        ids={[id]}
        scope={scope}
        sites={sites.sites}
        sitesReady={sites.ready}
        heldHostIds={heldHostIds}
      />
    </CardDisplay>
  )
}
RecordSharingCard.displayName = 'RecordSharingCard'

/**
 * "Share with sites…" on a list's bulk bar (AGL-3336): the same dialog as
 * the record page, over the selection. Drawn for an org manager only.
 */
export function CrmBulkShareButton(props: {
  object: CrmSharingObject
  ids: readonly string[]
  hostId: string | null
  orgId: string | null
  disabled?: boolean
}) {
  const { object, ids, hostId, orgId, disabled } = props
  const { canManage, ready } = useCanManageCrmSettings(orgId ?? undefined)
  const sites = useCrmSharingSites({ hostId, orgId, enabled: canManage })
  const [open, setOpen] = useState(false)
  if (!ready || !canManage) return null
  return (
    <>
      <Button size="small" disabled={disabled || !ids.length} onClick={() => setOpen(true)}>
        {'Share with sites…'}
      </Button>
      <ShareRecordsDialog
        open={open}
        onClose={() => setOpen(false)}
        object={object}
        ids={ids}
        scope={crmTaskCallScope(hostId, orgId)}
        sites={sites.sites}
        sitesReady={sites.ready}
      />
    </>
  )
}
CrmBulkShareButton.displayName = 'CrmBulkShareButton'

export default RecordSharingCard
