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
  type ContactCustomValue,
  type ContactFieldDefinition,
  crmContactCustomColumn,
} from '@aglyn/aglyn'
import { Link, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'

/**
 * The column `field` a definition's key is listed under — namespaced so a
 * key can never collide with a built-in column, and the shared contract
 * since AGL-2617 so a saved view's filter clause and its column list name
 * the field the same way.
 */
export const customFieldColumnId = crmContactCustomColumn

/**
 * One stored value, as the list shows it.
 *
 * A checkbox reads as Yes or an em dash rather than `true`/`false`; a date
 * as the local day rather than the ISO stamp it is stored as; a link as an
 * anchor. Everything else is the value itself, and nothing is `null` on
 * screen — a cleared value and an absent one look the same, because to the
 * reader of a list they are.
 */
export function formatContactCustomValue(
  definition: Pick<ContactFieldDefinition, 'type'>,
  value: ContactCustomValue | undefined,
): string {
  if (value === undefined || value === null || value === '') return ''
  switch (definition.type) {
    case 'checkbox':
      return value === true ? 'Yes' : value === false ? 'No' : String(value)
    case 'date': {
      const ms = typeof value === 'string' ? Date.parse(value) : Number(value)
      return Number.isFinite(ms) ? new Date(ms).toLocaleDateString() : String(value)
    }
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value)
    default:
      return String(value)
  }
}

/**
 * The contact list's columns for the org's custom fields (AGL-2601), one
 * per ACTIVE definition in `order`.
 *
 * The value is read off `row.custom`, which the list projects from THIS
 * holder's facet — the same projection that puts `tags` and `notes` on the
 * row — so a column can never show another holder's value. Sorting and
 * filtering are off: the value lives under `facets.{group}.custom.{key}`,
 * a path the list's query does not order on and no index covers, and a
 * column that sorted the loaded window would look like it sorted the
 * collection.
 *
 * Retired definitions get no column. Their values are still on the rows,
 * and an export can still read them; a column for a field the merchant
 * retired would be the field refusing to go away.
 */
export function customFieldColumns(
  definitions: readonly ContactFieldDefinition[],
): GridColDef[] {
  return definitions
    .filter((definition) => !definition.retiredAt)
    .map((definition) => ({
      field: customFieldColumnId(definition.key),
      headerName: definition.label,
      flex: 0.8,
      minWidth: 140,
      sortable: false,
      filterable: false,
      valueGetter: (_value: unknown, row: { custom?: Record<string, ContactCustomValue> }) =>
        formatContactCustomValue(definition, row.custom?.[definition.key]),
      renderCell: ({ row }: { row: { custom?: Record<string, ContactCustomValue> } }) => {
        const raw = row.custom?.[definition.key]
        const text = formatContactCustomValue(definition, raw)
        if (!text) return null
        if (definition.type === 'url') {
          return (
            <Link
              href={text}
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              onClick={(event) => event.stopPropagation()}
            >
              {text}
            </Link>
          )
        }
        return <Typography variant="body2">{text}</Typography>
      },
    }))
}
