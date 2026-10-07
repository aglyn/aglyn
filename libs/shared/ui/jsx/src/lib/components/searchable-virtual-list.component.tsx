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

import { mdiClose, mdiMagnify } from '@aglyn/shared-data-mdi'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { type ReactNode, useCallback } from 'react'
import { Virtuoso } from 'react-virtuoso'
import EmptyState from './empty-state.component'
import MdiIcon from './mdi-icon/mdi-icon'

/** One choice of a list's filter chips. */
export interface SearchableVirtualListFilterOption {
  value: string
  label: string
}

export interface SearchableVirtualListProps<T> {
  /** The rows to show, already searched and filtered by the caller. */
  items: readonly T[]
  itemKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  /** The search box; the caller decides what a word matches. */
  search: {
    value: string
    onChange: (value: string) => void
    label: string
    placeholder?: string
  }
  /**
   * One row of chips that narrows the list to one choice, with an "All" chip
   * first. Absent, the list has no chips.
   */
  filters?: {
    label: string
    options: readonly SearchableVirtualListFilterOption[]
    /** The chosen option's value, or `''` for all. */
    value: string
    onChange: (value: string) => void
    allLabel?: string
  }
  /** Scrolls with the rows, above them: a pinned section, a heading. */
  header?: ReactNode
  /** A line under the controls, such as how many rows match. */
  summary?: ReactNode
  loading?: boolean
  /** Placeholder rows while loading. */
  loadingRows?: number
  /** The height of a placeholder row, in px. */
  loadingRowHeight?: number
  error?: { message: string; onRetry?: () => void } | null
  /** What an empty list says; shown when `items` is empty and nothing is loading. */
  empty: { label: ReactNode; description?: ReactNode; action?: ReactNode }
  /**
   * The list's height. Absent, it fills its parent, which must give it one:
   * a flex column with a height, a dialog's content.
   */
  height?: number | string
  /** The gap between rows, in theme spacing units. */
  gap?: number
}

/**
 * A long list a person searches, narrows by a row of chips and scrolls, of
 * which only the rows on screen are drawn (AGL-3656, first for the font
 * picker's 1,950 families): the search box, the chips, the list, and its
 * loading, failed and empty states, in the console's own components.
 *
 * The caller owns the words and the chosen chip and hands in the rows they
 * leave, so the list never decides what a search matches. NOT in the barrel:
 * subpath-import it (`@aglyn/shared-ui-jsx/components/searchable-virtual-list.component`).
 */
export function SearchableVirtualList<T>(props: SearchableVirtualListProps<T>) {
  const {
    items,
    itemKey,
    renderItem,
    search,
    filters,
    header,
    summary,
    loading = false,
    loadingRows = 6,
    loadingRowHeight = 96,
    error = null,
    empty,
    height,
    gap = 1,
  } = props
  const computeItemKey = useCallback(
    (index: number) => itemKey(items[index] as T, index),
    [itemKey, items],
  )
  const itemContent = useCallback(
    (index: number) => (
      <Box sx={{ pb: gap }}>{renderItem(items[index] as T, index)}</Box>
    ),
    [gap, items, renderItem],
  )
  const Header = useCallback(() => <>{header ?? null}</>, [header])

  let body: ReactNode
  if (error) {
    body = (
      <Alert
        severity="error"
        action={
          error.onRetry ? (
            <Button color="inherit" size="small" onClick={error.onRetry}>
              {'Try again'}
            </Button>
          ) : undefined
        }
      >
        {error.message}
      </Alert>
    )
  } else if (loading) {
    body = (
      <Stack spacing={gap} aria-busy aria-label="Loading">
        {Array.from({ length: loadingRows }, (_, index) => (
          <Skeleton key={index} variant="rounded" height={loadingRowHeight} />
        ))}
      </Stack>
    )
  } else if (!items.length) {
    body = (
      <Box>
        {header}
        <EmptyState compact label={empty.label} description={empty.description} action={empty.action} />
      </Box>
    )
  } else {
    body = (
      <Virtuoso
        // Fills the column it is given, or the height it is told.
        style={height === undefined ? { flex: '1 1 auto', minHeight: 0 } : { height: '100%' }}
        totalCount={items.length}
        computeItemKey={computeItemKey}
        itemContent={itemContent}
        components={header ? { Header } : undefined}
      />
    )
  }

  return (
    <Stack
      spacing={1.5}
      sx={{ minHeight: 0, minWidth: 0, width: '100%', flex: height === undefined ? '1 1 auto' : undefined }}
    >
      <TextField
        size="small"
        fullWidth
        // A text box and not `type="search"`: the browser's own clear
        // control would sit beside this one.
        type="text"
        label={search.label}
        placeholder={search.placeholder}
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
        slotProps={{
          htmlInput: { inputMode: 'search', enterKeyHint: 'search' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <MdiIcon path={mdiMagnify.path} />
              </InputAdornment>
            ),
            endAdornment: search.value ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  edge="end"
                  aria-label="Clear search"
                  onClick={() => search.onChange('')}
                >
                  <MdiIcon path={mdiClose.path} />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />
      {filters ? (
        <Stack
          direction="row"
          spacing={1}
          role="radiogroup"
          aria-label={filters.label}
          sx={{
            // One row that scrolls sideways on a phone rather than wrapping
            // into a block of chips above a short list.
            overflowX: 'auto',
            flexWrap: 'nowrap',
            pb: 0.5,
            scrollbarWidth: 'none',
            '& > *': { flexShrink: 0 },
          }}
        >
          {[{ value: '', label: filters.allLabel ?? 'All' }, ...filters.options].map((option) => {
            const selected = filters.value === option.value
            return (
              <Chip
                key={option.value || '__all'}
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                label={option.label}
                size="small"
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => filters.onChange(option.value)}
              />
            )
          })}
        </Stack>
      ) : null}
      {summary ? (
        <Typography variant="caption" color="text.secondary" component="div">
          {summary}
        </Typography>
      ) : null}
      <Box
        sx={{
          minHeight: 0,
          flex: height === undefined ? '1 1 auto' : undefined,
          height: height === undefined ? undefined : height,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {body}
      </Box>
    </Stack>
  )
}
SearchableVirtualList.displayName = 'SearchableVirtualList'

export default SearchableVirtualList
