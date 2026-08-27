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
import { FIELD_MUTED_STYLES, FieldMuteButton } from '@aglyn/shared-ui-jsx-forms'
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
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import { buildStyleMute, toggleMutedStyle } from '../utils/muted-styles'
import type { SxBreakpoint } from '../utils/responsive-sx'
import { readSxValue } from '../utils/responsive-sx'
import { applyStylePartialToSx } from '../utils/style-field-groups'
import { getNodeStyleTarget } from '../utils/style-target'

/**
 * Curated, grouped suggestions for the builder's property picker
 * (freeSolo, so any CSS/sx property still works).
 */
const CSS_PROPERTY_SUGGESTIONS: Array<{ group: string; name: string }> = [
  ...[
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'overflow',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'zIndex',
  ].map((name) => ({ group: 'Layout', name })),
  ...['margin', 'padding', 'gap', 'rowGap', 'columnGap'].map((name) => ({
    group: 'Spacing',
    name,
  })),
  ...[
    'fontSize',
    'fontWeight',
    'fontFamily',
    'lineHeight',
    'letterSpacing',
    'textTransform',
    'textDecoration',
    'whiteSpace',
  ].map((name) => ({ group: 'Typography', name })),
  ...[
    'color',
    'backgroundColor',
    'background',
    'backgroundImage',
    'backgroundSize',
    'backgroundPosition',
    'opacity',
  ].map((name) => ({ group: 'Background & color', name })),
  ...[
    'border',
    'borderRadius',
    'borderColor',
    'borderWidth',
    'borderStyle',
    'outline',
  ].map((name) => ({ group: 'Border', name })),
  ...[
    'boxShadow',
    'transform',
    'transition',
    'filter',
    'cursor',
    'objectFit',
    'aspectRatio',
  ].map((name) => ({ group: 'Effects', name })),
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

/**
 * Un-applied CSS / JSS text, held ACROSS an unmount of this form (AGL-2486).
 *
 * The JSS tab is the one control in the Styles panel whose work lives only
 * in React state until Apply — and this form is mounted under
 * `withLastSelectedNode`, which renders "Select an element" the instant the
 * canvas selection empties. Anything that clears the selection therefore
 * UNMOUNTS the editor, and a `useState('')` buffer takes the author's
 * half-typed sx document with it. Measured on a live besigner: a selection
 * held with no keyboard or pointer input at all lost the editor 46s in, so
 * this is not something the author can avoid by typing carefully — it is
 * why the wipe reads as random, and why it gets blamed on whichever key was
 * pressed last.
 *
 * Keyed by node AND style target, so a component instance's root and its
 * leaves each keep their own pending text, and re-selecting the element
 * hands the author back exactly what they had typed. An entry lives only
 * while the text DIFFERS from the stored document: applying it, or typing
 * it back to what sx already says, drops the entry, so this never resurrects
 * a draft the author has already resolved.
 *
 * Deliberately not persisted beyond the page: it is un-applied text, not a
 * document, and the crash-recovery draft store is the thing that owns
 * surviving a reload.
 */
const pendingDrafts = new Map<string, string>()

const draftKey = (
  nodeId: string,
  overrideKey: string,
  mode: 'css' | 'json',
): string => [nodeId, overrideKey, mode].join('\x00')

/** Drops every pending draft — test seam, and a hard reset for the canvas. */
export function resetPendingCustomCssDrafts(): void {
  pendingDrafts.clear()
}

/**
 * Why a JSS buffer cannot be applied, or `null` when it is ready
 * (AGL-2486). Rendered live as the author types, so "nothing happened when
 * I pressed Apply" is never the first sign that the text does not parse.
 *
 * Mid-edit JSON is TRANSIENTLY invalid by nature — `{"a": 1,` is what every
 * new property looks like a keystroke before it is finished — so this is a
 * hint, never a block on typing and never a reason to touch the document.
 *
 * An empty buffer is called out rather than treated as `{}`: `JSON.parse`
 * would need a fallback to accept it at all, and silently reading "" as
 * "delete every style on this element" is the most destructive thing this
 * panel could do with an accidental Select-All. Clearing all styles stays
 * available, spelled `{}`, which nobody types by accident.
 */
export function jsonDraftProblem(text: string): string | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed) {
    return 'Empty — type {} to clear every style on this element.'
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return 'Not valid JSON yet — Apply will not change anything until it parses.'
  }
  // Explicit `=== null` and an array check: `strictNullChecks` is off
  // repo-wide, so `!parsed` would fold `null`, `0` and `""` together, and
  // `typeof null` is `'object'`.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'The sx value must be a JSON object.'
  }
  return null
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
  const [draftRow, setDraftRow] = useState<BuilderRow>({
    property: '',
    value: '',
  })

  // Declarations switched off for comparison (AGL-2486). Canvas only, and
  // the same flag every other row in the panel writes, so a property muted
  // here and the same property muted from its typed field are one state.
  // The builder lists BASE scalar declarations only — a state slice is a
  // nested object it skips — so these mutes carry no state scope.
  const [mutedStyles, setMutedStyles] = useAglynBesignerFlag('mutedStyles')
  const rowMute = useCallback(
    (property: string) =>
      buildStyleMute(property, property, {
        nodeId: node?.$id,
        state: null,
        breakpoint,
        // Every row the builder lists is, by construction, declared.
        scopeValues: { [property]: true },
        mutedStyles,
        onToggle: (target) =>
          setMutedStyles((current) => toggleMutedStyle(current, target)),
      }),
    [node, breakpoint, mutedStyles, setMutedStyles],
  )

  const nodeId = node?.$id ?? ''
  /** What the STORED document says, in each tab's spelling. */
  const storedCss = useMemo(
    () => serializeCssDeclarations(nodeSx, breakpoint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(nodeSx), breakpoint],
  )
  const storedJson = useMemo(
    () => JSON.stringify(nodeSx, null, 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(nodeSx)],
  )

  /**
   * Records (or drops) the author's un-applied text for one tab, so an
   * unmount cannot take it (AGL-2486). Text equal to the stored document is
   * not a draft at all, so it clears the entry rather than pinning a value
   * that would then shadow a later change from elsewhere in the panel.
   */
  const rememberDraft = useCallback(
    (draftMode: 'css' | 'json', value: string, stored: string) => {
      const key = draftKey(nodeId, target.overrideKey, draftMode)
      if (value === stored) pendingDrafts.delete(key)
      else pendingDrafts.set(key, value)
    },
    [nodeId, target.overrideKey],
  )

  useEffect(() => {
    // A pending draft wins over the stored document — that is the whole
    // point of keeping it. `!== undefined` rather than a truthiness test:
    // `''` is a legitimate buffer the author emptied on purpose, and with
    // `strictNullChecks` off `if (!pending)` would silently discard it.
    const pendingCss = pendingDrafts.get(
      draftKey(nodeId, target.overrideKey, 'css'),
    )
    const pendingJson = pendingDrafts.get(
      draftKey(nodeId, target.overrideKey, 'json'),
    )
    setCssDraft(pendingCss !== undefined ? pendingCss : storedCss)
    setJsonDraft(pendingJson !== undefined ? pendingJson : storedJson)
    setError(null)
    // Re-seeded on the override target too (AGL-1332): switching from the
    // component root to a leaf must reload the drafts, or a stale CSS
    // buffer would be written back onto the newly picked target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nodeId, target.overrideKey])

  /**
   * Live "is this appliable yet" verdict for the JSS tab (AGL-2486) — a
   * caption only. Nothing here writes, so a buffer that stops parsing
   * mid-property changes the hint and leaves the document alone.
   */
  const jsonProblem = useMemo(
    () => (mode === 'json' ? jsonDraftProblem(jsonDraft) : null),
    [mode, jsonDraft],
  )

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
    if (mode === 'css')
      return Aglyn.collectThirdPartyAuthorCssUrlHosts(cssDraft)
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
    // Applied text is no longer un-applied.
    pendingDrafts.delete(draftKey(nodeId, target.overrideKey, 'css'))
  }, [node, target, cssDraft, rows, breakpoint, nodeId])

  /**
   * Commits the JSS buffer — the ONLY path from this tab to the document
   * (AGL-2486).
   *
   * A buffer that does not parse to a JSON object is a NON-COMMIT: it sets
   * the inline error and returns, leaving both the document and the text
   * exactly as they are, so the author can keep editing from where they
   * were. There is no blur, change or unmount handler anywhere in this form
   * that reaches the document — Apply is the whole seam, which is what
   * makes a transiently invalid buffer harmless.
   */
  const applyJson = useCallback(() => {
    if (!node) return
    const problem = jsonDraftProblem(jsonDraft)
    if (problem !== null) {
      setError(problem)
      return
    }
    // Re-parsed rather than carried out of the guard: `jsonDraftProblem`
    // owns the verdict, and one function deciding while another commits is
    // how "valid enough to pass, wrong shape to store" gets in.
    const parsed = JSON.parse(jsonDraft.trim())
    // Replacing sx wholesale is the single most destructive edit this panel
    // offers, so it is the one that most needs to be undoable (AGL-1204).
    Aglyn.canvas.transact(() => {
      target.setSx(parsed)
    })
    setError(null)
    pendingDrafts.delete(draftKey(nodeId, target.overrideKey, 'json'))
  }, [node, target, jsonDraft, nodeId])

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
          {rows.map((row) => {
            const mute = rowMute(row.property)
            return (
              <Stack
                key={row.property}
                direction="row"
                spacing={1}
                sx={[
                  { alignItems: 'center' },
                  mute?.muted ? FIELD_MUTED_STYLES : null,
                ]}
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
                {/* The eye stops the declaration applying and keeps its
                    value; the ✕ beside it is still the only thing that
                    takes the declaration off the element. */}
                <FieldMuteButton mute={mute} />
                <IconButton
                  size="small"
                  aria-label={`Remove ${row.property}`}
                  onClick={() => writeProperty(row.property, undefined)}
                >
                  <MdiIcon path={mdiClose.path} size={0.7} />
                </IconButton>
              </Stack>
            )
          })}
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
            onChange={(event) => {
              setCssDraft(event.target.value)
              rememberDraft('css', event.target.value, storedCss)
            }}
            placeholder={
              'border-radius: 8px;\nbox-shadow: 0 2px 8px rgba(0,0,0,0.2);'
            }
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
            onChange={(event) => {
              setJsonDraft(event.target.value)
              rememberDraft('json', event.target.value, storedJson)
              // A keystroke that fixes the JSON clears a stale Apply error;
              // it never raises one, so typing is not nagged mid-property.
              if (error && jsonDraftProblem(event.target.value) === null) {
                setError(null)
              }
            }}
            error={Boolean(error)}
            helperText={error ?? jsonProblem ?? undefined}
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
