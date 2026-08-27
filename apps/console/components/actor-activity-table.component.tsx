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

import { activityTargetLabel } from '@aglyn/aglyn/app-utils/activity-presenter'
import { CardDisplay, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatWireTimestamp } from '../utils/staff-timestamps'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'

export interface ActorActivityEntry {
  $id: string
  scopeType: 'host' | 'org' | 'unknown'
  scopeId: string
  action?: string
  target?: Record<string, unknown> | null
  createdAt?: { seconds: number } | null
}

export interface ActorActivityTableProps {
  /** The route to page through. The component appends `cursor`/`pageSize`. */
  endpoint: string
  header: string
  /** The card's `?`. Passed in because the docs topic differs by surface. */
  help?: HelpTipContent
  description?: string
  /** Site name by host id, so a row can say where rather than which id. */
  scopeNames?: Record<string, string | undefined>
}

/**
 * What one person did, paginated (AGL-1488).
 *
 * Forward-only, because that is what the underlying query is: a
 * collection-group walk resumed from a document path. `HostActivityTable`
 * keeps every cursor it has seen and can therefore go back; this one is
 * filtered server-side, so the page a cursor lands on is not necessarily the
 * page it produced, and offering Previous would be offering a promise the
 * query cannot keep. A visited cursor stack gives Back honestly instead.
 *
 * "Found nothing" and "could not look" are separate states, for the same
 * reason the host table separates them: a failed read rendered as an empty
 * audit log is a lie with a clean-looking face.
 */
export function ActorActivityTable(props: ActorActivityTableProps) {
  const { endpoint, header, help, description, scopeNames } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | undefined)?.uid ?? null

  const [rows, setRows] = useState<ActorActivityEntry[]>([])
  // Shared default, shared menu (AGL-693).
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)

  const loadPage = useCallback(
    async (targetPage: number, cursor: string | null) => {
      setLoading(true)
      try {
        const idToken = await (
          userRef.current as { getIdToken?: () => Promise<string> } | undefined
        )?.getIdToken?.()
        if (!idToken) return
        const url = new URL(endpoint, window.location.origin)
        url.searchParams.set('pageSize', String(pageSize))
        if (cursor) url.searchParams.set('cursor', cursor)
        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!response.ok) {
          setUnreadable(true)
          setRows([])
          return
        }
        const payload = (await response.json()) as {
          entries?: ActorActivityEntry[]
          nextCursor?: string | null
        }
        setUnreadable(false)
        setRows(payload?.entries ?? [])
        setNextCursor(payload?.nextCursor ?? null)
        setPage(targetPage)
      } catch {
        setUnreadable(true)
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [endpoint, pageSize],
  )

  useEffect(() => {
    if (!uid) return
    setCursors([null])
    void loadPage(0, null)
  }, [uid, loadPage])

  const scopeLabel = (entry: ActorActivityEntry): string => {
    if (entry.scopeType === 'org') return 'Organization'
    if (entry.scopeType === 'host') {
      return scopeNames?.[entry.scopeId] ?? entry.scopeId
    }
    return '—'
  }

  return (
    // `contentGutter*` like every other card on these pages — without them a
    // card's content sits flush against its own border while the ones above
    // and below it are inset, which reads as a rendering fault rather than a
    // new card.
    <CardDisplay header={header} help={help} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        {description ? (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        ) : null}
        {unreadable ? (
          // Not "no activity": that would be a failed read wearing the face
          // of a clean record, on the page where that mistake costs most.
          <Alert severity="warning">
            {'The activity log could not be read. This is not the same as ' +
              'there being none — try again, or check the browser console.'}
          </Alert>
        ) : rows.length === 0 && !loading ? (
          <Typography variant="body2" color="text.secondary">
            {'No activity recorded.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Action'}</TableCell>
                <TableCell>{'Target'}</TableCell>
                <TableCell>{'Where'}</TableCell>
                <TableCell>{'When'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((entry) => (
                <TableRow key={`${entry.scopeId}:${entry.$id}`}>
                  <TableCell>{entry.action ?? '—'}</TableCell>
                  <TableCell>
                    {activityTargetLabel(entry.target as never) || '—'}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={scopeLabel(entry)} />
                  </TableCell>
                  <TableCell>
                    {formatWireTimestamp(entry.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={rows.length}
          hasMore={Boolean(nextCursor)}
          disabled={loading}
          onPageChange={(next) => {
            if (next === page) return
            if (next > page) {
              const cursor = nextCursor
              setCursors((current) => [...current, cursor])
              void loadPage(next, cursor)
              return
            }
            const previous = cursors[next] ?? null
            setCursors((current) => current.slice(0, next + 1))
            void loadPage(next, previous)
          }}
          onPageSizeChange={setPageSize}
        />
      </Stack>
    </CardDisplay>
  )
}
ActorActivityTable.displayName = 'ActorActivityTable'

export default ActorActivityTable
