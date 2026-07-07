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
  screenRoutePathToUrl,
  wouldCreateScreenCycle,
  type ScreenRouteNode,
  type ScreenUid,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_COLLAPSIBLE_CLOSE,
  ICON_VARIANT_COLLAPSIBLE_OPEN,
  ICON_VARIANT_MODIFY_DRAG,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  Box,
  IconButton,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react'

export interface ScreenHierarchyRow {
  $id: ScreenUid
  displayName?: string
  description?: string
  slug?: string
  parentId?: ScreenUid
  order?: number
  versionId?: string
  createdAt?: { toDate?: () => Date; seconds?: number }
  updatedAt?: { toDate?: () => Date }
}

/**
 * Where a dragged screen lands: as a child of `nextParentId` (undefined for
 * the top level), positioned before sibling `beforeId` (appended when
 * undefined).
 */
export interface ScreenMoveRequest {
  screenId: ScreenUid
  nextParentId?: ScreenUid
  beforeId?: ScreenUid
}

export interface ScreensHierarchyTableProps {
  screens: ScreenHierarchyRow[]
  routingMap?: Record<ScreenUid, string>
  loading?: boolean
  onMoveScreen: (move: ScreenMoveRequest) => void | Promise<void>
  renderRowActions: (row: ScreenHierarchyRow) => ReactNode
  /** Onboarding CTA rendered inside the empty state (AGL-125). */
  emptyAction?: ReactNode
}

const COLUMN_COUNT = 7

type VisibleRow = {
  row: ScreenHierarchyRow
  depth: number
  hasChildren: boolean
}

/** Sibling display order: explicit `order` first, then creation time, then id. */
export function compareScreenSiblings(
  a: ScreenHierarchyRow,
  b: ScreenHierarchyRow,
) {
  const orderA = a.order ?? Number.MAX_SAFE_INTEGER
  const orderB = b.order ?? Number.MAX_SAFE_INTEGER
  if (orderA !== orderB) return orderA - orderB
  const createdA = a.createdAt?.seconds ?? 0
  const createdB = b.createdAt?.seconds ?? 0
  if (createdA !== createdB) return createdA - createdB
  return a.$id.localeCompare(b.$id)
}

/** Thin droppable strip between rows: drop inserts as a sibling before `beforeId`. */
function GapDropRow(props: {
  id: string
  disabled: boolean
  depth: number
}) {
  const { id, disabled, depth } = props
  const { isOver, setNodeRef } = useDroppable({ id, disabled })
  return (
    <TableRow>
      <TableCell
        ref={setNodeRef}
        colSpan={COLUMN_COUNT}
        padding="none"
        sx={{
          border: 0,
          // Constant height: droppable rects are measured while dragging, so
          // the layout must not shift when a drag starts.
          height: 6,
          position: 'relative',
        }}
      >
        {isOver && !disabled && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              ml: 2 + depth * 3,
              bgcolor: 'primary.main',
              borderRadius: 1,
            }}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

/**
 * Trailing drop zone that re-parents a screen back to the top level. Lives
 * in its own component (like every droppable here) because `useDroppable`
 * must run in a descendant of the `DndContext` this table renders.
 */
function RootDropRow(props: { dragging: boolean }) {
  const { dragging } = props
  const { isOver, setNodeRef } = useDroppable({ id: 'drop:root:end' })
  return (
    <TableRow>
      <TableCell
        ref={setNodeRef}
        colSpan={COLUMN_COUNT}
        padding="none"
        sx={{ border: 0, height: 32 }}
      >
        <Box
          sx={{
            height: '100%',
            mx: 1,
            borderRadius: 1,
            border: '1px dashed',
            borderColor: isOver ? 'primary.main' : 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            visibility: dragging ? 'visible' : 'hidden',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {'Drop here to move to the top level'}
          </Typography>
        </Box>
      </TableCell>
    </TableRow>
  )
}

function ScreenTableRow(props: {
  entry: VisibleRow
  collapsed: boolean
  nestDisabled: boolean
  onToggleCollapse: (id: ScreenUid) => void
  renderRowActions: ScreensHierarchyTableProps['renderRowActions']
  routingMap?: Record<ScreenUid, string>
}) {
  const {
    entry,
    collapsed,
    nestDisabled,
    onToggleCollapse,
    renderRowActions,
    routingMap,
  } = props
  const { row, depth, hasChildren } = entry
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `drop:nest:${row.$id}`,
    disabled: nestDisabled,
  })
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({
    id: `drag:screen:${row.$id}`,
    data: { screenId: row.$id },
  })
  const path = routingMap?.[row.$id]

  return (
    <TableRow
      ref={(node: HTMLTableRowElement | null) => {
        setDropRef(node)
        setDragRef(node)
      }}
      hover
      sx={{
        opacity: isDragging ? 0.4 : 1,
        ...(isOver &&
          !nestDisabled && {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -2,
          }),
      }}
    >
      <TableCell sx={{ pl: 2 + depth * 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton
            ref={setActivatorNodeRef}
            size="small"
            aria-label={`Drag ${row.displayName ?? row.$id}`}
            sx={{ cursor: 'grab', touchAction: 'none' }}
            {...attributes}
            {...listeners}
          >
            <MdiIcon path={ICON_VARIANT_MODIFY_DRAG.path} size={0.7} />
          </IconButton>
          {hasChildren ? (
            <IconButton
              size="small"
              aria-label={collapsed ? 'Expand children' : 'Collapse children'}
              onClick={() => onToggleCollapse(row.$id)}
            >
              <MdiIcon
                path={
                  collapsed
                    ? ICON_VARIANT_COLLAPSIBLE_CLOSE.path
                    : ICON_VARIANT_COLLAPSIBLE_OPEN.path
                }
                size={0.7}
              />
            </IconButton>
          ) : (
            <Box sx={{ width: 28 }} />
          )}
          <Typography variant="body2">{row.displayName || '--'}</Typography>
        </Box>
      </TableCell>
      <TableCell>{row.$id}</TableCell>
      <TableCell>{path ? screenRoutePathToUrl(path) : '--'}</TableCell>
      <TableCell>{row.description || '--'}</TableCell>
      <TableCell>{row.updatedAt?.toDate?.().toLocaleString() || '--'}</TableCell>
      <TableCell>{row.createdAt?.toDate?.().toLocaleString() || '--'}</TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        {renderRowActions(row)}
      </TableCell>
    </TableRow>
  )
}

/**
 * Screens list with visible parent/child grouping and drag-and-drop
 * hierarchy editing. Two drop semantics, discriminated by droppable id
 * prefix (ids must stay unique or dnd-kit evicts registry entries):
 * `drop:gap:` strips between rows reorder among that row's siblings, and
 * `drop:nest:` on a row makes the dragged screen its child. A trailing
 * `drop:root:` zone moves a screen back to the top level. Persistence is
 * the caller's job via `onMoveScreen` — cycle/conflict guards that need the
 * routing map live there; this component only disables drop targets inside
 * the dragged screen's own subtree.
 */
export function ScreensHierarchyTableComponent(
  props: ScreensHierarchyTableProps,
) {
  const {
    screens,
    routingMap,
    loading,
    onMoveScreen,
    renderRowActions,
    emptyAction,
  } = props
  const [collapsedIds, setCollapsedIds] = useState<Set<ScreenUid>>(new Set())
  const [activeId, setActiveId] = useState<ScreenUid | undefined>(undefined)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const screensById = useMemo(() => {
    const map: Record<ScreenUid, ScreenRouteNode> = {}
    for (const screen of screens) {
      map[screen.$id] = { slug: screen.slug, parentId: screen.parentId }
    }
    return map
  }, [screens])

  const visibleRows = useMemo<VisibleRow[]>(() => {
    const childrenByParent = new Map<ScreenUid | undefined, ScreenHierarchyRow[]>()
    for (const screen of screens) {
      // Screens whose parent is missing from the list render at the root so
      // they never silently disappear.
      const parentId =
        screen.parentId && screensById[screen.parentId]
          ? screen.parentId
          : undefined
      const siblings = childrenByParent.get(parentId) ?? []
      siblings.push(screen)
      childrenByParent.set(parentId, siblings)
    }
    const rows: VisibleRow[] = []
    const walk = (parentId: ScreenUid | undefined, depth: number) => {
      const children = (childrenByParent.get(parentId) ?? []).sort(
        compareScreenSiblings,
      )
      for (const child of children) {
        const hasChildren = Boolean(childrenByParent.get(child.$id)?.length)
        rows.push({ row: child, depth, hasChildren })
        if (hasChildren && !collapsedIds.has(child.$id)) {
          walk(child.$id, depth + 1)
        }
      }
    }
    walk(undefined, 0)
    return rows
  }, [screens, screensById, collapsedIds])

  const handleToggleCollapse = useCallback((id: ScreenUid) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.data.current?.screenId as ScreenUid)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(undefined)
      const screenId = event.active.data.current?.screenId as
        | ScreenUid
        | undefined
      const overId = event.over?.id
      if (!screenId || typeof overId !== 'string') return
      if (overId.startsWith('drop:nest:')) {
        const nextParentId = overId.slice('drop:nest:'.length)
        if (nextParentId === screenId) return
        return onMoveScreen({ screenId, nextParentId })
      }
      if (overId.startsWith('drop:gap:')) {
        const beforeId = overId.slice('drop:gap:'.length)
        if (beforeId === screenId) return
        return onMoveScreen({
          screenId,
          nextParentId: screensById[beforeId]?.parentId,
          beforeId,
        })
      }
      if (overId.startsWith('drop:root:')) {
        return onMoveScreen({ screenId })
      }
    },
    [onMoveScreen, screensById],
  )

  const activeRow = activeId
    ? screens.find((screen) => screen.$id === activeId)
    : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(undefined)}
    >
      {loading && <LinearProgress color="secondary" />}
      <TableContainer>
        <Table size="small" aria-label="Screens hierarchy">
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 240 }}>Display name</TableCell>
              <TableCell sx={{ minWidth: 130 }}>ID</TableCell>
              <TableCell sx={{ minWidth: 120 }}>Path</TableCell>
              <TableCell sx={{ minWidth: 200 }}>Description</TableCell>
              <TableCell sx={{ minWidth: 150 }}>Updated</TableCell>
              <TableCell sx={{ minWidth: 150 }}>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading &&
              !visibleRows.length &&
              [0, 1, 2].map((index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: COLUMN_COUNT }).map((_, cell) => (
                    <TableCell key={cell}>
                      <Skeleton variant="text" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading && !visibleRows.length && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center">
                  <Stack
                    spacing={1}
                    sx={{ alignItems: 'center', py: 4 }}
                  >
                    <Typography variant="subtitle1">
                      {'No screens yet — this site is a blank canvas.'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {'Create your first screen or start from a template ' +
                        'using the buttons above, then open it with the ' +
                        'besigner to design your page.'}
                    </Typography>
                    {emptyAction ?? null}
                  </Stack>
                </TableCell>
              </TableRow>
            )}
            {visibleRows.map((entry) => {
              const { row } = entry
              // A screen can't move inside its own subtree; nesting under a
              // row and slotting between that row's siblings both re-parent,
              // so both are disabled when the target parent would cycle.
              // Droppables stay enabled while idle: dnd-kit measures rects at
              // drag start, before the activeId re-render could enable them.
              const gapDisabled = activeId
                ? wouldCreateScreenCycle(activeId, row.parentId, screensById)
                : false
              const nestDisabled = activeId
                ? wouldCreateScreenCycle(activeId, row.$id, screensById)
                : false
              return (
                <Fragment key={row.$id}>
                  <GapDropRow
                    id={`drop:gap:${row.$id}`}
                    disabled={gapDisabled}
                    depth={entry.depth}
                  />
                  <ScreenTableRow
                    entry={entry}
                    collapsed={collapsedIds.has(row.$id)}
                    nestDisabled={nestDisabled}
                    onToggleCollapse={handleToggleCollapse}
                    renderRowActions={renderRowActions}
                    routingMap={routingMap}
                  />
                </Fragment>
              )
            })}
            <RootDropRow dragging={Boolean(activeId)} />
          </TableBody>
        </Table>
      </TableContainer>
      <DragOverlay dropAnimation={null}>
        {activeRow && (
          <Paper elevation={4} sx={{ px: 1.5, py: 0.5, width: 'fit-content' }}>
            <Typography variant="body2">
              {activeRow.displayName || activeRow.$id}
            </Typography>
          </Paper>
        )}
      </DragOverlay>
    </DndContext>
  )
}
ScreensHierarchyTableComponent.displayName = 'ScreensHierarchyTableComponent'

export default ScreensHierarchyTableComponent
