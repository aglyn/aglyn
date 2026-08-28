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
  Collapse,
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
  useMediaQuery,
  useTheme,
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

/**
 * Column widths in px, after the leading controls column, in table order:
 * display name, id, path, description, updated, published, actions. The
 * Actions width is the one the grid lists give theirs, so the trailing
 * cluster lands in the same place on all four.
 *
 * These are DECLARED rather than measured, and that is the point — see
 * {@link ScreenColumnWidths}.
 */
const DATA_COLUMN_WIDTHS = [200, 130, 120, 200, 150, 150, 110]

/** Indent per level of nesting, in theme spacing units. */
const ROW_INDENT = 3

/** The theme's spacing step, for the widths that must be arithmetic. */
const SPACING_STEP = 8

/** The row's left padding plus the drag handle, in px. */
const CONTROLS_COLUMN_WIDTH = 36

/**
 * The collapse toggle and the gap before it, in px. Reserved only where the
 * tree actually nests — on a flat list this is dead width in every row, which
 * is the same reason the rows themselves reserve the slot conditionally.
 */
const TOGGLE_SLOT_WIDTH = 32

/**
 * The width of every column, declared once and rendered into the root table
 * and into the nested table each expanded row's children live in.
 *
 * Paired with `table-layout: fixed` this is what makes a column's width a
 * property of the LIST rather than of the rows that happen to be on screen.
 * Under the browser's default `auto` layout the table re-measures every
 * column from the content of the mounted rows, so opening a parent — new
 * names, new ids, new paths, and a deeper indent in this first column — moved
 * every column to the right. The nested tables carry the same widths, so a
 * child's cells line up with its parent's.
 *
 * ⚠️ The controls column is the one that can OVERFLOW rather than wrap: it is
 * `nowrap` and holds the indent. `controlsWidth` must account for everything
 * in it — the drag handle, the toggle slot where the tree nests, one
 * {@link ROW_INDENT} per level of the DEEPEST branch, and anything a caller
 * draws through `renderRowLeadingActions` — and it must be counted from the
 * whole tree, never from the part of it that happens to be expanded.
 */
function ScreenColumnWidths(props: { controlsWidth: number }) {
  const { controlsWidth } = props
  return (
    <colgroup>
      <col style={{ width: controlsWidth }} />
      {DATA_COLUMN_WIDTHS.map((width, index) => (
        <col key={index} style={{ width }} />
      ))}
    </colgroup>
  )
}
ScreenColumnWidths.displayName = 'ScreenColumnWidths'

/** A screen and its descendants, built from the data and never from state. */
type ScreenTreeNode = {
  row: ScreenHierarchyRow
  depth: number
  children: ScreenTreeNode[]
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
              ml: 2 + depth * ROW_INDENT,
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
  entry: ScreenTreeNode
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
  const { row, depth } = entry
  const hasChildren = entry.children.length > 0
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
        // No width here: the table's `colgroup` owns it, and it is sized for
        // the deepest branch so this indent cannot widen the column.
        sx={{ pl: 1 + depth * ROW_INDENT, whiteSpace: 'nowrap' }}
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
   * starts closed.
   *
   * Tracking the COLLAPSED set instead would make "empty" mean "everything
   * open", so a site whose screens nest deeply renders its whole tree on
   * arrival and the footer's "1-10 of 22 top-level" describes a fraction of
   * what is on screen. This way the default is the cheap one and the count is
   * honest: ten roots on the page is ten rows until a reader asks for more.
   *
   * NOTE this bounds what is RENDERED, not what is read. The page still
   * fetches the whole collection in one ordered, ceilinged query
   * (`SCREEN_WINDOW` in screens/page), so the children were already on the
   * client either way — closing them by default costs no extra fetch when a
   * reader opens one.
   *
   * A closed parent renders its children's `Collapse` and nothing inside it:
   * `unmountOnExit` keeps a closed subtree out of the DOM, out of React, and
   * out of dnd-kit's droppable registry, and mounts it on the way in.
   */
  const [expandedIds, setExpandedIds] = useState<Set<ScreenUid>>(new Set())
  const [activeId, setActiveId] = useState<ScreenUid | undefined>(undefined)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  /*
    A reader who has asked the system for less motion gets the rows in place
    instead of the slide — the disclosure still happens, it simply does not
    travel.

    A theme duration rather than `timeout="auto"`: `auto` derives the duration
    from the height, so a parent with twenty children takes noticeably longer
    to open than one with two, and a list of rows is not a drawer.
  */
  const theme = useTheme()
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const collapseTimeout = reduceMotion ? 0 : theme.transitions.duration.shorter

  const screensById = useMemo(() => {
    const map: Record<ScreenUid, ScreenRouteNode> = {}
    for (const screen of screens) {
      map[screen.$id] = { slug: screen.slug, parentId: screen.parentId }
    }
    return map
  }, [screens])

  /**
   * The hierarchy, built from the SCREENS alone.
   *
   * Deliberately independent of `expandedIds`: the shape of the tree, its
   * depth and its root count are facts about the data, and deriving them from
   * what is currently open is how a column width, a page count or a footer
   * total ends up changing when a reader opens a row. Expansion decides what
   * is rendered, further down, and nothing else.
   */
  const tree = useMemo<ScreenTreeNode[]>(() => {
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
    const build = (
      parentId: ScreenUid | undefined,
      depth: number,
    ): ScreenTreeNode[] =>
      (childrenByParent.get(parentId) ?? [])
        .sort(compareScreenSiblings)
        .map((row) => ({
          row,
          depth,
          children: build(row.$id, depth + 1),
        }))
    return build(undefined, 0)
  }, [screens, screensById])

  /**
   * How deep the DEEPEST branch goes, expanded or not — the number the
   * controls column is sized for. Measuring only the open branches is what
   * would put the width back under the reader's control.
   */
  const maxDepth = useMemo(() => {
    const deepest = (nodes: ScreenTreeNode[]): number =>
      nodes.reduce(
        (max, node) => Math.max(max, node.depth, deepest(node.children)),
        0,
      )
    return deepest(tree)
  }, [tree])
  // A collapse toggle can only appear where the tree actually nests. Drives
  // whether rows reserve space for one, and whether the column pays for it.
  const anyExpandable = maxDepth > 0
  const controlsWidth =
    CONTROLS_COLUMN_WIDTH +
    (anyExpandable ? TOGGLE_SLOT_WIDTH : 0) +
    maxDepth * ROW_INDENT * SPACING_STEP
  // Below this the columns cannot all fit, and the container scrolls instead
  // of squeezing them; above it the surplus is shared out between them.
  const tableSx = {
    tableLayout: 'fixed' as const,
    minWidth:
      controlsWidth + DATA_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0),
  }

  /**
   * Pagination that pages ROOTS, never rows (AGL-693).
   *
   * The layouts list pages rows. A tree cannot take that literally: slicing
   * by row would put a child on a different page from its parent, and a
   * hierarchy split across pages is not a hierarchy — the indentation would
   * be describing a parent the reader cannot see.
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
  const rootCount = tree.length
  // A root carries its descendants with it, so the slice is over ROOTS and
  // the subtree travels inside the node.
  const pagedRoots = useMemo(
    () => tree.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [tree, page, rowsPerPage],
  )

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

  /**
   * One level of the tree, and — through the `Collapse` under each parent —
   * every level below it.
   *
   * A parent's children live in a NESTED table inside a full-width cell,
   * which is what lets the disclosure be a slide rather than an insert: a
   * `<tr>` cannot be animated (`overflow` does not apply to a table row), a
   * block wrapping one can. The nested table carries the same
   * {@link ScreenColumnWidths}, so a child's cells sit under its parent's.
   */
  const renderNodes = (nodes: ScreenTreeNode[]): ReactNode =>
    nodes.map((node) => {
      const { row } = node
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
            depth={node.depth}
            dragging={Boolean(activeId)}
          />
          <ScreenTableRow
            entry={node}
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
          {node.children.length ? (
            <TableRow>
              <TableCell
                colSpan={COLUMN_COUNT}
                padding="none"
                // The children draw their own rules; a border here would
                // double the one under the last of them.
                sx={{ border: 0 }}
              >
                <Collapse
                  in={expandedIds.has(row.$id)}
                  unmountOnExit
                  timeout={collapseTimeout}
                >
                  <Table
                    size="small"
                    sx={tableSx}
                    aria-label={`Screens nested under ${
                      row.displayName || row.$id
                    }`}
                  >
                    <ScreenColumnWidths controlsWidth={controlsWidth} />
                    <TableBody>{renderNodes(node.children)}</TableBody>
                  </Table>
                </Collapse>
              </TableCell>
            </TableRow>
          ) : null}
        </Fragment>
      )
    })

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
        <Table size="small" aria-label="Screens hierarchy" sx={tableSx}>
          <ScreenColumnWidths controlsWidth={controlsWidth} />
          {/* Header height matches the DataTable used by layouts, components
              and templates (AGL-693/694/695) — a size="small" TableHead is
              shorter than a DataGrid column header, so without this the
              screens table reads as a different, cramped design. */}
          <TableHead sx={{ '& .MuiTableCell-head': { height: TABLE_HEAD_HEIGHT } }}>
            <TableRow>
              {/* Widths live in the `colgroup` above, for every table in the
                  tree at once — a per-cell width here would describe the root
                  table only. */}
              <TableCell padding="none" />
              <TableCell>Display name</TableCell>
              <TableCell>ID</TableCell>
              <TableCell>Path</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell>Published</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading &&
              !rootCount &&
              [0, 1, 2].map((index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: COLUMN_COUNT }).map((_, cell) => (
                    <TableCell key={cell}>
                      <Skeleton variant="text" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading && !rootCount && (
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
            {renderNodes(pagedRoots)}
            {/*
              Only when there is something to reorder. The row is 32px tall and
              merely `visibility: hidden` while idle, so on an EMPTY list it
              added a blank strip between the empty state and the footer —
              which read as a stray border with a gap above it. Nothing can be
              dragged onto it when there are no rows.
            */}
            {rootCount > 0 ? (
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
