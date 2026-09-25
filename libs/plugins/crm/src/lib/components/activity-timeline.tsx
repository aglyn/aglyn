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
  mdiChevronDown,
  mdiChevronRight,
  mdiUnfoldLessHorizontal,
  mdiUnfoldMoreHorizontal,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import type { ListPaginationProps } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { Box, Button, Collapse, IconButton, Stack, Typography } from '@mui/material'
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from 'react'

/*
 * THE ROW GRAMMAR OF EVERY CRM HISTORY: the Timeline on a contact, the
 * Activity card on a lead, a company and a deal, and the Recent activity
 * feed under the contacts list.
 *
 * Salesforce's activity timeline is the model. Each entry is a collapsed
 * row — a chevron, the kind, a one-line heading and the who/whom/when under
 * it — that opens in place to what it holds: an email's body, a note's whole
 * text. The card header carries "Expand all", the list is paged by the
 * console's own footer, and nothing a row showed before is dropped: what
 * does not fit on the collapsed row is in the opened one.
 */

/** Which entries of one history are open. */
export interface TimelineExpansion {
  isExpanded: (key: string) => boolean
  toggle: (key: string) => void
  /** Every entry is open and none has been closed since. */
  allExpanded: boolean
  setAllExpanded: (expanded: boolean) => void
}

/**
 * The open/closed state of a history's entries, held by the CARD so that
 * the header's "Expand all" and each row's chevron act on one state.
 *
 * Kept as a default plus the keys that differ from it, so "Expand all"
 * reaches the entries of pages the reader has not turned to yet, and a row
 * closed after it stays closed.
 */
export function useTimelineExpansion(): TimelineExpansion {
  const [state, setState] = useState<{ all: boolean; flipped: ReadonlySet<string> }>(
    () => ({ all: false, flipped: new Set<string>() }),
  )
  const isExpanded = useCallback(
    (key: string) => state.all !== state.flipped.has(key),
    [state],
  )
  const toggle = useCallback((key: string) => {
    setState((current) => {
      const flipped = new Set(current.flipped)
      if (flipped.has(key)) flipped.delete(key)
      else flipped.add(key)
      return { all: current.all, flipped }
    })
  }, [])
  const setAllExpanded = useCallback((all: boolean) => {
    setState({ all, flipped: new Set<string>() })
  }, [])
  return useMemo(
    () => ({
      isExpanded,
      toggle,
      allExpanded: state.all && state.flipped.size === 0,
      setAllExpanded,
    }),
    [isExpanded, toggle, state, setAllExpanded],
  )
}

/** The card header's "Expand all" / "Collapse all". */
export function TimelineExpandAllButton(props: {
  expansion: TimelineExpansion
  disabled?: boolean
}) {
  const { expansion, disabled } = props
  const open = expansion.allExpanded
  return (
    <Button
      size="small"
      disabled={disabled}
      startIcon={
        <MdiIcon
          path={(open ? mdiUnfoldLessHorizontal : mdiUnfoldMoreHorizontal).path}
          size={0.8}
        />
      }
      onClick={() => expansion.setAllExpanded(!open)}
    >
      {open ? 'Collapse all' : 'Expand all'}
    </Button>
  )
}
TimelineExpandAllButton.displayName = 'TimelineExpandAllButton'

/** The listener window a history pages over. */
export interface TimelineWindow {
  /** A further page exists past the rows the listener holds. */
  hasMore?: boolean
  /** Widens the listener by one step. */
  showMore?: () => void
  /** The listener is reading; the page asked for is held rather than pulled back. */
  loading?: boolean
}

/**
 * Newest-first pages of a history, over rows a listener window holds.
 *
 * The window is the query's bound — a hundred activities on a record, a
 * page's worth on the feed — and a page the reader turns to past what it
 * holds widens it, so the footer's Next is live while the probe row says
 * more exists and the count stays "of more than" until it does not. Paged
 * in memory otherwise: the contact timeline merges three sources that share
 * no cursor, so only a slice of the merged stream can be turned.
 */
export function useTimelinePages(total: number, reader: TimelineWindow = {}) {
  const { hasMore = false, showMore, loading = false } = reader
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  // A page left empty by a delete shows the last one with rows; while the
  // window is reading, or holds less than exists, the page asked for stands.
  const shown = hasMore || loading ? page : Math.min(page, lastPage)
  const start = shown * pageSize
  const short = start + pageSize > total
  useEffect(() => {
    if (short && hasMore && !loading && showMore) showMore()
  }, [short, hasMore, loading, showMore])
  const slice = useCallback(
    <T,>(rows: readonly T[]): T[] => rows.slice(start, start + pageSize),
    [start, pageSize],
  )
  const footer: ListPaginationProps = {
    page: shown,
    pageSize,
    rowCount: Math.max(0, Math.min(pageSize, total - start)),
    count: hasMore ? undefined : total,
    hasMore,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
  }
  return { page: shown, pageSize, slice, footer }
}

export interface TimelineEntryProps {
  /** The glyph for the entry's kind. */
  icon: ReactNode
  /** The chips that say what the entry is: its kind, its direction, its delivery state. */
  chips?: ReactNode
  /** The one line a collapsed entry reads as: a subject, a summary, a note's first line. */
  title?: ReactNode
  /** A subject reads as one; a note's own words as body text. */
  titleVariant?: 'subtitle2' | 'body2'
  /** The line under it: who, to or from whom, when. */
  meta?: ReactNode
  /** What the entry opens to. Absent, there is nothing more to show and no chevron. */
  body?: ReactNode
  /** Controls on this one entry — edit, delete. */
  actions?: ReactNode
  expanded?: boolean
  onToggle?: () => void
  /** Names the chevron, "Expand {label}", so a screen reader knows which entry. */
  label?: string
}

/**
 * One entry of a history: collapsed to its heading and caption, opened in
 * place to its body.
 *
 * An entry with no body has no chevron — a spacer keeps its glyph in line
 * with the rows that have one — and its heading wraps rather than
 * truncating, since there is nowhere else to read the rest of it.
 */
export function TimelineEntry(props: TimelineEntryProps) {
  const {
    icon,
    chips,
    title,
    titleVariant = 'body2',
    meta,
    body,
    actions,
    expanded = false,
    onToggle,
    label,
  } = props
  const bodyId = useId()
  const expandable = Boolean(body) && Boolean(onToggle)
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'flex-start' }}
      data-testid="timeline-entry"
      data-expanded={expandable ? String(expanded) : undefined}
    >
      {expandable ? (
        <IconButton
          size="small"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label ?? 'entry'}`}
          onClick={onToggle}
          sx={{ mt: -0.25 }}
        >
          <MdiIcon path={(expanded ? mdiChevronDown : mdiChevronRight).path} size={0.8} />
        </IconButton>
      ) : (
        <Box aria-hidden sx={{ width: 30, flexShrink: 0 }} />
      )}
      <Stack
        sx={{
          color: 'text.secondary',
          pt: 0.25,
          fontSize: (theme) => theme.typography.h6.fontSize,
        }}
      >
        {icon}
      </Stack>
      <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
        {chips ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
          >
            {chips}
          </Stack>
        ) : null}
        {title ? (
          <Typography
            variant={titleVariant}
            component="div"
            noWrap={expandable && !expanded}
            sx={{ overflowWrap: 'anywhere' }}
          >
            {title}
          </Typography>
        ) : null}
        {meta}
        {expandable ? (
          <Collapse in={expanded} unmountOnExit>
            <Box id={bodyId}>{body}</Box>
          </Collapse>
        ) : (
          body
        )}
      </Stack>
      {actions ? (
        <Stack direction="row" spacing={0.5}>
          {actions}
        </Stack>
      ) : null}
    </Stack>
  )
}
TimelineEntry.displayName = 'TimelineEntry'
