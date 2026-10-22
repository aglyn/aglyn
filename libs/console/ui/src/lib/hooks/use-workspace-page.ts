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

import { useEffect, useMemo, useState } from 'react'

/**
 * Workspace cards per page.
 *
 * Five rather than the console-wide table default: these are CARDS, three to
 * a row at the wide breakpoint, and the number that keeps a picker on one
 * screen is a number about the grid rather than about rows the reader trades
 * against scrolling. The footer therefore offers no size menu — see
 * `ListPagination`, which draws none without `onPageSizeChange`.
 */
export const WORKSPACE_PAGE_SIZE = 5

export interface WorkspacePage<T> {
  /** The cards this page renders. */
  visible: T[]
  /** Zero-based, to match `ListPagination` and MUI. */
  page: number
  setPage: (page: number) => void
  pageSize: number
  /**
   * A further page exists — either inside the loaded window, or behind it.
   * The membership listen cannot state a total, so this is what stops the
   * footer claiming one it does not have.
   */
  hasMore: boolean
}

/**
 * Pages a workspace picker over the membership window (AGL-2501, AGL-2336).
 *
 * The two workspace pickers — the console root and the billing entry page —
 * rendered every loaded membership in one wall and ended in a "Load more
 * workspaces" button. That was the console's fourth pagination grammar for an
 * act the rest of it does with one control, and the weakest of them: it only
 * ever grew, so a reader who opened a hundred workspaces could not get back
 * to the first five without remounting the page, and it could not say where
 * in the list they were.
 *
 * ## Why the window still grows underneath
 *
 * `useOrgScope` holds a live listen over `users/{uid}/orgs`, capped at
 * `ORG_PAGE_SIZE` and widened by `loadMoreOrgs`. That window is app-wide —
 * it is what resolves WHICH workspace the console is in — so a picker may not
 * re-key it to its own page size. Paging is therefore a slice of what is
 * loaded, and reaching the end of the loaded rows grows the window rather
 * than presenting it as the end of the list. Both halves are needed: without
 * the slice the picker cannot page, and without the growth page eleven would
 * be a wall for an agency at its fiftieth client.
 */
export function useWorkspacePage<T>(
  rows: readonly T[],
  options: { hasMoreRows: boolean; loadMoreRows: () => void },
): WorkspacePage<T> {
  const { hasMoreRows, loadMoreRows } = options
  const [page, setPage] = useState(0)
  const start = page * WORKSPACE_PAGE_SIZE
  const visible = useMemo(
    () => rows.slice(start, start + WORKSPACE_PAGE_SIZE),
    [rows, start],
  )

  /*
   * The reader has walked to the end of what is loaded and the listen says
   * there may be more, so widen it. Keyed on the page they are ON rather than
   * on a click handler: `setPage` is handed to a footer that also jumps to
   * the last page, and a growth that only a Next click could trigger would
   * leave that jump on an empty page.
   */
  useEffect(() => {
    if (hasMoreRows && start + WORKSPACE_PAGE_SIZE >= rows.length) {
      loadMoreRows()
    }
  }, [hasMoreRows, loadMoreRows, rows.length, start])

  return {
    visible,
    page,
    setPage,
    pageSize: WORKSPACE_PAGE_SIZE,
    hasMore: hasMoreRows || rows.length > start + WORKSPACE_PAGE_SIZE,
  }
}

export default useWorkspacePage
