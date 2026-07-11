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

import * as Aglyn from '@aglyn/aglyn'
import { mdiClose, mdiPlus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Autocomplete,
  Button,
  IconButton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { action } from 'mobx'
import { observer } from 'mobx-react-lite'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SxBreakpoint } from '../utils/responsive-sx'
import { readSxValue, writeSxValue } from '../utils/responsive-sx'

/**
 * Curated, grouped suggestions for the builder's property picker
 * (freeSolo, so any CSS/sx property still works).
 */
const CSS_PROPERTY_SUGGESTIONS: Array<{ group: string; name: string }> = [
  ...['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'overflow', 'position', 'top', 'right', 'bottom', 'left', 'zIndex'].map((name) => ({ group: 'Layout', name })),
  ...['margin', 'padding', 'gap', 'rowGap', 'columnGap'].map((name) => ({ group: 'Spacing', name })),
  ...['fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textTransform', 'textDecoration', 'whiteSpace'].map((name) => ({ group: 'Typography', name })),
  ...['color', 'backgroundColor', 'background', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'opacity'].map((name) => ({ group: 'Background & color', name })),
  ...['border', 'borderRadius', 'borderColor', 'borderWidth', 'borderStyle', 'outline'].map((name) => ({ group: 'Border', name })),
  ...['boxShadow', 'transform', 'transition', 'filter', 'cursor', 'objectFit', 'aspectRatio'].map((name) => ({ group: 'Effects', name })),
]

const kebabToCamel = (name: string) =>
  name.replace(/-([a-z])/g, (match, letter: string) => letter.toUpperCase())
const camelToKebab = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** Parses `prop: value;` CSS declarations into a JSS record (AGL-332). */
export function parseCssDeclarations(css: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const raw of css.split(';')) {
    const declaration = raw.trim()
    if (!declaration) continue
    const colon = declaration.indexOf(':')
    if (colon <= 0) continue
    const property = kebabToCamel(declaration.slice(0, colon).trim())
    const value = declaration.slice(colon + 1).trim()
    if (property && value) result[property] = value
  }
  return result
}

/** Serializes scalar sx entries into CSS declarations for the CSS tab. */
export function serializeCssDeclarations(
  sx: Record<string, any> | undefined,
  breakpoint: SxBreakpoint | null,
): string {
  const lines: string[] = []
  for (const property of Object.keys(sx ?? {})) {
    const value = readSxValue(sx, property, breakpoint)
    if (value === undefined || value === null) continue
    if (typeof value === 'object') continue // selectors/nested — JSON tab
    lines.push(`${camelToKebab(property)}: ${String(value)};`)
  }
  return lines.join('\n')
}

export interface CustomCssFormProps {
  node?: Aglyn.NodeSchema
  /** Active artboard breakpoint; builder/CSS edits scope to it (AGL-333). */
  breakpoint: SxBreakpoint | null
}

type BuilderRow = { property: string; value: string }

/**
 * Custom CSS for the selected element's `sx` (AGL-332): a friendly
 * builder (property + value rows), a raw CSS mode, and a raw JSS/JSON
 * mode. Builder and CSS edits respect the active breakpoint scope; the
 * JSON mode edits the full sx document (including responsive objects and
 * nested selectors) verbatim.
 */
export const CustomCssForm = observer((props: CustomCssFormProps) => {
  const { node, breakpoint } = props
  const nodeSx = (node?.sx ?? {}) as Record<string, any>
  const [mode, setMode] = useState<'builder' | 'css' | 'json'>('builder')
  const [cssDraft, setCssDraft] = useState('')
  const [jsonDraft, setJsonDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo<BuilderRow[]>(
    () =>
      Object.keys(nodeSx)
        .map((property) => ({
          property,
          value: readSxValue(nodeSx, property, breakpoint),
        }))
        .filter(
          (row) =>
            row.value !== undefined &&
            row.value !== null &&
            typeof row.value !== 'object',
        )
        .map((row) => ({ property: row.property, value: String(row.value) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(nodeSx), breakpoint],
  )
  const [draftRow, setDraftRow] = useState<BuilderRow>({ property: '', value: '' })

  useEffect(() => {
    setCssDraft(serializeCssDeclarations(nodeSx, breakpoint))
    setJsonDraft(JSON.stringify(nodeSx, null, 2))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, node?.$id])

  const writeProperty = useCallback(
    (property: string, value: string | undefined) => {
      if (!node || !property) return
      action(() => {
        node.sx = writeSxValue(
          (node.sx ?? {}) as Record<string, any>,
          property,
          value === '' ? undefined : value,
          breakpoint,
        ) as any
      })()
    },
    [node, breakpoint],
  )

  const applyCss = useCallback(() => {
    if (!node) return
    const parsed = parseCssDeclarations(cssDraft)
    action(() => {
      let sx = (node.sx ?? {}) as Record<string, any>
      // Clear scalar declarations no longer present, then write the rest.
      for (const row of rows) {
        if (!(row.property in parsed)) {
          sx = writeSxValue(sx, row.property, undefined, breakpoint)
        }
      }
      for (const [property, value] of Object.entries(parsed)) {
        sx = writeSxValue(sx, property, value, breakpoint)
      }
      node.sx = sx as any
    })()
    setError(null)
  }, [node, cssDraft, rows, breakpoint])

  const applyJson = useCallback(() => {
    if (!node) return
    try {
      const parsed = JSON.parse(jsonDraft || '{}')
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('The sx value must be a JSON object')
      }
      action(() => {
        node.sx = parsed
      })()
      setError(null)
    } catch (parseError: any) {
      setError(parseError?.message ?? 'Invalid JSON')
    }
  }, [node, jsonDraft])

  return (
    <Stack spacing={1.5}>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={mode}
        onChange={(event, value) => value && setMode(value)}
      >
        <ToggleButton value="builder">{'Builder'}</ToggleButton>
        <ToggleButton value="css">{'CSS'}</ToggleButton>
        <ToggleButton value="json">{'JSS (sx)'}</ToggleButton>
      </ToggleButtonGroup>

      {mode === 'builder' ? (
        <Stack spacing={1}>
          {rows.map((row) => (
            <Stack
              key={row.property}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <TextField
                size="small"
                value={row.property}
                disabled
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                value={row.value}
                onChange={(event) =>
                  writeProperty(row.property, event.target.value)
                }
                sx={{ flex: 1 }}
              />
              <IconButton
                size="small"
                aria-label={`Remove ${row.property}`}
                onClick={() => writeProperty(row.property, undefined)}
              >
                <MdiIcon path={mdiClose.path} size={0.7} />
              </IconButton>
            </Stack>
          ))}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Autocomplete
              freeSolo
              size="small"
              options={CSS_PROPERTY_SUGGESTIONS}
              groupBy={(option) =>
                typeof option === 'string' ? '' : option.group
              }
              getOptionLabel={(option) =>
                typeof option === 'string' ? option : option.name
              }
              inputValue={draftRow.property}
              onInputChange={(event, value) =>
                setDraftRow((prev) => ({ ...prev, property: value }))
              }
              renderInput={(params) => (
                <TextField {...params} placeholder="property" />
              )}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              placeholder="value"
              value={draftRow.value}
              onChange={(event) =>
                setDraftRow((prev) => ({ ...prev, value: event.target.value }))
              }
              sx={{ flex: 1 }}
            />
            <IconButton
              size="small"
              aria-label="Add property"
              disabled={!draftRow.property.trim() || !draftRow.value.trim()}
              onClick={() => {
                writeProperty(
                  kebabToCamel(draftRow.property.trim()),
                  draftRow.value.trim(),
                )
                setDraftRow({ property: '', value: '' })
              }}
            >
              <MdiIcon path={mdiPlus.path} size={0.8} />
            </IconButton>
          </Stack>
        </Stack>
      ) : null}

      {mode === 'css' ? (
        <Stack spacing={1}>
          <TextField
            multiline
            minRows={5}
            value={cssDraft}
            onChange={(event) => setCssDraft(event.target.value)}
            placeholder={'border-radius: 8px;\nbox-shadow: 0 2px 8px rgba(0,0,0,0.2);'}
            slotProps={{
              htmlInput: {
                style: { fontFamily: 'monospace', fontSize: 12 },
              },
            }}
          />
          <Button size="small" variant="outlined" onClick={applyCss}>
            {'Apply CSS'}
          </Button>
        </Stack>
      ) : null}

      {mode === 'json' ? (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {'Full sx document — supports responsive objects ' +
              '({ xs, sm, … }) and nested selectors ("&:hover").'}
          </Typography>
          <TextField
            multiline
            minRows={6}
            value={jsonDraft}
            onChange={(event) => setJsonDraft(event.target.value)}
            error={Boolean(error)}
            helperText={error ?? undefined}
            slotProps={{
              htmlInput: {
                style: { fontFamily: 'monospace', fontSize: 12 },
              },
            }}
          />
          <Button size="small" variant="outlined" onClick={applyJson}>
            {'Apply JSS'}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  )
})
CustomCssForm.displayName = 'CustomCssForm'

export default CustomCssForm
