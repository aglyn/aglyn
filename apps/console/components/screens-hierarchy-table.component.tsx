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
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
// Subpath, not the barrel: `empty-state.component` is deliberately kept out
// of `@aglyn/shared-ui-jsx`'s index (nothing in the tenant page graph shows an
// empty state, and the barrel rule is enforced in CI).
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
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
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { Fragment, useCallback, useMemo, useState, type ReactNode,
  useEffect,
} from 'react'
import { collectionTemplateRoutesSummary } from '../constants/collection-templates'
import type { UseCollectionTemplatesResult } from '../hooks/use-collection-templates'
import {
  TABLE_HEAD_HEIGHT,
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_ROWS_PER_PAGE_LABEL,
} from '../constants/shared'

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
  publishedAt?: { toDate?: () => Date }
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
  /** Actions rendered beside the drag handle, left of the name (AGL-693). */
  renderRowLeadingActions?: (row: ScreenHierarchyRow) => ReactNode
  /**
   * Who is already in this screen, drawn beside its name (AGL-2486).
   *
   * Beside the NAME rather than in the actions column, because it is a fact
   * about the document and not something to click. It must return nothing
   * when the screen is empty — which is the common case, measured at 2
   * occupied rooms against a largest host of 69 documents — so the row keeps
   * its height and the list does not grow a column of blanks.
   */
  renderRowPresence?: (row: ScreenHierarchyRow) => ReactNode
  /** Row click target — the whole row opens the screen's detail page. */
  onRowOpen?: (row: ScreenHierarchyRow) => void
  /**
   * The detail-page address for a row, so the NAME is a real link (AGL-693).
   *
   * The row already opens on click, and that is not the same affordance: a
   * link is what you can middle-click into a new tab, copy the address of,
   * or reach with a keyboard on its own. Every other artifact list has had
   * one on its name column since AGL-695 and this table was the exception.
   *
   * Returning `null` renders plain text — an unpublished screen has no
   * version to deep-link to, and a link that goes nowhere is worse than none.
   */
  rowHref?: (row: ScreenHierarchyRow) => string | null
  /** Onboarding CTA rendered inside the empty state (AGL-125). */
  emptyAction?: ReactNode
  /**
   * Which rows are collection templates, and what they render (AGL-1269).
   * Their entry in `routingMap` is a slug the tenant refuses to serve
   * (AGL-1267), so the Path column must not print it.
   */
  collectionTemplates?: UseCollectionTemplatesResult
}

const COLUMN_COUNT = 8

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
  dragging: boolean
}) {
  const { id, disabled, depth, dragging } = props
  const { isOver, setNodeRef } = useDroppable({ id, disabled })
  return (
    <TableRow>
      <TableCell
        ref={setNodeRef}
        colSpan={COLUMN_COUNT}
        padding="none"
        sx={{
          border: 0,
          // Zero-height until a drag starts, otherwise every row carries a
          // 6px band of dead space above it. Safe to collapse because the
          // DndContext measures with MeasuringStrategy.Always, so the rects
          // are re-read after the rows expand rather than once up front.
          height: dragging ? 6 : 0,
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
  renderRowLeadingActions: ScreensHierarchyTableProps['renderRowLeadingActions']
  renderRowPresence: ScreensHierarchyTableProps['renderRowPresence']
  rowHref: ScreensHierarchyTableProps['rowHref']
  anyExpandable: boolean
  onRowOpen: ScreensHierarchyTableProps['onRowOpen']
  routingMap?: Record<ScreenUid, string>
  collectionTemplates?: UseCollectionTemplatesResult
}) {
  const {
    entry,
    collapsed,
    nestDisabled,
    onToggleCollapse,
    renderRowActions,
    renderRowLeadingActions,
    renderRowPresence,
    rowHref,
    onRowOpen,
    anyExpandable,
    routingMap,
    collectionTemplates,
  } = props
  const { row, depth, hasChildren } = entry
  const href = rowHref?.(row) ?? null
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
  // A collection template is published — which is what makes the compose
  // pipeline use it — but it is NOT a page (AGL-1267), so its routing-map
  // slug 404s. Print the collection routes it renders instead of that slug.
  const isCollectionTemplate = Boolean(
    collectionTemplates?.templateScreenIds.has(row.$id),
  )
  const templateRoutes = collectionTemplateRoutesSummary(
    collectionTemplates?.routesByScreenId.get(row.$id),
  )

  return (
    <TableRow
      ref={(node: HTMLTableRowElement | null) => {
        setDropRef(node)
        setDragRef(node)
      }}
      hover
      onClick={onRowOpen ? () => onRowOpen(row) : undefined}
      sx={{
        cursor: onRowOpen ? 'pointer' : undefined,
        opacity: isDragging ? 0.4 : 1,
        ...(isOver &&
          !nestDisabled && {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -2,
          }),
      }}
    >
      {/* Row controls live in their OWN leading column (drag, collapse, and
          the detail link) so the "Display name" heading lines up with the
          name itself. Previously the controls sat inside the name cell and
          pushed the text a couple of icons to the right of its heading. */}
      <TableCell
        padding="none"
        // width '1%' + nowrap is the table idiom for "only as wide as its
        // content". MUI sx reads a bare `1` as 100%, which made this column
        // swallow the row.
        sx={{ pl: 1 + depth * 3, whiteSpace: 'nowrap', width: '1%' }}
        onClick={(event) => event.stopPropagation()}
      >
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
          ) : anyExpandable ? (
            // Reserve the toggle slot only when the tree actually nests —
            // on a flat list this was 28px of dead width in every row.
            <Box sx={{ width: 28 }} />
          ) : null}
          {renderRowLeadingActions?.(row)}
        </Box>
      </TableCell>
      <TableCell>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          {href ? (
            // The row's own click handler would fire too and push the same
            // route twice — one history entry per back press.
            <AppLink href={href} onClick={(event) => event.stopPropagation()}>
              {row.displayName || row.$id}
            </AppLink>
          ) : (
            <Typography variant="body2">{row.displayName || '--'}</Typography>
          )}
          {renderRowPresence?.(row)}
        </Stack>
      </TableCell>
      <TableCell>{row.$id}</TableCell>
      <TableCell>
        {isCollectionTemplate ? (
          <Tooltip
            title={
              'A collection template is not served at a path of its own — ' +
              'it renders the collection’s routes.'
            }
          >
            <Typography variant="body2" color="text.secondary" component="span">
              {templateRoutes ?? 'Collection template'}
            </Typography>
          </Tooltip>
        ) : path ? (
          screenRoutePathToUrl(path)
        ) : (
          '--'
        )}
      </TableCell>
      <TableCell>{row.description || '--'}</TableCell>
      <TableCell>{row.updatedAt?.toDate?.().toLocaleString() || '--'}</TableCell>
      <TableCell>
        {row.publishedAt?.toDate?.().toLocaleString() || '--'}
      </TableCell>
      <TableCell
        align="right"
        sx={{ whiteSpace: 'nowrap' }}
        onClick={(event) => event.stopPropagation()}
      >
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
    renderRowLeadingActions,
    renderRowPresence,
    rowHref,
    onRowOpen,
    emptyAction,
    collectionTemplates,
  } = props
  /**
   * EXPANDED ids, not collapsed ones — the set starts empty, so every parent
   * starts closed (Zach 2026-08-25).
   *
   * Tracking the collapsed set meant "empty" was "everything open", so a site
   * whose screens nest deeply rendered its whole tree on arrival and the
   * footer's "1-10 of 22 top-level" described a fraction of what was on
   * screen. Inverting it makes the default the cheap one and makes the count
   * honest: ten roots on the page is ten rows until a reader asks for more.
   *
   * NOTE this bounds what is RENDERED, not what is read. The page still
   * fetches the whole collection in one query (`limit(200)` in screens/page),
   * so the children were already on the client either way — closing them by
   * default costs no extra fetch when a reader opens one.
   */
  const [expandedIds, setExpandedIds] = useState<Set<ScreenUid>>(new Set())
  const [activeId, setActiveId] = useState<ScreenUid | undefined>(undefined)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  // True when any row in the tree has children, i.e. a collapse toggle can
  // appear. Drives whether rows reserve space for that toggle.
  const anyExpandable = useMemo(
    () => screens.some((entry: any) => Boolean(entry.parentId)),
    [screens],
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
        if (hasChildren && expandedIds.has(child.$id)) {
          walk(child.$id, depth + 1)
        }
      }
    }
    walk(undefined, 0)
    return rows
  }, [screens, screensById, expandedIds])

  /**
   * Pagination that pages ROOTS, never rows (AGL-693).
   *
   * the requirement was for the pagination the layouts list has. A tree cannot take it
   * literally: slicing `visibleRows` by row would put a child on a different
   * page from its parent, and a hierarchy split across pages is not a
   * hierarchy — the indentation would be describing a parent the reader
   * cannot see.
   *
   * So the page unit is the TOP-LEVEL screen, and each one brings its whole
   * expanded subtree with it. A page therefore holds `rowsPerPage` roots and
   * however many descendants they have, which is the count that means
   * something on this page anyway: "25 sections", not "25 rows of tree".
   *
   * ⚠️ Drag-to-reorder cannot cross a page boundary — dnd-kit only knows about
   * mounted rows, so a screen cannot be dragged onto a page it is not on.
   *
   * The default used to be 25 to keep that limit out of reach on a typical
   * site. It is `TABLE_PAGE_SIZE_DEFAULT` now, which is the smallest option
   * the console offers — every list defaults to its minimum, by the rule —
   * so a site with more than ten top-level screens meets the limit sooner.
   * Reordering across pages means raising rows-per-page first, or moving the
   * screen by re-parenting it rather than dragging.
   */
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const rootCount = useMemo(
    () => visibleRows.filter((entry) => entry.depth === 0).length,
    [visibleRows],
  )
  const pagedRows = useMemo(() => {
    if (rootCount <= rowsPerPage) return visibleRows
    const firstRoot = page * rowsPerPage
    const lastRoot = firstRoot + rowsPerPage
    let seen = -1
    let start = -1
    let end = visibleRows.length
    visibleRows.forEach((entry, index) => {
      if (entry.depth !== 0) return
      seen += 1
      if (seen === firstRoot) start = index
      // The row AFTER the page's last root is where the slice stops, which is
      // what carries the final root's descendants along with it.
      if (seen === lastRoot && end === visibleRows.length) end = index
    })
    return start === -1 ? [] : visibleRows.slice(start, end)
  }, [visibleRows, rootCount, page, rowsPerPage])

  /*
    A tree that shrinks under a reader — a delete, a filter, a collapse — can
    strand them past the last page, which renders as an empty table with no
    way back. Clamp rather than reset: staying on page 3 of 4 is right, and
    jumping to page 1 on every delete is not.
  */
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(rootCount / rowsPerPage) - 1)
    if (page > lastPage) setPage(lastPage)
  }, [page, rootCount, rowsPerPage])

  const handleToggleCollapse = useCallback((id: ScreenUid) => {
    setExpandedIds((previous) => {
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
      {loading && <LinearProgress color="primary" />}
      <TableContainer>
        <Table size="small" aria-label="Screens hierarchy">
          {/* Header height matches the DataTable used by layouts, components
              and templates (AGL-693/694/695) — a size="small" TableHead is
              shorter than a DataGrid column header, so without this the
              screens table reads as a different, cramped design. */}
          <TableHead sx={{ '& .MuiTableCell-head': { height: TABLE_HEAD_HEIGHT } }}>
            <TableRow>
              <TableCell padding="none" sx={{ width: '1%' }} />
              <TableCell sx={{ minWidth: 200 }}>Display name</TableCell>
              <TableCell sx={{ minWidth: 130 }}>ID</TableCell>
              <TableCell sx={{ minWidth: 120 }}>Path</TableCell>
              <TableCell sx={{ minWidth: 200 }}>Description</TableCell>
              <TableCell sx={{ minWidth: 150 }}>Updated</TableCell>
              <TableCell sx={{ minWidth: 150 }}>Published</TableCell>
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
                <TableCell
                  colSpan={COLUMN_COUNT}
                  align="center"
                  sx={(theme) => ({
                    // MUI's OWN `GridOverlay` FORMULA, not an approximation of
                    // it. The three grid lists render their empty state inside
                    // that overlay, which fills with `background.default` at
                    // `action.disabledOpacity` — a very faint wash over the
                    // white card. Setting `background.default` SOLID here (the
                    // first attempt) produced a visibly darker grey than the
                    // lists it was supposed to match. Written as the same
                    // expression so a theme change moves both together.
                    backgroundColor: alpha(
                      theme.palette.background.default,
                      theme.palette.action.disabledOpacity,
                    ),
                    // No bottom rule: the pagination below draws the only line
                    // this region needs, and the two together read as a stray
                    // border with a gap in it.
                    borderBottom: 0,
                  })}
                >
                  {/*
                    THE SHARED EMPTY STATE, illustration and all (AGL-1152).
                    This was a hand-rolled Stack: the only list in the console
                    with a create flow and the only one WITHOUT the
                    illustration, while layouts/components/templates had the
                    illustration and no way out. Both halves were the same
                    omission seen from opposite sides, and `EmptyStateComponent`
                    has drawn label + description + action since AGL-693 — the
                    grid simply never passed the last two, and this table never
                    called it at all.

                    Not `compact`: this cell has the vertical room, and
                    matching the other three lists is the entire point.
                  */}
                  <EmptyStateComponent
                    label={'No screens yet — this site is a blank canvas.'}
                    description={
                      // WHAT A SCREEN IS, then what to do — the shape the
                      // other three lists use ("Layouts are the chrome your
                      // screens render inside…"). This read as instructions
                      // for a reader who already knew the noun, which is not
                      // the reader looking at an empty list. Framed the same
                      // way the page's own help tip frames it: pages, their
                      // addresses, and the hierarchy that builds the URLs.
                      'Screens are your pages — each one gets its own address, ' +
                      'and nesting them builds your URL structure. Create one, ' +
                      'or start from a template.'
                    }
                    action={emptyAction ?? null}
                  />
                </TableCell>
              </TableRow>
            )}
            {pagedRows.map((entry) => {
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
                    dragging={Boolean(activeId)}
                  />
                  <ScreenTableRow
                    entry={entry}
                    collapsed={!expandedIds.has(row.$id)}
                    nestDisabled={nestDisabled}
                    onToggleCollapse={handleToggleCollapse}
                    renderRowActions={renderRowActions}
                    renderRowLeadingActions={renderRowLeadingActions}
                    renderRowPresence={renderRowPresence}
                    rowHref={rowHref}
                    onRowOpen={onRowOpen}
                    anyExpandable={anyExpandable}
                    routingMap={routingMap}
                    collectionTemplates={collectionTemplates}
                  />
                </Fragment>
              )
            })}
            {/*
              Only when there is something to reorder. The row is 32px tall and
              merely `visibility: hidden` while idle, so on an EMPTY list it
              added a blank strip between the empty state and the footer —
              which read as a stray border with a gap above it. Nothing can be
              dragged onto it when there are no rows.
            */}
            {visibleRows.length > 0 ? (
              <RootDropRow dragging={Boolean(activeId)} />
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      {/*
        The console's shared footer, with the tree's one honest difference in
        the COUNT rather than the label (AGL-693): a page holds top-level
        screens and each one's subtree travels with it, so "22 of 22" is
        counted in top-level screens and says so. Labelling the size menu
        differently from every other list made the same control read as a
        different one.
      */}
      <TablePagination
        component="div"
        /*
          MATCH THE GRID'S FOOTER CHROME (AGL-1152). The other three lists are
          MUI DataGrids, whose `.MuiDataGrid-footerContainer` carries a top
          divider and a 52px min-height; this is a bare `TablePagination`, so
          it sat at the default toolbar height with no rule above it and read
          as a different component in a screenshot beside them. The COUNT stays
          different on purpose — see the note above — but the chrome should
          not be.
        */
        sx={{
          borderTop: 1,
          borderColor: 'divider',
          '& .MuiTablePagination-toolbar': { minHeight: 52 },
        }}
        count={rootCount}
        page={page}
        onPageChange={(_event, next) => setPage(next)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number(event.target.value))
          setPage(0)
        }}
        rowsPerPageOptions={TABLE_PAGE_SIZE_OPTIONS}
        labelRowsPerPage={TABLE_ROWS_PER_PAGE_LABEL}
        labelDisplayedRows={({ from, to, count }) =>
          `${from}–${to} of ${count} top-level`
        }
      />
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
