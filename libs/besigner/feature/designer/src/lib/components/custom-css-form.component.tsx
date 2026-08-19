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
import {
  canonicalSxProperties,
  expandSxAliases,
  isAtomicSxValue,
} from '@aglyn/shared-data-enums'
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
import { observer } from 'mobx-react-lite'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SxBreakpoint } from '../utils/responsive-sx'
import { readSxValue } from '../utils/responsive-sx'
import { applyStylePartialToSx } from '../utils/style-field-groups'
import { getNodeStyleTarget } from '../utils/style-target'

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

/**
 * The scalar declarations the Builder rows and the CSS tab show for `sx`,
 * named in the Styles panel's own spelling (AGL-2390).
 *
 * MUI honours two names for the same declaration, and every other control
 * in this panel is named for the CSS longhand (AGL-2207). Listing the raw
 * keys made this form the one place that said `bgcolor` where the Colors
 * group said `backgroundColor` and BoxStyler said `paddingTop` — the same
 * node, two vocabularies, and the author with no way to tell that the two
 * rows were one declaration. The expansion is a pure renaming of what
 * already renders (order preserved, non-atomic values left alone), and it
 * is what makes the row's × and the CSS tab's clear reach the key that is
 * actually painting.
 *
 * The JSS tab deliberately does NOT go through here: it edits the stored
 * document verbatim, which is the escape hatch for everything the named
 * controls cannot express.
 */
export function customCssDeclarations(
  sx: Record<string, any> | undefined,
  breakpoint: SxBreakpoint | null,
): Array<{ property: string; value: string }> {
  const source = expandSxAliases((sx ?? {}) as Record<string, any>, {
    deep: true,
  })
  const out: Array<{ property: string; value: string }> = []
  for (const property of Object.keys(source)) {
    const value = readSxValue(source, property, breakpoint)
    if (value === undefined || value === null) continue
    if (typeof value === 'object') continue // selectors/nested — JSON tab
    out.push({ property, value: String(value) })
  }
  return out
}

/** Serializes scalar sx entries into CSS declarations for the CSS tab. */
export function serializeCssDeclarations(
  sx: Record<string, any> | undefined,
  breakpoint: SxBreakpoint | null,
): string {
  return customCssDeclarations(sx, breakpoint)
    .map(({ property, value }) => `${camelToKebab(property)}: ${value};`)
    .join('\n')
}

/**
 * The declaration(s) one named property writes, in the panel's spelling.
 *
 * The property field is free-solo and the CSS tab takes any declaration, so
 * an author can type `bgcolor` or `py` at any time — this form is the one
 * seam in the product where a fresh alias can still enter a document. It
 * resolves the name the same way {@link expandSxAliases} resolves a stored
 * one, so what the author typed and what the panel reads back agree.
 *
 * A value the expansion cannot carry per-side — `p: '10px 20px'`, the CSS
 * shorthand's own syntax — keeps the name the author gave it rather than
 * being copied onto four longhands CSS would drop. Clearing always expands,
 * because a cleared alias has to take every longhand it was painting with
 * it.
 */
export function canonicalCssPartial(
  property: string,
  value: string | undefined,
): Record<string, unknown> {
  const canonical = canonicalSxProperties(property)
  const expandable =
    canonical.length === 1 || value === undefined || isAtomicSxValue(value)
  if (!canonical.length || !expandable) return { [property]: value }
  return Object.fromEntries(canonical.map((name) => [name, value]))
}

/**
 * Applies custom-CSS edits to `sx` — the write both the Builder rows and
 * the CSS tab's Apply go through (AGL-2390).
 *
 * Routed through the Styles panel's own write seam so this form cannot
 * drift from it again: {@link applyStylePartialToSx} expands the alias keys
 * the edit COLLIDES with before writing, which is what makes clearing a
 * declaration actually clear (deleting `backgroundColor` while a `bgcolor`
 * underneath keeps painting is AGL-2207's sharper failure) and what stops a
 * write leaving two spellings of one declaration in the record.
 *
 * Scheme-agnostic (`null`): this form has always written the base slice,
 * and the dark-preview scoping belongs to the named color fields.
 */
export function applyCustomCssEdits(
  sx: Record<string, any> | undefined,
  edits: Record<string, string | undefined>,
  breakpoint: SxBreakpoint | null,
): Record<string, any> {
  const partial: Record<string, unknown> = {}
  for (const [property, value] of Object.entries(edits)) {
    if (!property) continue
    Object.assign(
      partial,
      canonicalCssPartial(property, value === '' ? undefined : value),
    )
  }
  return applyStylePartialToSx(sx, partial, breakpoint, null)
}

export interface CustomCssFormProps {
  node?: Aglyn.NodeSchema
  /** Active artboard breakpoint; builder/CSS edits scope to it (AGL-333). */
  breakpoint: SxBreakpoint | null
  /**
   * Which `styleOverrides` slice to edit on a component instance
   * (AGL-1332) — the Styles panel's current style target. Ignored for a
   * plain node; defaults to the component root.
   */
  overrideKey?: string
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
  const { node, breakpoint, overrideKey } = props
  // Same target the rest of the Styles panel writes (AGL-1306/1332): a
  // plain node's own sx, or the instance override slice the panel's style
  // target names — root, or one leaf inside the component.
  const target = useMemo(
    () => getNodeStyleTarget(node, overrideKey),
    [node, overrideKey],
  )
  const nodeSx = (target.sx ?? {}) as Record<string, any>
  const [mode, setMode] = useState<'builder' | 'css' | 'json'>('builder')
  const [cssDraft, setCssDraft] = useState('')
  const [jsonDraft, setJsonDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo<BuilderRow[]>(
    () => customCssDeclarations(nodeSx, breakpoint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(nodeSx), breakpoint],
  )
  const [draftRow, setDraftRow] = useState<BuilderRow>({ property: '', value: '' })

  useEffect(() => {
    setCssDraft(serializeCssDeclarations(nodeSx, breakpoint))
    setJsonDraft(JSON.stringify(nodeSx, null, 2))
    setError(null)
    // Re-seeded on the override target too (AGL-1332): switching from the
    // component root to a leaf must reload the drafts, or a stale CSS
    // buffer would be written back onto the newly picked target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, node?.$id, target.overrideKey])

  // Passive off-site url() hint (AGL-1737) — the "warn" half of AGL-1725's
  // warn-and-disclose, for the panel with no per-field description to carry
  // it. Names the hosts a url() in the CURRENT value would make every
  // visitor's browser contact: the live draft in the CSS and JSON modes
  // (ahead of Apply, so the author reads it while typing), the committed sx
  // in the builder (whose rows write live). A caption and nothing more — it
  // never blocks a value, and it deliberately does not touch how or when
  // this form commits (an attribute panel edit commits on blur, and that
  // behavior is load-bearing).
  const thirdPartyHosts = useMemo<string[]>(() => {
    if (mode === 'css') return Aglyn.collectThirdPartyAuthorCssUrlHosts(cssDraft)
    if (mode === 'json') {
      try {
        return Aglyn.collectThirdPartyAuthorSxUrlHosts(
          JSON.parse(jsonDraft || '{}'),
        )
      } catch {
        // Mid-edit JSON — scan the raw text so the hint tracks typing.
        return Aglyn.collectThirdPartyAuthorCssUrlHosts(jsonDraft)
      }
    }
    return Aglyn.collectThirdPartyAuthorSxUrlHosts(nodeSx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cssDraft, jsonDraft, JSON.stringify(nodeSx)])

  const writeProperty = useCallback(
    (property: string, value: string | undefined) => {
      if (!node || !property) return
      // Coalesced per property (AGL-1204): the builder rows write on every
      // keystroke, so typing one value is one undo step, and editing a
      // different property starts another. The write goes through the style
      // target (AGL-1306), so this is undoable on an instance's override
      // layer exactly as on a plain node's own sx.
      Aglyn.canvas.transact(
        () => {
          target.setSx(
            applyCustomCssEdits(
              (target.sx ?? {}) as Record<string, any>,
              { [property]: value },
              breakpoint,
            ),
          )
        },
        ['sx', node.$id, breakpoint ?? 'base', property].join(':'),
      )
    },
    [node, target, breakpoint],
  )

  const applyCss = useCallback(() => {
    if (!node) return
    const parsed = parseCssDeclarations(cssDraft)
    // Uncoalesced: pressing Apply is one deliberate commit, however many
    // declarations it carries (AGL-1204).
    Aglyn.canvas.transact(() => {
      // One edit map, applied once: declarations no longer in the draft
      // clear, the rest write. Both halves resolve their spelling through
      // `applyCustomCssEdits`, so a row the author deleted takes the alias
      // that was painting it with it, and a declaration they typed under
      // MUI's spelling lands where every other control can read it.
      const edits: Record<string, string | undefined> = {}
      for (const row of rows) {
        if (!(row.property in parsed)) edits[row.property] = undefined
      }
      Object.assign(edits, parsed)
      target.setSx(
        applyCustomCssEdits(
          (target.sx ?? {}) as Record<string, any>,
          edits,
          breakpoint,
        ),
      )
    })
    setError(null)
  }, [node, target, cssDraft, rows, breakpoint])

  const applyJson = useCallback(() => {
    if (!node) return
    try {
      const parsed = JSON.parse(jsonDraft || '{}')
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('The sx value must be a JSON object')
      }
      // Replacing sx wholesale is the single most destructive edit this panel
      // offers, so it is the one that most needs to be undoable (AGL-1204).
      Aglyn.canvas.transact(() => {
        target.setSx(parsed)
      })
      setError(null)
    } catch (parseError: any) {
      setError(parseError?.message ?? 'Invalid JSON')
    }
  }, [node, target, jsonDraft])

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

      {thirdPartyHosts.length ? (
        // Same voice as the Custom HTML `css` description (AGL-1737), with
        // the host named back so the consequence is attached to the value
        // the author typed rather than left as general prose.
        <Typography variant="caption" color="text.secondary">
          {'A url() here points off your site — every visitor’s browser ' +
            `will contact ${thirdPartyHosts.join(', ')}, disclosing their ` +
            'IP address and which page they are on. Insecure http:// URLs ' +
            'are not loaded.'}
        </Typography>
      ) : null}
    </Stack>
  )
})
CustomCssForm.displayName = 'CustomCssForm'

export default CustomCssForm
