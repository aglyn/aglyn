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
  CONTACT_LIFECYCLE_STAGE_LABELS,
  type ContactLifecycleStage,
  CRM_LEAD_STATUS_LABELS,
  type CrmLeadStatus,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { mdiDeleteOutline, mdiPencilOutline, mdiRefresh } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  LinearProgress,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import { useCrmCampaigns } from '../hooks/use-crm-campaigns'
import { useCrmSharingRules, useCrmSharingSites } from '../hooks/use-crm-sharing'
import { useLeadSourcePicklist } from '../hooks/use-lead-source-picklist'
import type { CrmOrgDoc } from '../hooks/use-crm-scope'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import {
  CRM_SHARING_RULES_MAX,
  type CrmSharingAction,
  type CrmSharingRule,
  describeShareTargets,
  describeSharingRuleScope,
} from '../model/crm-sharing'
import { callCrmSharing } from '../model/crm-sharing-api'
import { SharingRuleDrawer, type SharingRuleDraft } from './sharing-rule-drawer'

export interface SharingRulesCardProps {
  orgId: string | null
  org: CrmOrgDoc
  canManage: boolean
  ready: boolean
}

/** How far a rule's recompute has got, as the table shows it. */
function runLabel(rule: CrmSharingRule): string {
  const run = rule.run
  if (rule.deleting) return 'Removing what it shared…'
  if (!run) return rule.enabled ? 'On' : 'Off'
  if (run.status === 'running') {
    return `${run.mode === 'remove' ? 'Removing' : 'Applying'} — ${run.processed} checked, ${run.changed} changed`
  }
  if (run.status === 'failed') return run.error ?? 'Stopped'
  return `${rule.enabled ? 'On' : 'Off'} — ${run.changed} ${run.changed === 1 ? 'record' : 'records'} changed`
}

/**
 * SHARING RULES — the organization's automated sharing (AGL-3336).
 *
 * A rule shares every record it matches with other sites: the existing ones
 * through a recompute that runs when the rule is saved, with its progress
 * on the row, and every later capture or change through the record-written
 * seam. The recompute runs in passes; the card keeps asking while the page
 * is open, and a rule whose run stopped offers Resume.
 *
 * Mounted at the organization level only: a rule is a fact about the org,
 * and its targets are the org's sites.
 */
export function SharingRulesCard(props: SharingRulesCardProps) {
  const { orgId, org, canManage, ready } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const rules = useCrmSharingRules(org)
  const sites = useCrmSharingSites({ hostId: null, orgId, enabled: canManage })
  const roster = useOrgMemberDirectory(orgId)
  const campaigns = useCrmCampaigns({ hostId: null, orgId }, { enabled: canManage })
  // The values the Lead source criterion picks from, under their groups (AGL-3511).
  const leadSources = useLeadSourcePicklist(canManage ? orgId : null)
  const [editing, setEditing] = useState<CrmSharingRule | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const scope = orgId ? { orgId } : null

  /** One action, then `rule-continue` until the rule's run has nothing left. */
  const run = useCallback(
    async (action: CrmSharingAction, body: Record<string, unknown>, said: string) => {
      if (!scope) return
      setBusy(true)
      try {
        let answer = await callCrmSharing(user, scope, action, body)
        const ruleId = answer.rule?.id ?? String(body['ruleId'] ?? '')
        while (answer.more && ruleId) {
          answer = await callCrmSharing(user, scope, 'rule-continue', { ruleId })
        }
        enqueueSnackbar(said, { variant: 'success', persist: false })
        setDrawerOpen(false)
      } catch (error) {
        enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
      } finally {
        setBusy(false)
      }
    },
    // `scope` is rebuilt from `orgId` every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, orgId, enqueueSnackbar],
  )

  const save = (draft: SharingRuleDraft) =>
    void run('rule-save', { rule: draft }, draft.id ? 'Rule saved' : 'Rule added')

  const canEdit = ready && canManage && !busy
  const stageLabel = (id: string) =>
    CRM_LEAD_STATUS_LABELS[id as CrmLeadStatus] ??
    CONTACT_LIFECYCLE_STAGE_LABELS[id as ContactLifecycleStage] ??
    id
  return (
    <CardDisplay
      header={'Sharing rules'}
      help={pluginDocsHelp('crmSharing', { anchor: '#sharing-rules' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: (
          <Button
            variant="contained"
            disabled={!canEdit || rules.length >= CRM_SHARING_RULES_MAX}
            onClick={() => {
              setEditing(null)
              setDrawerOpen(true)
            }}
          >
            {'Add rule'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Share leads, contacts, companies or deals captured on one site with other sites, ' +
            'automatically. A rule applies to the records you have now and to every one captured ' +
            'or changed later. Sharing is visibility only: a site never gains a person’s consent ' +
            'through it.'}
        </Typography>
        {busy ? <LinearProgress /> : null}
        {rules.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No sharing rules. Every record is visible only to the sites that captured it.'}
          </Typography>
        ) : (
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Rule'}</TableCell>
                <TableCell>{'Which records'}</TableCell>
                <TableCell>{'Shared with'}</TableCell>
                <TableCell>{'Status'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id} hover>
                  <TableCell>
                    <Typography variant="body2">{rule.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {describeSharingRuleScope(rule, sites.siteName, {
                        owner: roster.nameOf,
                        stage: stageLabel,
                      })}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {`${describeShareTargets(rule.targets, sites.siteName)}, ${
                        rule.access === 'edit' ? 'read and edit' : 'read-only'
                      }`}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {runLabel(rule)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ width: 56 }}>
                    <RowActionsMenu
                      label={rule.name}
                      items={[
                        {
                          key: 'edit',
                          label: 'Edit rule',
                          icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
                          disabled: !canEdit || rule.deleting === true,
                          onClick: () => {
                            setEditing(rule)
                            setDrawerOpen(true)
                          },
                        },
                        ...(rule.run && rule.run.status !== 'done'
                          ? [
                              {
                                key: 'resume',
                                label: 'Resume',
                                icon: <MdiIcon path={mdiRefresh.path} size={0.8} />,
                                disabled: !canEdit,
                                onClick: () =>
                                  void run('rule-continue', { ruleId: rule.id }, 'Rule applied'),
                              },
                            ]
                          : []),
                        {
                          key: 'delete',
                          label: 'Delete rule',
                          icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
                          destructive: true,
                          disabled: !canEdit,
                          onClick: () =>
                            void run('rule-delete', { ruleId: rule.id }, 'Rule deleted'),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        )}
        {ready && !canManage ? (
          <Typography variant="caption" color="text.secondary">
            {'Only a workspace owner or admin can change sharing rules.'}
          </Typography>
        ) : null}
      </Stack>
      <SharingRuleDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        rule={editing}
        sites={sites.sites}
        members={roster.members}
        campaigns={campaigns.options}
        leadSourceList={leadSources.picklist}
        busy={busy}
        onSubmit={save}
      />
    </CardDisplay>
  )
}
SharingRulesCard.displayName = 'SharingRulesCard'

export default SharingRulesCard
