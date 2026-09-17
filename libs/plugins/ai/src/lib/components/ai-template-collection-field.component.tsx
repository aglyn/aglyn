'use client'

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

import { COLLECTIONS_MAX_PER_HOST } from '@aglyn/aglyn/app-utils/collection-entries'
import { hostCollectionKind } from '@aglyn/aglyn/app-utils/collection-kind'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { MenuItem, TextField } from '@mui/material'
import { collection } from 'firebase/firestore'
import { useMemo } from 'react'

/**
 * The collection an entry page template is for (AGL-3043), in the brief
 * dialog once the member picks "Collection entry".
 *
 * It lists the site's CONTENT collections: the template door refuses any
 * other kind, and commerce's catalog collections share the same
 * subcollection. Mounted only while an entry template is being described, so
 * no other brief reads the site's collections at all. The read is bounded by
 * the platform's per-site cap, which the create route enforces, so it is the
 * whole list rather than a window of it.
 */

/** A content collection as the field offers it. */
export interface AiTemplateCollectionOption {
  id: string
  name: string
}

/**
 * The content collections among a site's collection rows, by name, each
 * named as the template step names it: display name, name, slug, then id.
 */
export function aiTemplateCollectionOptions(
  rows: ReadonlyArray<Record<string, unknown> & { $id: string }>,
): AiTemplateCollectionOption[] {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return rows
    .filter((row) => hostCollectionKind(row) === 'content')
    .map((row) => ({
      id: row.$id,
      name: text(row['displayName']) || text(row['name']) || text(row['slug']) || row.$id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface AiTemplateCollectionFieldProps {
  hostId: string
  /** The picked collection's id, or `null` for none yet. */
  value: string | null
  onChange: (collectionId: string | null) => void
  disabled?: boolean
}

export function AiTemplateCollectionField({
  hostId,
  value,
  onChange,
  disabled,
}: AiTemplateCollectionFieldProps) {
  const firestore = useFirestore()
  const { data, status } = useFirestoreCollection<Record<string, unknown> & { $id: string }>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'collections'),
        COLLECTIONS_MAX_PER_HOST,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const options = useMemo(
    () => aiTemplateCollectionOptions(ceilingedWindow(data, COLLECTIONS_MAX_PER_HOST).rows),
    [data],
  )
  const listed = status === 'success' && options.length > 0
  const helperText =
    status === 'loading'
      ? 'Loading this site’s collections…'
      : status === 'error'
        ? 'This site’s collections could not be loaded. Close this and try again.'
        : options.length
          ? 'Each page shows one entry of this collection.'
          : 'This site has no content collections yet. Add one in Content first.'

  return (
    <TextField
      select
      label="Collection"
      value={listed && options.some((option) => option.id === value) ? value : ''}
      onChange={(event) => onChange(event.target.value || null)}
      helperText={helperText}
      error={status === 'error'}
      disabled={disabled || !listed}
    >
      {options.map((option) => (
        <MenuItem key={option.id} value={option.id}>
          {option.name}
        </MenuItem>
      ))}
    </TextField>
  )
}

export default AiTemplateCollectionField
