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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'

export interface OrgActivityCardProps {
  orgId: string
  max?: number
  header?: string
  /** Show only entries by this actor (member detail page, AGL-364). */
  actorId?: string
  /** Show only entries whose target is this id — changes made TO a
   * member/host/screen (AGL-389). */
  targetId?: string
}

/**
 * Org-level counterpart to `HostActivityCard` (AGL-118): newest-first feed
 * from `orgs/{orgId}/activity`, populated by the org settings/members/
 * invites API routes.
 */
export function OrgActivityCard(props: OrgActivityCardProps) {
  const { orgId, max = 20, header = 'Recent Activity', actorId, targetId } = props
  const firestore = useFirestore()
  const { data: entries } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'orgs', orgId, 'activity'), limit(200)),
    [firestore, orgId],
    { idField: '$id' },
  )
  // Filters (wave v5): free-text over action/actor plus a type select
  // when the entries carry one.
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const types = useMemo(
    () =>
      [
        ...new Set(
          (entries ?? [])
            .map((entry: any) => String(entry.type ?? ''))
            .filter(Boolean),
        ),
      ].sort(),
    [entries],
  )
  const items = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return [...(entries ?? [])]
      .filter(
        (entry: any) =>
          (!actorId || entry.actorId === actorId) &&
          (!targetId ||
            entry.target?.id === targetId ||
            entry.targetId === targetId) &&
          (!typeFilter || entry.type === typeFilter) &&
          (!term ||
            [entry.action, entry.actorEmail]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(term)),
      )
      .sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      )
      .slice(0, max)
  }, [entries, max, filter, typeFilter, actorId, targetId])

  return (
    <CardDisplay
      header={header}
      help={docsHelp('inviteTeammates', {
        anchor: '#activity-log',
        excerpt:
          'Who changed what in this organization — settings, members, ' +
          'invites, and site-level changes.',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {(entries ?? []).length > 5 ? (
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField
            size="small"
            label="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            sx={{ maxWidth: 240, flexGrow: 1 }}
          />
          {types.length > 1 ? (
            <TextField
              select
              size="small"
              label="Type"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="">{'All'}</MenuItem>
              {types.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </Stack>
      ) : null}
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {(entries ?? []).length
            ? 'Nothing matches the filter.'
            : 'No activity yet — changes made in the console appear here.'}
        </Typography>
      ) : (
        <List dense disablePadding>
          {items.map((entry) => (
            <ListItem key={entry.$id} disableGutters dense>
              <ListItemText
                primary={entry.action}
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
OrgActivityCard.displayName = 'OrgActivityCard'

export default OrgActivityCard
