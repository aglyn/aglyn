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
  CRM_FORECAST_CATEGORY_LABELS,
  dealForecastCategory,
  dealProbability,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { mdiThumbDownOutline, mdiTrophyOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Step,
  StepButton,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import { type DealStageApi } from '../hooks/use-deal-stage-api'
import {
  closingStage,
  daysInStage,
  DEAL_STATUS_LABELS,
  type DealDoc,
  openStages,
  type PipelineDoc,
} from '../model/deal-board-model'
import { LostReasonDialog } from './lost-reason-dialog'

export interface DealStageCardProps {
  deal: DealDoc
  pipeline: PipelineDoc | null
  api: DealStageApi
  nowMs: number
}

/**
 * Where the deal is, and the controls that move it (AGL-2598).
 *
 * A path across the whole pipeline, the way Salesforce draws one: every open
 * stage — click one to move there — and then one closing step, so the stages
 * still ahead of the deal are always in view and the path ends where every
 * deal ends. The closing step reads "Closed" while the deal is open and asks
 * won or lost when chosen, the same two moves as the buttons in the header;
 * once the deal is closed it reads the pipeline's own name for the verdict.
 * Every move calls the stage route, never Firestore: the move is what an
 * automation listens for, and the route is the only writer that emits it.
 * Under a closed deal's path sits the verdict — when, and why — and a way
 * back: reopening is a move into an open stage, which the route emits as
 * `dealStageChanged` like any other move.
 *
 * The line under the stepper reads the deal's own probability and forecast
 * category (AGL-3516) — a move gives it the new stage's, which the route
 * stamps, and the stepper says so on hover.
 */
export function DealStageCard(props: DealStageCardProps) {
  const { deal, pipeline, api, nowMs } = props
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [losing, setLosing] = useState(false)
  const [closeMenu, setCloseMenu] = useState<HTMLElement | null>(null)
  const stages = openStages(pipeline)
  const activeIndex = stages.findIndex((stage) => stage.id === deal.stageId)
  const wonName = closingStage(pipeline, 'won')?.name ?? DEAL_STATUS_LABELS.won
  const lostName = closingStage(pipeline, 'lost')?.name ?? DEAL_STATUS_LABELS.lost

  const run = useCallback(
    async (request: () => Promise<unknown>, done: string) => {
      setBusy(true)
      try {
        await request()
        enqueueSnackbar(done, { variant: 'success', persist: false })
        return true
      } catch (error) {
        enqueueSnackbar(
          error instanceof Error ? error.message : 'The deal could not be moved.',
          { variant: 'warning', allowDuplicate: true },
        )
        return false
      } finally {
        setBusy(false)
      }
    },
    [enqueueSnackbar],
  )

  const closed = deal.status !== 'open'
  const days = daysInStage(deal, nowMs)
  const current = activeIndex === -1 ? null : stages[activeIndex]
  const probability = dealProbability(deal, current)
  const forecast = CRM_FORECAST_CATEGORY_LABELS[dealForecastCategory(deal, current)]

  const path = (
    <Stepper nonLinear activeStep={closed ? stages.length : activeIndex} alternativeLabel>
      {stages.map((stage, index) => (
        <Step key={stage.id} completed={closed || index < activeIndex}>
          <StepButton
            title={closed ? undefined : `Move here: ${stage.probability}% likely to close`}
            disabled={busy || closed || stage.id === deal.stageId}
            onClick={() =>
              void run(() => api.moveToStage(deal, stage.id), `Moved to ${stage.name}`)
            }
          >
            {stage.name}
          </StepButton>
        </Step>
      ))}
      <Step key="$closed" completed={deal.status === 'won'}>
        <StepButton
          data-testid="deal-stage-closing-step"
          title={closed ? undefined : 'Close the deal as won or lost'}
          disabled={busy || closed}
          onClick={(event) => setCloseMenu(event.currentTarget)}
          icon={
            deal.status === 'won' ? (
              <MdiIcon path={mdiTrophyOutline.path} color="success" fontSize="medium" />
            ) : deal.status === 'lost' ? (
              <MdiIcon path={mdiThumbDownOutline.path} color="error" fontSize="medium" />
            ) : undefined
          }
        >
          <StepLabel error={deal.status === 'lost'}>
            {deal.status === 'won' ? wonName : deal.status === 'lost' ? lostName : 'Closed'}
          </StepLabel>
        </StepButton>
      </Step>
    </Stepper>
  )

  return (
    <CardDisplay
      header={'Stage'}
      help={pluginDocsHelp('deals', { anchor: '#moving-winning-and-losing' })}
      HeaderProps={{
        action: !closed ? (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              color="success"
              variant="outlined"
              disabled={busy || !pipeline}
              startIcon={<MdiIcon path={mdiTrophyOutline.path} size={0.8} />}
              onClick={() => void run(() => api.markWon(deal), 'Deal won')}
            >
              {'Won'}
            </Button>
            <Button
              size="small"
              color="error"
              variant="outlined"
              disabled={busy || !pipeline}
              startIcon={<MdiIcon path={mdiThumbDownOutline.path} size={0.8} />}
              onClick={() => setLosing(true)}
            >
              {'Lost'}
            </Button>
          </Stack>
        ) : null,
      }}
      contentGutterX
      contentGutterY
    >
      {!pipeline ? (
        <Typography variant="body2" color="text.secondary">
          {"This deal's pipeline no longer exists, so it has no stages to move through."}
        </Typography>
      ) : closed ? (
        <Stack spacing={1.5}>
          {path}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              label={DEAL_STATUS_LABELS[deal.status]}
              color={deal.status === 'won' ? 'success' : 'default'}
            />
            <Typography variant="body2" color="text.secondary">
              {typeof deal.closedAtMs === 'number'
                ? `Closed ${new Date(deal.closedAtMs).toLocaleDateString()}`
                : 'Closed'}
            </Typography>
          </Stack>
          {deal.status === 'lost' && deal.lostReason ? (
            <Typography variant="body2">{deal.lostReason}</Typography>
          ) : null}
          <TextField
            select
            size="small"
            label="Reopen into"
            value=""
            disabled={busy}
            onChange={(event) => {
              const stageId = event.target.value
              if (!stageId) return
              void run(() => api.moveToStage(deal, stageId), 'Deal reopened')
            }}
            helperText="Reopening puts the deal back in an open stage and tells the automations."
            sx={{ maxWidth: 320 }}
          >
            <MenuItem value="">{'Pick a stage'}</MenuItem>
            {stages.map((stage) => (
              <MenuItem key={stage.id} value={stage.id}>
                {stage.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      ) : (
        <Stack spacing={1.5}>
          {path}
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            {!current
              ? 'This deal sits in a stage the pipeline no longer has. Pick one above.'
              : `${days} ${days === 1 ? 'day' : 'days'} in ${current.name} · ` +
                `${probability ?? current.probability}% likely to close · ${forecast}`}
          </Typography>
        </Stack>
      )}
      <Menu anchorEl={closeMenu} open={Boolean(closeMenu)} onClose={() => setCloseMenu(null)}>
        <MenuItem
          onClick={() => {
            setCloseMenu(null)
            void run(() => api.markWon(deal), 'Deal won')
          }}
        >
          <ListItemIcon>
            <MdiIcon path={mdiTrophyOutline.path} color="success" />
          </ListItemIcon>
          <ListItemText>{wonName}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setCloseMenu(null)
            setLosing(true)
          }}
        >
          <ListItemIcon>
            <MdiIcon path={mdiThumbDownOutline.path} color="error" />
          </ListItemIcon>
          <ListItemText>{lostName}</ListItemText>
        </MenuItem>
      </Menu>
      <LostReasonDialog
        open={losing}
        dealTitle={deal.title}
        busy={busy}
        onClose={() => setLosing(false)}
        onConfirm={(reason) =>
          void run(() => api.markLost(deal, reason), 'Deal marked lost').then(
            (ok) => ok && setLosing(false),
          )
        }
      />
    </CardDisplay>
  )
}
DealStageCard.displayName = 'DealStageCard'

export default DealStageCard
