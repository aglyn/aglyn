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

import { CRM_COLLECTIONS, dealStageById, pluginDocsHelp } from '@aglyn/aglyn'
import { mdiDeleteOutline, mdiPencilOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useHostActivityLogger } from '@aglyn/tenant-feature-instance'
import { Button, Stack, Typography } from '@mui/material'
import { deleteDoc, doc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useDealStageApi } from '../hooks/use-deal-stage-api'
import { useDeal } from '../hooks/use-deals'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import { usePipeline } from '../hooks/use-pipeline'
import { type CrmDetailPageProps, crmRoutes } from '../model/crm-routes'
import { DEAL_STATUS_LABELS, formatMoney } from '../model/deal-board-model'
import { CrmRecordChip, CrmRecordHeader } from './crm-record-header'
import { RecordActivityCard } from './record-activity-card'
import { DealEditDrawer } from './deal-edit-drawer'
import { DealPropertiesCard } from './deal-properties-card'
import { DealStageCard } from './deal-stage-card'
import { RecordTasksCard } from './record-tasks-card'

/**
 * `/crm/deals/{dealId}` — one deal (AGL-2598).
 *
 * The record behind a card: its stage and the controls that move it, what
 * it is worth and who it is with, and the tasks and activity filed against
 * it. One live document read; the pipeline and the roster are the same
 * bounded reads the board makes. Editing opens the same drawer the board
 * creates with, and deleting is the one destructive act here — confirmed,
 * then a client-direct delete the rules allow the same people who could
 * have created it.
 */
export function DealDetailPage(props: CrmDetailPageProps) {
  const { id, basePath, hostId, org } = props
  const routes = crmRoutes(basePath)
  const router = useRouter()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const logActivity = useHostActivityLogger(hostId)
  const { confirm } = useConfirmationContext()
  const scope = useCrmScope({ hostId, org })
  const { data: deal, status, fromCache } = useDeal(scope.orgId, id)
  const pipelineState = usePipeline(scope.orgId, {
    hostId,
    org: (org ?? null) as Record<string, unknown> | null,
  })
  const pipeline = pipelineState.pipelineById(deal?.pipelineId)
  const roster = useOrgMemberDirectory(scope.orgId)
  const api = useDealStageApi(hostId)
  const nowMs = useMemo(() => Date.now(), [])
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const notFound = scope.ready && (!scope.orgId || (status !== 'loading' && !deal))

  const handleDelete = useCallback(async () => {
    if (!deal || !scope.orgId) return
    const agreed = await confirm({
      title: 'Delete this deal?',
      description:
        `"${deal.title}" is removed from the pipeline along with its notes. ` +
        'The contact and the company it names are not touched.',
      confirmationText: 'Delete deal',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!agreed) return
    setDeleting(true)
    try {
      await deleteDoc(doc(firestore, 'orgs', scope.orgId, CRM_COLLECTIONS.deals, deal.$id))
      // Setup → Activity shows CRM work (AGL-2622): the deal is org data,
      // but the act happened in this site's console and belongs in its feed.
      logActivity('Deleted deal', { type: 'deal', id: deal.$id, name: deal.title })
      enqueueSnackbar('Deal deleted', { variant: 'success', persist: false })
      router.push(routes.section('deals'))
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
      setDeleting(false)
    }
  }, [deal, scope.orgId, confirm, firestore, logActivity, enqueueSnackbar, router, routes])

  const stage = deal ? dealStageById(pipeline, deal.stageId) : undefined

  return (
    <>
      <Stack spacing={2}>
        <CrmRecordHeader
          kind="Deal"
          title={deal?.title}
          subtitle={
            deal
              ? [pipeline?.name, stage?.name ?? deal.stageId].filter(Boolean).join(' · ')
              : undefined
          }
          help={pluginDocsHelp('deals', { anchor: '#a-deals-page' })}
          backHref={routes.section('deals')}
          backLabel="Back to deals"
          loading={!deal && !notFound}
          actions={
            deal ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<MdiIcon path={mdiPencilOutline.path} size={0.8} />}
                onClick={() => setEditing(true)}
              >
                {'Edit'}
              </Button>
            ) : null
          }
          menuItems={
            deal
              ? [
                  {
                    key: 'delete',
                    label: 'Delete deal',
                    icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
                    destructive: true,
                    disabled: deleting,
                    disabledReason: 'The deal is being deleted',
                    onClick: () => void handleDelete(),
                  },
                ]
              : undefined
          }
          chips={
            deal ? (
              <>
                <CrmRecordChip
                  label="Status"
                  value={DEAL_STATUS_LABELS[deal.status] ?? deal.status}
                  color={deal.status === 'won' ? 'success' : deal.status === 'lost' ? 'default' : 'primary'}
                />
                <CrmRecordChip
                  label="Amount"
                  value={
                    typeof deal.amountCents === 'number'
                      ? formatMoney(deal.amountCents, deal.currency)
                      : undefined
                  }
                />
                <CrmRecordChip label="Owner" value={roster.nameOf(deal.ownerUid) || undefined} />
              </>
            ) : null
          }
        >
          {notFound ? (
            <Typography variant="body2" color="text.secondary">
              {'This deal does not exist, or is not visible to this site.'}
            </Typography>
          ) : null}
        </CrmRecordHeader>
        {deal ? (
          <>
            <DealStageCard deal={deal} pipeline={pipeline} api={api} nowMs={nowMs} />
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'stretch' }}>
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <DealPropertiesCard
                  deal={deal}
                  pipeline={pipeline}
                  ownerLabel={roster.nameOf(deal.ownerUid)}
                  routes={routes}
                />
              </Stack>
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <RecordTasksCard hostId={hostId} org={org} basePath={basePath} dealId={deal.$id} />
              </Stack>
            </Stack>
            <RecordActivityCard hostId={hostId} org={org} dealId={deal.$id} />
          </>
        ) : null}
      </Stack>
      <DealEditDrawer
        open={editing}
        onClose={() => setEditing(false)}
        hostId={hostId}
        org={org}
        deal={deal ?? null}
        pipelines={pipelineState.pipelines}
        defaultPipeline={pipeline ?? pipelineState.pipeline}
        unreadable={status === 'error'}
        fromCache={fromCache}
      />
    </>
  )
}
DealDetailPage.displayName = 'DealDetailPage'

export default DealDetailPage
