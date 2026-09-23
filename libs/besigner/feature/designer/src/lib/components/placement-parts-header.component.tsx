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

import type * as Aglyn from '@aglyn/aglyn'
import { HelpTip } from '@aglyn/shared-ui-jsx'
import { Box, Link, MenuItem, TextField, Typography } from '@mui/material'
import { type ChangeEvent, useCallback, useMemo } from 'react'
import {
  describePart,
  type PartNode,
  type PlacementKind,
  placementCopy,
} from '../utils/placement-override-copy'

export interface PlacementPartsHeaderProps {
  /** Which kind of shared thing this is a placement of. */
  kind: PlacementKind
  /** The definition's parts, in tree order (`listInstanceStyleTargets`). */
  parts: readonly Aglyn.InstanceStyleTarget[]
  /** The definition's nodes, which the part names are read from. */
  definitionNodes?: Record<string, PartNode>
  /** The placement's declared-property values, for part names that show them. */
  propValues?: Record<string, unknown>
  /** The picked part's key. */
  value: string
  onChange: (key: string) => void
  /** Keys of the parts this page already changes. */
  changedKeys: ReadonlySet<string>
  /** The line under the picker. */
  helperText: string
  /** How many changes this page makes, across every part. */
  changeCount: number
  onResetAll: () => void
  /** The help tip's body. */
  helpExcerpt: string
  /** The help tip's docs link. */
  helpHref: string
}

/**
 * The top of the "Change it on this page only" section, shared by the Styles
 * and Attributes tabs (AGL-3288): heading, one line of explanation, the
 * "Which part?" picker and the "N changes on this page · Reset all" line.
 *
 * One component so the two tabs cannot word the same idea two ways — the
 * mismatch the old "Style target" / "Override target" pair was.
 */
export function PlacementPartsHeader({
  kind,
  parts,
  definitionNodes,
  propValues,
  value,
  onChange,
  changedKeys,
  helperText,
  changeCount,
  onResetAll,
  helpExcerpt,
  helpHref,
}: PlacementPartsHeaderProps) {
  const copy = placementCopy(kind)
  const labels = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const entry of parts) {
      byKey.set(
        entry.key,
        describePart(entry, definitionNodes, { kind, propValues }),
      )
    }
    return byKey
  }, [parts, definitionNodes, kind, propValues])

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange],
  )

  return (
    <Box>
      <Typography
        variant="overline"
        color="text.secondary"
        component="div"
        sx={{ display: 'flex', alignItems: 'center' }}
      >
        {copy.sectionTitle}
        <HelpTip
          title={copy.sectionTitle}
          excerpt={helpExcerpt}
          href={helpHref}
          sx={{ ml: 0.25, fontSize: '0.9em' }}
        />
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ mt: 0, mb: 1 }}
      >
        {copy.intro}
      </Typography>
      {parts.length > 1 ? (
        <TextField
          select
          fullWidth
          size="small"
          margin="dense"
          label={copy.partPickerLabel}
          value={value}
          onChange={handleChange}
          helperText={helperText}
          slotProps={{
            select: {
              // The closed box shows the part's name only; the "(changed)"
              // mark is for choosing between parts, in the open menu.
              renderValue: (key) =>
                labels.get(key as string) ?? copy.wholePart,
            },
          }}
        >
          {parts.map((entry) => (
            <MenuItem
              key={entry.key}
              value={entry.key}
              // Nesting reads as nesting: the definition's tree is the only
              // map an author has of what is inside it.
              sx={{ pl: 2 + entry.depth * 1.5 }}
            >
              {labels.get(entry.key)}
              {changedKeys.has(entry.key) ? (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    ml: 1,
                    color: 'secondary.main',
                    fontSize: '0.75rem',
                  }}
                >
                  <Box
                    component="span"
                    aria-hidden
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: 'secondary.main',
                      mr: 0.5,
                    }}
                  />
                  {copy.changedMark}
                </Box>
              ) : null}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 0.75,
          mt: 0.5,
          mb: 1,
        }}
      >
        <Typography variant="body2" color="text.secondary" component="span">
          {copy.summary(changeCount)}
        </Typography>
        {changeCount > 0 ? (
          <>
            <Typography
              variant="body2"
              color="text.secondary"
              component="span"
              aria-hidden
            >
              {'·'}
            </Typography>
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={onResetAll}
              aria-label={copy.resetAllAria}
            >
              {copy.resetAll}
            </Link>
          </>
        ) : null}
      </Box>
    </Box>
  )
}

export default PlacementPartsHeader
