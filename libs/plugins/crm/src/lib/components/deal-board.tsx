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

import type { CrmDealStage } from '@aglyn/aglyn'
import {
  mdiChevronRight,
  mdiOpenInNew,
  mdiThumbDownOutline,
  mdiTrophyOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import {
  daysInStage,
  type DealDoc,
  formatMoney,
  openStages,
  type PipelineDoc,
} from '../model/deal-board-model'
import { OwnerAvatar } from './owner-avatar'

/** The droppable id a stage column answers to. */
const columnId = (stageId: string) => `stage:${stageId}`
const stageOfColumn = (id: unknown) =>
  typeof id === 'string' && id.startsWith('stage:') ? id.slice('stage:'.length) : null

export interface DealBoardProps {
  pipeline: PipelineDoc
  /** Every open deal in the pipeline; the board sorts them into columns. */
  deals: readonly DealDoc[]
  /** The closed columns' rows once expanded; `null` while collapsed. */
  won: readonly DealDoc[] | null
  lost: readonly DealDoc[] | null
  closedExpanded: boolean
  onToggleClosed: () => void
  /** The owner's name for a uid, from the roster. */
  labelFor: (uid: string | undefined) => string
  /** Deals whose move is in flight — drawn dimmed, not draggable. */
  moving: ReadonlySet<string>
  onOpen: (deal: DealDoc) => void
  onMove: (deal: DealDoc, stageId: string) => void
  onWon: (deal: DealDoc) => void
  onLost: (deal: DealDoc) => void
  nowMs: number
}

/**
 * The pipeline as columns (AGL-2598): one per open stage, Won and Lost at
 * the end, cards dragged between them.
 *
 * ## Dragging is a request, not a write
 *
 * `@dnd-kit` handles the pointer; when a card is released over another
 * column the board calls `onMove`, and the SECTION calls the stage route.
 * The card is not moved locally: it dims while the request is in flight
 * and lands in its new column when the listener hears the write. An
 * optimistic move that the server refused — no permission, a stage the
 * pipeline lost meanwhile — would have to be animated back, and a card that
 * jumps back with no explanation reads as a bug in the board rather than a
 * refusal by the server, which is what it was.
 *
 * The pointer sensor needs a few pixels of travel before a drag begins, so
 * a click on the title still opens the deal and a click on the menu still
 * opens the menu. The keyboard sensor makes the same move reachable without
 * a mouse; the card menu's "Move to" items are the other route.
 *
 * ## Won and Lost fold away
 *
 * A closed deal is history, and a board that drew every won deal of the
 * year beside the four open stages would push the work off the screen. The
 * two closed columns start collapsed to a count-free stub and expand on
 * request, which is also when their rows are read — a collapsed column
 * costs no listener.
 */
export function DealBoard(props: DealBoardProps) {
  const {
    pipeline,
    deals,
    won,
    lost,
    closedExpanded,
    onToggleClosed,
    labelFor,
    moving,
    onOpen,
    onMove,
    onWon,
    onLost,
    nowMs,
  } = props
  const stages = useMemo(() => openStages(pipeline), [pipeline])
  const byStage = useMemo(() => {
    const map = new Map<string, DealDoc[]>()
    for (const stage of stages) map.set(stage.id, [])
    const orphans: DealDoc[] = []
    for (const deal of deals) {
      const column = map.get(deal.stageId)
      if (column) column.push(deal)
      else orphans.push(deal)
    }
    return { map, orphans }
  }, [stages, deals])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const [dragging, setDragging] = useState<DealDoc | null>(null)
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragging((event.active.data.current?.['deal'] as DealDoc) ?? null)
  }, [])
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null)
      const deal = event.active.data.current?.['deal'] as DealDoc | undefined
      const target = stageOfColumn(event.over?.id)
      if (!deal || !target || target === deal.stageId) return
      const stage = pipeline.stages.find((entry) => entry.id === target)
      if (!stage) return
      if (stage.kind === 'won') return onWon(deal)
      if (stage.kind === 'lost') return onLost(deal)
      onMove(deal, target)
    },
    [pipeline, onMove, onWon, onLost],
  )

  const cardActions = useCallback(
    (deal: DealDoc): RowActionsMenuItem[] => [
      {
        key: 'open',
        label: 'Open',
        icon: <MdiIcon path={mdiOpenInNew.path} size={0.8} />,
        onClick: () => onOpen(deal),
      },
      ...stages
        .filter((stage) => stage.id !== deal.stageId)
        .map((stage) => ({
          key: `move:${stage.id}`,
          label: `Move to ${stage.name}`,
          icon: <MdiIcon path={mdiChevronRight.path} size={0.8} />,
          onClick: () => onMove(deal, stage.id),
        })),
      {
        key: 'won',
        label: 'Mark won',
        icon: <MdiIcon path={mdiTrophyOutline.path} size={0.8} />,
        onClick: () => onWon(deal),
      },
      {
        key: 'lost',
        label: 'Mark lost',
        icon: <MdiIcon path={mdiThumbDownOutline.path} size={0.8} />,
        onClick: () => onLost(deal),
        destructive: true,
      },
    ],
    [stages, onOpen, onMove, onWon, onLost],
  )

  const renderCard = (deal: DealDoc) => (
    <DealCard
      key={deal.$id}
      deal={deal}
      ownerLabel={labelFor(deal.ownerUid)}
      days={daysInStage(deal, nowMs)}
      pending={moving.has(deal.$id)}
      actions={cardActions(deal)}
      onOpen={() => onOpen(deal)}
    />
  )

  const closedStages = pipeline.stages.filter((stage) => stage.kind !== 'open')

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {/*
        The board scrolls sideways; the page does not. The columns are
        fixed-width and refuse to shrink, so the row is as wide as its
        stages — and a flex item's implicit `min-width: auto` would hand
        that width up to the card and the page rather than clip it here.
        `minWidth: 0` is what lets this box be narrower than its content,
        which is the whole condition for the scrollbar to appear on it.
       */}
      <Box sx={{ overflowX: 'auto', pb: 1, minWidth: 0, width: '100%' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'stretch', minWidth: 'max-content' }}>
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              count={byStage.map.get(stage.id)?.length ?? 0}
              total={(byStage.map.get(stage.id) ?? []).reduce(
                (sum, deal) => sum + (Number(deal.amountCents) || 0),
                0,
              )}
              currency={byStage.map.get(stage.id)?.[0]?.currency}
            >
              {(byStage.map.get(stage.id) ?? []).map(renderCard)}
            </StageColumn>
          ))}
          {byStage.orphans.length ? (
            <StageColumn
              stage={{
                id: '__orphans',
                name: 'No stage',
                order: Number.MAX_SAFE_INTEGER,
                probability: 0,
                kind: 'open',
              }}
              count={byStage.orphans.length}
              total={0}
              currency={undefined}
              droppable={false}
              caption="These deals sit in a stage the pipeline no longer has. Move them."
            >
              {byStage.orphans.map(renderCard)}
            </StageColumn>
          ) : null}
          {closedStages.map((stage) => {
            const rows = stage.kind === 'won' ? won : lost
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                count={rows?.length ?? null}
                total={null}
                currency={undefined}
                collapsed={!closedExpanded}
                onToggle={onToggleClosed}
              >
                {closedExpanded && rows === null ? (
                  <Stack sx={{ alignItems: 'center', py: 2 }}>
                    <CircularProgress size={20} />
                  </Stack>
                ) : (
                  (rows ?? []).map(renderCard)
                )}
              </StageColumn>
            )
          })}
        </Stack>
      </Box>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <DealCardBody
            deal={dragging}
            ownerLabel={labelFor(dragging.ownerUid)}
            days={daysInStage(dragging, nowMs)}
            lifted
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
DealBoard.displayName = 'DealBoard'

interface StageColumnProps {
  stage: CrmDealStage
  /** Cards in the column, or null while a closed column has not loaded. */
  count: number | null
  /** The column's open value in cents, or null for a closed column. */
  total: number | null
  currency: string | undefined
  droppable?: boolean
  collapsed?: boolean
  onToggle?: () => void
  caption?: string
  children?: React.ReactNode
}

function StageColumn(props: StageColumnProps) {
  const {
    stage,
    count,
    total,
    currency,
    droppable = true,
    collapsed = false,
    onToggle,
    caption,
    children,
  } = props
  const { setNodeRef, isOver } = useDroppable({
    id: columnId(stage.id),
    disabled: !droppable || collapsed,
  })
  const closed = stage.kind !== 'open'
  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      sx={{
        width: collapsed ? 56 : 260,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: isOver ? 'action.hover' : 'background.default',
        borderColor: isOver ? 'primary.main' : undefined,
        transition: (theme) => theme.transitions.create(['background-color', 'border-color', 'width']),
        minHeight: 240,
      }}
    >
      {collapsed ? (
        <Button
          onClick={onToggle}
          sx={{
            flex: 1,
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            py: 2,
            typography: 'subtitle2',
          }}
          color={stage.kind === 'won' ? 'success' : 'inherit'}
        >
          {stage.name}
        </Button>
      ) : (
        <>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', px: 1.5, py: 1 }}
          >
            <Typography variant="subtitle2" sx={{ flex: 1 }} noWrap>
              {stage.name}
            </Typography>
            {count !== null ? <Chip size="small" label={count} /> : null}
            {closed && onToggle ? (
              <Button size="small" onClick={onToggle}>
                {'Hide'}
              </Button>
            ) : null}
          </Stack>
          {!closed ? (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1.5 }}>
              {`${stage.probability}% · ${total ? formatMoney(total, currency) : 'no value yet'}`}
            </Typography>
          ) : null}
          {caption ? (
            <Typography variant="caption" color="warning.main" sx={{ px: 1.5 }}>
              {caption}
            </Typography>
          ) : null}
          <Stack spacing={1} sx={{ p: 1, flex: 1 }}>
            {children}
          </Stack>
        </>
      )}
    </Paper>
  )
}
StageColumn.displayName = 'StageColumn'

interface DealCardProps {
  deal: DealDoc
  ownerLabel: string
  days: number
  pending: boolean
  actions: RowActionsMenuItem[]
  onOpen: () => void
}

function DealCard(props: DealCardProps) {
  const { deal, ownerLabel, days, pending, actions, onOpen } = props
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.$id,
    data: { deal },
    disabled: pending || deal.status !== 'open',
  })
  return (
    <Box
      ref={setNodeRef}
      sx={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.3 : pending ? 0.5 : 1,
        cursor: deal.status === 'open' && !pending ? 'grab' : 'default',
        outline: 'none',
        '&:focus-visible': {
          borderRadius: 1,
          boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
        },
      }}
      // The sensor's attributes and listeners carry no `sx`, and they come
      // AFTER it so the card's own styles are what the rule sees first.
      {...attributes}
      {...listeners}
    >
      <DealCardBody
        deal={deal}
        ownerLabel={ownerLabel}
        days={days}
        menu={<RowActionsMenu items={actions} label={deal.title} />}
        onOpen={onOpen}
      />
    </Box>
  )
}
DealCard.displayName = 'DealCard'

interface DealCardBodyProps {
  deal: DealDoc
  ownerLabel: string
  days: number
  menu?: React.ReactNode
  onOpen?: () => void
  lifted?: boolean
}

/**
 * What a card shows: the title, the amount, who it is with, the owner and
 * how long it has sat here. Shared by the card in its column and the copy
 * that follows the pointer, so the two cannot drift.
 */
export function DealCardBody(props: DealCardBodyProps) {
  const { deal, ownerLabel, days, menu, onOpen, lifted } = props
  const withWhom = [deal.contactName, deal.companyName].filter(Boolean).join(' · ')
  return (
    <Paper
      elevation={lifted ? 6 : 1}
      sx={{ p: 1.25, width: lifted ? 244 : undefined }}
    >
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
        <Typography
          variant="body2"
          component={onOpen ? 'button' : 'span'}
          onClick={onOpen}
          // The title is the link into the deal, drawn as text: a button
          // element so it is focusable and announced, unstyled so it reads
          // as the card's heading rather than a control beside it.
          sx={{
            flex: 1,
            textAlign: 'left',
            font: 'inherit',
            fontWeight: 'medium',
            color: 'inherit',
            background: 'none',
            border: 0,
            p: 0,
            cursor: onOpen ? 'pointer' : 'inherit',
            '&:hover': onOpen ? { textDecoration: 'underline' } : undefined,
          }}
        >
          {deal.title || 'Untitled deal'}
        </Typography>
        {menu ? (
          <Box
            // The menu must not start a drag, and the sensor listens on the
            // whole card, so pointer-down here stops before it reaches it.
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            sx={{ m: -0.5 }}
          >
            {menu}
          </Box>
        ) : null}
      </Stack>
      <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
        {typeof deal.amountCents === 'number'
          ? formatMoney(deal.amountCents, deal.currency)
          : '—'}
      </Typography>
      {withWhom ? (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {withWhom}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
        <OwnerAvatar label={ownerLabel} size={22} />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {deal.status === 'open'
            ? `${days} ${days === 1 ? 'day' : 'days'} in stage`
            : deal.status === 'won'
              ? 'Won'
              : 'Lost'}
        </Typography>
      </Stack>
    </Paper>
  )
}
DealCardBody.displayName = 'DealCardBody'

export default DealBoard
