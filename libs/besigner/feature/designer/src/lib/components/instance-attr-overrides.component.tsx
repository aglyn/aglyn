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
import {
  FormRenderer,
  type FormRendererProps,
  type FormTemplateRenderProps,
  FormSpy,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import { HelpTip } from '@aglyn/shared-ui-jsx'
import {
  Box,
  Chip,
  Grid,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { toJS } from 'mobx'
import {
  type ChangeEvent,
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
  getNodeAttrTarget,
  listInstanceAttrFields,
} from '../utils/attr-target'

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

/**
 * The override form's shell (AGL-1899).
 *
 * Autosaving on a debounce, exactly like the Attributes form's own template
 * (AGL-567) — an override is an attribute edit and should not need a second
 * kind of Save button — but with NO submit button of its own: this form is
 * nested inside the Attributes panel, and a second `type="submit"` control
 * beside "Save Element" is two buttons that look like they do the same thing
 * and do not.
 *
 * `onBlur` flushes, so switching selection or clicking away cannot strand an
 * edit inside the debounce window.
 */
const InstanceAttrFormTemplate = ({
  formFields,
  schema,
}: FormTemplateRenderProps) => {
  const { handleSubmit } = useFormApi()
  const { schedule, flush } = useDebouncedCommit(handleSubmit)
  return (
    <Box onBlur={flush}>
      {schema?.title}
      <Grid spacing={2} container>
        {formFields as unknown as JSX.Node}
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
    ? (Aglyn.canvas.getNode(selectedNode.$id) ?? selectedNode)
    : selectedNode) as Aglyn.NodeSchema<any> | undefined

  const { definitions } = useContext(ComponentPromotionContext)
  const isInstance = node?.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID
  const definition = useMemo(() => {
    if (!isInstance) return undefined
    const refId = (node?.props as { refId?: string } | undefined)?.refId
    return refId ? definitions?.[refId] : undefined
  }, [isInstance, node, definitions])

  // The SAME target list the Styles panel offers, from the same walker, so
  // the two panels name the same parts of a component in the same order and
  // an override written by one is addressed identically by the other.
  const targets = useMemo(
    () => Aglyn.listInstanceStyleTargets(definition),
    [definition],
  )

  // Which target is being edited, held per selection rather than in an
  // effect: switching nodes must land on the component root, and deriving it
  // from the current `node.$id` cannot render one frame aimed at the
  // PREVIOUS instance's leaf.
  const [picked, setPicked] = useState<{ nodeId?: string; key: string }>({
    key: Aglyn.STYLE_OVERRIDES_ROOT_KEY,
  })
  const pickedKey =
    picked.nodeId && picked.nodeId === node?.$id
      ? picked.key
      : Aglyn.STYLE_OVERRIDES_ROOT_KEY
  // A leaf the component no longer has falls back to the root rather than
  // aiming the panel at a slice nothing renders. An unloaded definition
  // offers nothing yet, so it is not evidence the key is stale.
  const overrideKey =
    !targets.length || targets.some((entry) => entry.key === pickedKey)
      ? pickedKey
      : Aglyn.STYLE_OVERRIDES_ROOT_KEY

  const target = useMemo(
    () => getNodeAttrTarget(node, overrideKey),
    [node, overrideKey],
  )

  const pickedTarget = targets.find((entry) => entry.key === overrideKey)
  const defNode = pickedTarget
    ? (definition?.nodes as Record<string, any> | undefined)?.[
        pickedTarget.componentInternalId
      ]
    : undefined
  const attrFields = useMemo(() => listInstanceAttrFields(defNode), [defNode])

  // Read during render (observer): tracks the live slice, so the chips update
  // as edits land and as they are cleared.
  const overriddenProps = Object.keys(target.attrs ?? {})
  const overriddenKeys = new Set(
    Object.keys((node?.attrOverrides as Record<string, any> | undefined) ?? {}),
  )

  const targetLabel = useCallback(
    (entry: Aglyn.InstanceStyleTarget) =>
      entry.isRoot
        ? 'Component root'
        : entry.name ||
          (entry.componentId && Aglyn.components.getLabel(entry.componentId)) ||
          entry.componentInternalId,
    [],
  )

  const handleTargetChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPicked({ nodeId: node?.$id, key: event.target.value })
    },
    [node?.$id],
  )

  const handleSave = useCallback(
    (values: Record<string, unknown>) => {
      // One undoable step. `setAttrs` drops every non-override value by key,
      // so a form that hands back a field per declared attribute — most of
      // them empty — stores only what this instance actually chose.
      Aglyn.canvas.transact(() => target.setAttrs(values))
    },
    [target],
  )

  const handleClear = useCallback(
    (prop: string) => () => {
      // Undoable and uncoalesced: clearing a chip DISCARDS an override, which
      // is the one edit here that most needs a way back.
      Aglyn.canvas.transact(() => target.clearAttr(prop))
    },
    [target],
  )

  // Re-seeds the form when the selection or the target changes. NOT keyed on
  // the slice's contents: the form owns the typed value while the author is
  // in it, and re-seeding on every commit would fight the field for the
  // cursor — the shape behind an update loop, not merely a nuisance.
  const seedKey = `${node?.$id ?? ''}:${overrideKey}`
  const initialValues = useMemo(
    () => (toJS(target.attrs) ?? {}) as Record<string, unknown>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seedKey],
  )

  if (!isInstance || !targets.length) return null

  return (
    <Box sx={{ mt: 2 }}>
      <Typography
        variant="overline"
        color="text.secondary"
        component="div"
        sx={{ display: 'flex', alignItems: 'center' }}
      >
        {'Attribute overrides'}
        <HelpTip
          title="Attribute overrides"
          excerpt="Give one placement of a component its own attribute values — a different button variant, size or link — without changing the component or detaching. Empty means the component's own value."
          href={besignerDocsUrl(
            'reusableComponents',
            '#override-an-attribute-on-one-instance',
          )}
          sx={{ ml: 0.25, fontSize: '0.9em' }}
        />
      </Typography>
      {targets.length > 1 ? (
        <TextField
          select
          fullWidth
          size="small"
          margin="dense"
          label="Override target"
          value={overrideKey}
          onChange={handleTargetChange}
          helperText={
            target.isLeafOverride
              ? 'Setting attributes on one element inside the component, on ' +
                'this instance only.'
              : "Setting attributes on the component's outer element, on " +
                'this instance only. Pick an element inside it to override ' +
                'that part.'
          }
        >
          {targets.map((entry) => (
            <MenuItem
              key={entry.key}
              value={entry.key}
              // Nesting reads as nesting: the definition's tree is the only
              // map an author has of what is inside a component.
              sx={{ pl: 2 + entry.depth * 1.5 }}
            >
              {targetLabel(entry)}
              {overriddenKeys.has(entry.key) ? ' •' : ''}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <Box sx={{ mt: 0.5, mb: 1 }}>
        <Tooltip
          title={
            'Attributes set here apply to this instance only, layered over ' +
            "the component's own values. Other placements keep the " +
            'component, and component updates still flow through. Leave a ' +
            "field empty to use the component's value."
          }
        >
          <Chip
            size="small"
            color={overriddenProps.length ? 'secondary' : 'default'}
            label={
              overriddenProps.length
                ? `Overridden here: ${overriddenProps.length}`
                : "Using the component's attributes"
            }
          />
        </Tooltip>
        {overriddenProps.map((prop) => (
          <Tooltip
            key={prop}
            title={
              "Clear this override — the instance returns to the component's " +
              'own value'
            }
          >
            <Chip
              size="small"
              variant="outlined"
              sx={{ ml: 1, mt: 0.5 }}
              label={prop}
              onDelete={handleClear(prop)}
            />
          </Tooltip>
        ))}
      </Box>
      {attrFields.length ? (
        <FormRenderer
          key={seedKey}
          componentMapper={componentMapper}
          onSubmit={handleSave}
          initialValues={initialValues}
          schema={{ fields: attrFields.map((entry) => entry.field) }}
        >
          {(templateProps: FormTemplateRenderProps) => (
            <InstanceAttrFormTemplate {...templateProps} />
          )}
        </FormRenderer>
      ) : (
        // Said out loud rather than rendering an empty box: a component made
        // of layout elements genuinely has nothing to override here, and an
        // author should not be left wondering whether the panel failed.
        <Typography variant="caption" color="text.secondary">
          {'This part of the component has no attributes that can be ' +
            'overridden per instance.'}
        </Typography>
      )}
    </Box>
  )
})

export default InstanceAttrOverrides
