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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'

export interface HostActivityTableProps {
  hostId: string
  pageSize?: number
}

/**
 * Paginated activity feed (AGL-249): the full `hosts/{hostId}/activity`
 * history on the Setup page — cursor pagination (newest first) instead of
 * the dashboard card's bounded window.
 */
export function HostActivityTable(props: HostActivityTableProps) {
  const { hostId, pageSize = 25 } = props
  const firestore = useFirestore()
  const [rows, setRows] = useState<any[]>([])
  const [cursors, setCursors] = useState<QueryDocumentSnapshot[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadPage = useCallback(
    async (targetPage: number, cursor?: QueryDocumentSnapshot) => {
      setLoading(true)
      try {
        const base = collection(firestore, 'hosts', hostId, 'activity')
        // One extra row detects whether a next page exists.
        const snapshot = await getDocs(
          query(
            base,
            orderBy('createdAt', 'desc'),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(pageSize + 1),
          ),
        )
        const docs = snapshot.docs.slice(0, pageSize)
        setRows(docs.map((entry) => ({ $id: entry.id, ...entry.data() })))
        setHasMore(snapshot.docs.length > pageSize)
        setPage(targetPage)
        setCursors((previous) => {
          const next = previous.slice(0, targetPage)
          const last = docs[docs.length - 1]
          if (last) next[targetPage] = last
          return next
        })
      } catch (error) {
        console.error(error)
        setRows([])
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    },
    [firestore, hostId, pageSize],
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  return (
    <CardDisplay
      header={'Activity'}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        {rows.length === 0 && !loading ? (
          <Typography variant="body2" color="text.secondary">
            {'No activity yet — changes made in the console appear here.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Action'}</TableCell>
                <TableCell>{'Target'}</TableCell>
                <TableCell>{'Who'}</TableCell>
                <TableCell>{'When'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((entry) => (
                <TableRow key={entry.$id}>
                  <TableCell>{entry.action}</TableCell>
                  <TableCell>{entry.target?.name ?? entry.target?.id ?? '—'}</TableCell>
                  <TableCell>{entry.actorEmail ?? 'Someone'}</TableCell>
                  <TableCell>
                    {entry.createdAt?.toDate?.().toLocaleString() ?? ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            color="secondary"
            disabled={loading || page === 0}
            onClick={() => loadPage(page - 1, cursors[page - 2])}
          >
            {'Previous'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {`Page ${page + 1}`}
          </Typography>
          <Button
            size="small"
            color="secondary"
            disabled={loading || !hasMore}
            onClick={() => loadPage(page + 1, cursors[page])}
          >
            {'Next'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
HostActivityTable.displayName = 'HostActivityTable'

export default HostActivityTable
