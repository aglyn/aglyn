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
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'

export interface HostActivityCardProps {
  hostId: string
  /** Show only entries for this target id (e.g. a screen detail page). */
  targetId?: string
  /** Entries rendered after filtering/sorting. */
  max?: number
  header?: string
}

/**
 * Recent user activity (AGL-118): newest-first feed from
 * `hosts/{hostId}/activity`, optionally filtered to one target so detail
 * pages show just their own history.
 */
export function HostActivityCard(props: HostActivityCardProps) {
  const { hostId, targetId, max = 20, header = 'Recent Activity' } = props
  const firestore = useFirestore()
  const { data: entries } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'activity'), limit(200)),
    { idField: '$id' },
  )
  const items = useMemo(
    () =>
      [...(entries ?? [])]
        .filter((entry) => !targetId || entry.target?.id === targetId)
        .sort(
          (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
        )
        .slice(0, max),
    [entries, targetId, max],
  )

  return (
    <CardDisplay
      header={header}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No activity yet — changes made in the console appear here.'}
        </Typography>
      ) : (
        <List dense disablePadding>
          {items.map((entry) => (
            <ListItem key={entry.$id} disableGutters dense>
              <ListItemText
                primary={
                  entry.target?.name
                    ? `${entry.action} — ${entry.target.name}`
                    : entry.action
                }
                secondary={`${entry.actorEmail ?? 'Someone'} · ${
                  entry.createdAt?.toDate?.().toLocaleString() ?? ''
                }`}
              />
            </ListItem>
          ))}
        </List>
      )}
    </CardDisplay>
  )
}
HostActivityCard.displayName = 'HostActivityCard'

export default HostActivityCard
