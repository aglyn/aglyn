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
import {
  canvas,
  isPlacedFormNode,
  listInstanceStyleTargets,
  placementDefinitionFor,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
  STYLE_OVERRIDES_ROOT_KEY,
} from '@aglyn/aglyn'
import { mdiRestore } from '@aglyn/shared-data-mdi'
import {
  FormRenderer,
  type FormRendererProps,
  type FormTemplateRenderProps,
  FormSpy,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Box,
  Chip,
  Grid,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { toJS } from 'mobx'
import {
  Fragment,
  type KeyboardEvent,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ComponentPromotionContext } from '../contexts/component-promotion-context'
import { useDebouncedCommit } from '../hooks/use-debounced-commit'
import { besignerDocsUrl } from '../utils/docs-help'
import {
  countAttrChanges,
  getNodeAttrTarget,
  listInstanceAttrFields,
} from '../utils/attr-target'
import {
  type PartNode,
  type PlacementCopy,
  placementCopy,
} from '../utils/placement-override-copy'
import {
  getPlacementPartPick,
  resolvePickedPart,
} from '../utils/placement-part-pick'
import { PlacementPartsHeader } from './placement-parts-header.component'

/**
 * Schedules a commit when the form's values change and it is dirty — the same
 * shape as the Attributes form's `AutoSaveOnChange`, and for the same reason:
 * MUI Select renders through a Portal, so its change never reaches the
 * `<form>` as a DOM event.
 *
 * The first render is skipped. Seeding the form is not an edit, and
 * committing on mount would write an override slice for every instance whose
 * panel was merely OPENED.
 */
const AttrOverrideAutoSave = memo(function AttrOverrideAutoSave({
  values,
  pristine,
  valid,
  onSchedule,
}: {
  values: unknown
  pristine: boolean
  valid: boolean
  onSchedule: () => void
}) {
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (!pristine && valid) onSchedule()
  }, [values]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
})

/** What each field row needs to say it was changed here, and undo it. */
interface ChangedFieldsProps {
  /** Names of the fields this page changes, on the picked part. */
  changed: ReadonlySet<string>
  /** Resets one field to the definition's value. */
  onReset: (name: string) => void
  copy: PlacementCopy
}

/**
 * One field's "Changed here" badge and its ↺ reset, drawn on the row under
 * the field (AGL-3288) — the per-field replacement for a row of chips that
 * named each change by its stored key.
 */
function ChangedFieldRow({
  label,
  name,
  onReset,
  copy,
}: {
  label: string
  name: string
  onReset: (name: string) => void
  copy: PlacementCopy
}) {
  const resetLabel = copy.resetField(label)
  return (
    <Grid size={12} sx={{ mt: -1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Chip
          size="small"
          color="secondary"
          variant="outlined"
          label={copy.changedBadge}
          sx={{ height: 20, fontSize: '0.7rem' }}
        />
        <Tooltip title={resetLabel}>
          <IconButton
            size="small"
            aria-label={resetLabel}
            onClick={() => onReset(name)}
          >
            <MdiIcon path={mdiRestore.path} fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Grid>
  )
}

/**
 * The per-page form's shell (AGL-1899).
 *
 * Autosaving on a debounce, exactly like the Attributes form's own template
 * (AGL-567) — a change here is an attribute edit and should not need a second
 * kind of Save button — but with NO submit button of its own: this form is
 * nested inside the Attributes panel, and a second `type="submit"` control
 * beside "Save Element" is two buttons that look like they do the same thing
 * and do not.
 *
 * `onBlur` flushes, so switching selection or clicking away cannot strand an
 * edit inside the debounce window. Return in a text box also flushes, and is
 * stopped here: the section renders inside the Attributes panel's own
 * `<form>` (AGL-3288), where the browser would otherwise treat it as a submit
 * of THAT form.
 *
 * `formFields` arrive one per schema field, in schema order, so each changed
 * field's badge row is drawn directly under it.
 */
const InstanceAttrFormTemplate = ({
  formFields,
  schema,
  changed,
  onReset,
  copy,
}: FormTemplateRenderProps & ChangedFieldsProps) => {
  const { handleSubmit } = useFormApi()
  const { schedule, flush } = useDebouncedCommit(handleSubmit)
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const target = event.target as HTMLElement
      if (event.key === 'Enter' && target.tagName === 'INPUT') {
        event.preventDefault()
        flush()
      }
    },
    [flush],
  )
  const fields = (schema?.fields ?? []) as Array<{
    name?: string
    label?: string
  }>
  const rendered = (formFields ?? []) as unknown as JSX.Node[]
  return (
    <Box onBlur={flush} onKeyDown={handleKeyDown}>
      {schema?.title}
      <Grid spacing={2} container>
        {rendered.map((field, index) => {
          const name = fields[index]?.name
          return (
            <Fragment key={name ?? index}>
              {field}
              {name && changed.has(name) ? (
                <ChangedFieldRow
                  name={name}
                  label={fields[index]?.label || name}
                  onReset={onReset}
                  copy={copy}
                />
              ) : null}
            </Fragment>
          )
        })}
      </Grid>
      <FormSpy subscription={{ values: true, pristine: true, valid: true }}>
        {({ values, pristine, valid }) => (
          <AttrOverrideAutoSave
            values={values}
            pristine={pristine}
            valid={valid}
            onSchedule={schedule}
          />
        )}
      </FormSpy>
    </Box>
  )
}

export interface InstanceAttrOverridesProps {
  /** The selected node, as the panel holds it. */
  node?: Aglyn.NodeSchema<any>
  /**
   * Passed in rather than imported, so this file does not import the
   * Attributes form that renders it (a cycle) — and so a caller can narrow
   * the editors on offer without this component knowing about any of them.
   */
  componentMapper: FormRendererProps['componentMapper']
}

/**
 * Per-instance ATTRIBUTE overrides for a reusable-component instance
 * (AGL-1899) — the attribute-side twin of the Styles panel's override
 * section (AGL-1332).
 *
 * An instance renders the component's CURRENT nodes; this section layers one
 * placement's own prop values over one node inside it, so a single page's CTA
 * can be `outlined` while every other placement stays `contained` — without
 * the component declaring a prop for it, without detaching, and without
 * pinning the instance to a component version. The graft merges the slice per
 * named prop, so a prop the component ADDS later still reaches this instance
 * with the component's new default.
 *
 * Content is deliberately not editable here: a component's text rides its
 * declared `{{prop.*}}` props and the canvas's double-click editor (AGL-1304),
 * and `children`/`html` are refused by the writer so this panel never becomes
 * a second control writing the same rendered string.
 */
export const InstanceAttrOverrides = observer(function InstanceAttrOverrides({
  node: selectedNode,
  componentMapper,
}: InstanceAttrOverridesProps) {
  // The node as the CANVAS currently holds it (AGL-2486 / `f68aadabe`).
  //
  // Undo, a co-edit apply and a draft restore all REPLACE the node map with
  // fresh instances. A panel holding the node OBJECT would go on writing to a
  // detached copy — the write lands on an orphan, nothing throws, and the
  // header still says UP TO DATE. Resolving by `$id` at the point of use is
  // the only form that cannot strand itself, and reading it inside an
  // `observer` is also what re-renders this section after an undo.
  const node = (selectedNode?.$id
    ? (canvas.getNode(selectedNode.$id) ?? selectedNode)
    : selectedNode) as Aglyn.NodeSchema<any> | undefined

  // A placed form is the same kind of placement (AGL-3285): its published
  // design is the tree, and a page may set a label or placeholder on its copy
  // — never anything that changes what the form submits.
  const { definitions, formDesigns } = useContext(ComponentPromotionContext)
  const definition = useMemo(
    () => placementDefinitionFor(node, { definitions, formDesigns }),
    [node, definitions, formDesigns],
  )
  const isPlacedForm = isPlacedFormNode(node)
  const placedFormResolves = isPlacedForm && Boolean(definition)
  const kind = isPlacedForm ? 'form' : 'component'
  const copy = placementCopy(kind)

  // The SAME target list the Styles panel offers, from the same walker, so
  // the two panels name the same parts of a component in the same order and
  // an override written by one is addressed identically by the other.
  const targets = useMemo(
    () => listInstanceStyleTargets(definition),
    [definition],
  )

  // Which part is being edited, held per selection rather than in an
  // effect: switching nodes must land on the whole placement, and deriving
  // it from the current `node.$id` cannot render one frame aimed at the
  // PREVIOUS instance's leaf. A click on the canvas newer than the menu's
  // last choice moves it (AGL-3288) — see `placement-part-pick.ts`.
  const canvasPick = getPlacementPartPick()
  const [picked, setPicked] = useState<{
    nodeId?: string
    key: string
    seq: number
  }>({ key: STYLE_OVERRIDES_ROOT_KEY, seq: 0 })
  const pickedKey = resolvePickedPart(node?.$id, picked, canvasPick)
  // A leaf the component no longer has falls back to the root rather than
  // aiming the panel at a slice nothing renders. An unloaded definition
  // offers nothing yet, so it is not evidence the key is stale.
  const overrideKey =
    !targets.length || targets.some((entry) => entry.key === pickedKey)
      ? pickedKey
      : STYLE_OVERRIDES_ROOT_KEY

  const target = useMemo(
    () => getNodeAttrTarget(node, overrideKey, { placedFormResolves }),
    [node, overrideKey, placedFormResolves],
  )

  const pickedTarget = targets.find((entry) => entry.key === overrideKey)
  const definitionNodes = definition?.nodes as
    | Record<string, PartNode>
    | undefined
  const defNode = pickedTarget
    ? (definitionNodes as Record<string, any> | undefined)?.[
        pickedTarget.componentInternalId
      ]
    : undefined
  const attrFields = useMemo(
    () => listInstanceAttrFields(defNode, node),
    [defNode, node],
  )

  // Read during render (observer): tracks the live slice, so the badges
  // update as edits land and as they are reset.
  const changedFields = new Set(Object.keys(target.attrs ?? {}))
  const changedKeys = new Set(
    Object.keys((node?.attrOverrides as Record<string, any> | undefined) ?? {}),
  )
  const changeCount = countAttrChanges(node)
  const propValues = (node?.props as Record<string, any> | undefined)?.[
    REUSABLE_INSTANCE_PROP_VALUES_KEY
  ] as Record<string, unknown> | undefined

  const canvasSeq = canvasPick.seq
  const handleTargetChange = useCallback(
    (key: string) => {
      setPicked({ nodeId: node?.$id, key, seq: canvasSeq })
    },
    [node?.$id, canvasSeq],
  )

  const handleSave = useCallback(
    (values: Record<string, unknown>) => {
      // One undoable step. `setAttrs` drops every non-override value by key,
      // so a form that hands back a field per declared attribute — most of
      // them empty — stores only what this instance actually chose.
      canvas.transact(() => target.setAttrs(values))
    },
    [target],
  )

  // Bumped by every reset so the form re-seeds from the slice as it now is:
  // the form owns its typed values, and one still holding a reset value
  // would write it straight back on the next edit.
  const [resetCount, setResetCount] = useState(0)

  const handleReset = useCallback(
    (prop: string) => {
      // Undoable and uncoalesced: a reset DISCARDS a change, which is the
      // one edit here that most needs a way back.
      canvas.transact(() => target.clearAttr(prop))
      setResetCount((count) => count + 1)
    },
    [target],
  )

  const handleResetAll = useCallback(() => {
    // One transaction for every part, so one undo brings them all back.
    canvas.transact(() => target.clearAll())
    setResetCount((count) => count + 1)
  }, [target])

  // Re-seeds the form when the selection, the part or a reset changes. NOT
  // keyed on the slice's contents: the form owns the typed value while the
  // author is in it, and re-seeding on every commit would fight the field for
  // the cursor — the shape behind an update loop, not merely a nuisance.
  const seedKey = `${node?.$id ?? ''}:${overrideKey}:${resetCount}`
  const initialValues = useMemo(
    () => (toJS(target.attrs) ?? {}) as Record<string, unknown>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seedKey],
  )

  if (!target.isInstanceOverride || !targets.length) return null

  return (
    <Box sx={{ mt: 2, mb: 1 }}>
      <PlacementPartsHeader
        kind={kind}
        parts={targets}
        definitionNodes={definitionNodes}
        propValues={propValues}
        value={overrideKey}
        onChange={handleTargetChange}
        changedKeys={changedKeys}
        helperText={
          target.isLeafOverride ? copy.onePartHelper : copy.wholePartHelper
        }
        changeCount={changeCount}
        onResetAll={handleResetAll}
        helpExcerpt={copy.helpExcerpt}
        helpHref={besignerDocsUrl(
          'reusableComponents',
          '#override-an-attribute-on-one-instance',
        )}
      />
      {attrFields.length ? (
        <FormRenderer
          key={seedKey}
          componentMapper={componentMapper}
          onSubmit={handleSave}
          initialValues={initialValues}
          schema={{ fields: attrFields.map((entry) => entry.field) }}
        >
          {(templateProps: FormTemplateRenderProps) => (
            <InstanceAttrFormTemplate
              {...templateProps}
              changed={changedFields}
              onReset={handleReset}
              copy={copy}
            />
          )}
        </FormRenderer>
      ) : (
        // Said out loud rather than rendering an empty box: a component made
        // of layout elements genuinely has nothing to change here, and an
        // author should not be left wondering whether the panel failed.
        <Typography variant="caption" color="text.secondary">
          {copy.nothingToChange}
        </Typography>
      )}
    </Box>
  )
})

export default InstanceAttrOverrides
