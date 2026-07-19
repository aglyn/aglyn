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
  FormSpy,
  type FormTemplateRenderProps,
  FIELD_MAP_CHECKBOX,
  FIELD_MAP_ICON_PICKER,
  simpleComponentMapper,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import {
  mdiContentSave,
} from '@aglyn/shared-data-mdi'
import {
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import {
  Alert,
  IconButton,
  NoSsr,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import ListSubheader from '@mui/material/ListSubheader'
import MuiMenu from '@mui/material/Menu'
import MuiMenuItem from '@mui/material/MenuItem'
import { Grid } from '@mui/material'
import { observer } from 'mobx-react-lite'
import * as Besigner from '@aglyn/besigner'
import { forwardRef, memo, type SyntheticEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AiAssistContext } from '../contexts/ai-assist-context'
import { BindingPickerContext } from '../contexts/binding-picker-context'
import {
  InteractionsContext,
  nodeElementSelector,
  type InteractionTriggerEvent,
} from '../contexts/interactions-context'
import { MediaPickerContext } from '../contexts/media-picker-context'
import { ComponentPromotionContext } from '../contexts/component-promotion-context'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'

// Subscribes to form value changes via FormSpy and auto-submits when dirty.
// This is needed because MUI Select uses a Portal, so its onChange never
// bubbles through the <form> element as a DOM event.
const AutoSaveOnChange = memo(function AutoSaveOnChange({
  values,
  pristine,
  valid,
  onSubmit,
}: {
  values: unknown
  pristine: boolean
  valid: boolean
  onSubmit: () => void
}) {
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (!pristine && valid) {
      onSubmit()
    }
  }, [values]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
})

/**
 * @TODO ⚠️ remove and reimplement following PR merge
 *   https://github.com/data-driven-forms/react-forms/pull/1218
 */
export const ElementPropsFormTemplate = forwardRef<
  any,
  FormTemplateRenderProps
>((props, ref) => {
  const { formFields, schema, ...rest } = props
  const { handleSubmit } = useFormApi()
  return (
    <form
      ref={ref}
      onSubmit={handleSubmit}
      noValidate
      {...rest}
    >
      {schema.title}
      <Grid spacing={2} container>
        {formFields as unknown as JSX.Node}
      </Grid>
      <FormSpy subscription={{ values: true, pristine: true, valid: true }}>
        {({ values, pristine, valid }) => (
          <AutoSaveOnChange
            values={values}
            pristine={pristine}
            valid={valid}
            onSubmit={handleSubmit}
          />
        )}
      </FormSpy>
      <FormSpy>
        {({ submitting, pristine, valid }) => (
          <Box sx={{ mt: 2 }}>
            <FormControl margin="normal" fullWidth>
              <Button
                color="secondary"
                disabled={submitting || !valid || pristine}
                startIcon={<MdiIcon path={mdiContentSave.path} />}
                style={{ marginRight: 8 }}
                type="submit"
                variant="contained"
                fullWidth
              >
                Save Element
              </Button>
            </FormControl>
          </Box>
        )}
      </FormSpy>
    </form>
  );
})
ElementPropsFormTemplate.displayName = 'ElementPropsFormTemplate'
ElementPropsFormTemplate.aglyn = true

export interface ElementPropsFormProps extends FormRendererProps {
  node?: Aglyn.NodeSchema<any>
}

// Attribute editors available to canvas component schemas: the simple set
// plus pickers components actually declare (icon picker AGL-146, checkbox
// AGL-162).
const elementPropsComponentMapper = {
  ...simpleComponentMapper,
  [Aglyn.FieldComponentType.ICON_PICKER]: FIELD_MAP_ICON_PICKER,
  [Aglyn.FieldComponentType.CHECKBOX]: FIELD_MAP_CHECKBOX,
}

const ElementPropsFormRaw = forwardRef<any, ElementPropsFormProps>(
  (props, ref) => {
    const { node, ...rest } = props
    const schema = node?.componentSchema
    const nodeProps = node?.props
    const deleteElementCallback = useDeleteElementCallback()
    const rawAttributes = schema?.attributes
    // Screen-select fields can't carry static options (the host's screens
    // are only known at edit time), so resolve them here from the routing
    // map + labels the console provides via ScreenLinkContext. Entity
    // pickers (AGL-343/344) resolve the same way from EntityPickerContext.
    const { screens, labels } = useContext(Aglyn.ScreenLinkContext)
    const entityOptions = useContext(Aglyn.EntityPickerContext)
    // Canvas-node options for NODE_SELECT attributes (AGL-557): every
    // other element on the canvas, labeled by component name + a text
    // snippet, with a short id suffix to tell repeats apart. The edited
    // node itself is excluded (revealing yourself is never meaningful).
    const nodeOptions = useMemo(() => {
      const wantsNodes = (rawAttributes ?? []).some(
        (field) =>
          field.component === Aglyn.FieldComponentType.NODE_SELECT,
      )
      if (!wantsNodes) return []
      const canvasNodes = (Aglyn.canvas.toJSON().nodes ?? {}) as Record<
        string,
        any
      >
      return Object.entries(canvasNodes)
        .filter(([id]) => id && id !== node?.$id)
        .map(([id, candidate]) => {
          const displayName =
            Aglyn.components.getSchema(candidate?.componentId)
              ?.displayName ??
            candidate?.componentId ??
            'Element'
          const text =
            typeof candidate?.props?.children === 'string'
              ? candidate.props.children.trim().slice(0, 24)
              : ''
          return {
            value: id,
            label: `${displayName}${text ? ` "${text}"` : ''} · ${id.slice(
              0,
              6,
            )}`,
          }
        })
        .sort((a, b) => a.label.localeCompare(b.label))
    }, [rawAttributes, node?.$id])
    // Dataset-field selects (AGL-556) list the model fields of the nearest
    // ancestor's chosen dataset (e.g. the form field's parent form). The
    // ancestor persists the dataset id; legacy nodes carrying only a name
    // resolve it by matching the current display labels.
    const hasDatasetFieldSelect = (rawAttributes ?? []).some(
      (field) =>
        field.component === Aglyn.FieldComponentType.DATASET_FIELD_SELECT,
    )
    const ancestorDatasetId = useMemo(() => {
      if (!hasDatasetFieldSelect || !node?.$id) return undefined
      const nodes = Aglyn.canvas.toJSON().nodes as Record<string, any>
      let current = nodes[node.$id]
      for (let hops = 0; current && hops < 100; hops += 1) {
        const props = current.props ?? {}
        if (typeof props.datasetId === 'string' && props.datasetId) {
          return props.datasetId as string
        }
        if (typeof props.datasetName === 'string' && props.datasetName) {
          const byLabel = (entityOptions.datasets ?? []).find(
            (dataset) => dataset.label === props.datasetName,
          )
          if (byLabel) return byLabel.id
        }
        current = current.parentId ? nodes[current.parentId] : undefined
      }
      return undefined
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasDatasetFieldSelect, node, entityOptions.datasets])
    const attributes = useMemo(() => {
      const entityListFor = (component: Aglyn.FieldComponentType) => {
        switch (component) {
          case Aglyn.FieldComponentType.PRODUCT_SELECT:
            return entityOptions.products
          case Aglyn.FieldComponentType.COLLECTION_SELECT:
            return entityOptions.collections
          case Aglyn.FieldComponentType.CATEGORY_SELECT:
            return entityOptions.categories
          case Aglyn.FieldComponentType.DATASET_SELECT:
            return entityOptions.datasets
          default:
            return undefined
        }
      }
      return (rawAttributes ?? []).map((field) => {
        if (field.component === Aglyn.FieldComponentType.SCREEN_SELECT) {
          return {
            ...field,
            component: Aglyn.FieldComponentType.SELECT,
            options: [
              { value: '', label: 'None (use external URL)' },
              ...Object.entries(screens ?? {})
                .sort(([, a], [, b]) => a.localeCompare(b))
                .map(([screenId, path]) => ({
                  value: screenId,
                  label: `${labels?.[screenId] ?? screenId} (${
                    path === '/' ? '/' : `/${path}`
                  })`,
                })),
            ],
          }
        }
        if (field.component === Aglyn.FieldComponentType.NODE_SELECT) {
          // Canvas-element picker (AGL-557), resolved above.
          return {
            ...field,
            component: Aglyn.FieldComponentType.SELECT,
            options: [{ value: '', label: 'None' }, ...nodeOptions],
          }
        }
        if (
          field.component === Aglyn.FieldComponentType.DATASET_FIELD_SELECT
        ) {
          // Model order, never alphabetized — it mirrors the schema dialog.
          const modelFields = ancestorDatasetId
            ? entityOptions.datasetFields?.[ancestorDatasetId] ?? []
            : []
          return {
            ...field,
            component: Aglyn.FieldComponentType.SELECT,
            options: [
              {
                value: '',
                label: modelFields.length
                  ? 'None (match by field name)'
                  : 'No dataset selected on the form',
              },
              ...modelFields.map((modelField) => ({
                value: modelField.id,
                label: modelField.label,
              })),
            ],
          }
        }
        const entities = entityListFor(field.component as any)
        if (entities !== undefined) {
          return {
            ...field,
            component: Aglyn.FieldComponentType.SELECT,
            options: [
              { value: '', label: 'None' },
              ...[...entities]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((entity) => ({ value: entity.id, label: entity.label })),
            ],
          }
        }
        return field
      })
    }, [
      rawAttributes,
      screens,
      labels,
      entityOptions,
      nodeOptions,
      ancestorDatasetId,
    ])

    // Reusable-component flows (AGL-35): actions appear only when the host
    // app provides callbacks; locked nodes (layout chrome) never promote.
    const { onPromote, onDemote } = useContext(ComponentPromotionContext)
    const isInstance =
      node?.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID
    const unlocked = Besigner.dnd.canDragNode(node)

    // AI copy assist (AGL-89, widened by AGL-130): text-editable elements
    // and any element declaring text attributes, when the host app
    // provides the rewrite callback.
    const { onRewrite } = useContext(AiAssistContext)
    const textEditable =
      ((schema?.flags?.textEditable ?? Aglyn.FEATURE_FLAG.DISABLED) &
        Aglyn.FEATURE_FLAG.ENABLED) !==
      0
    const hasTextAttributes = (schema?.attributes ?? []).some(
      (field) =>
        field.component === Aglyn.FieldComponentType.TEXT_FIELD ||
        field.component === Aglyn.FieldComponentType.TEXTAREA,
    )

    // Insert binding (AGL-100): appends a {{token}} to the element text.
    // Options come from the host app (variables + functions); the commit
    // spreads current props — updateNodeProps REPLACES the props object.
    const {
      options: bindingOptions,
      variables: bindingVariables,
      functions: bindingFunctions,
    } = useContext(BindingPickerContext)
    const [bindingAnchor, setBindingAnchor] = useState<HTMLElement | null>(
      null,
    )
    // Friendly summary of bound string props (AGL-193): id tokens display
    // as current names; missing referents surface in warning color.
    const boundPropSummaries = useMemo(() => {
      const summaries: Array<{
        prop: string
        display: string
        missing: boolean
      }> = []
      for (const [key, value] of Object.entries(nodeProps ?? {})) {
        if (typeof value !== 'string' || !Aglyn.hasBindings(value)) continue
        const display = Aglyn.displayBindingTokens(
          value,
          (bindingVariables ?? {}) as any,
          (bindingFunctions ?? {}) as any,
        )
        summaries.push({
          prop: key,
          display,
          missing: display.includes(Aglyn.MISSING_BINDING_LABEL),
        })
      }
      return summaries
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(nodeProps ?? {}), bindingVariables, bindingFunctions])

    // Hosts can have hundreds of variables (AGL-186) — filter as you type.
    const [bindingSearch, setBindingSearch] = useState('')
    const visibleBindingOptions = useMemo(() => {
      const term = bindingSearch.trim().toLowerCase()
      if (!term) return bindingOptions ?? []
      return (bindingOptions ?? []).filter((option) =>
        option.label.toLowerCase().includes(term),
      )
    }, [bindingOptions, bindingSearch])
    const handleInsertBinding = useCallback(
      (token: string) => {
        setBindingAnchor(null)
        const current = (Aglyn.canvas.toJSON().nodes as Record<string, any>)[
          node?.$id
        ]
        const text =
          typeof current?.props?.children === 'string'
            ? (current.props.children as string)
            : ''
        Aglyn.canvas.updateNodeProps(node, {
          ...current?.props,
          children: text ? `${text} ${token}` : token,
        })
      },
      [node],
    )

    // Browse media (AGL-106): elements with a `src` attribute can pick an
    // asset from the host's media library; the commit spreads current props
    // (updateNodeProps REPLACES the props object).
    const { onPickMedia } = useContext(MediaPickerContext)
    // Interactions (AGL-258): element-scoped automations + section A/B.
    const interactions = useContext(InteractionsContext)
    const nodeSelector = node?.$id ? nodeElementSelector(node.$id) : ''
    const nodeAutomations = (interactions.automations ?? []).filter(
      (automation) => automation.selector === nodeSelector,
    )
    const nodeExperiment = (interactions.sectionExperiments ?? []).find(
      (experiment) => experiment.nodeId === node?.$id,
    )
    // Media-bearing attributes (AGL-341): every image/media URL field gets
    // a library browse button; the text field itself stays as the manual
    // URL escape hatch.
    const mediaAttributes = useMemo(
      () =>
        (rawAttributes ?? []).filter(
          (field: any) =>
            field?.component === Aglyn.FieldComponentType.TEXT_FIELD &&
            typeof field?.name === 'string' &&
            /^(src|poster)$|(image|logo|avatar|media|thumbnail|photo|background)(Url)?$/i.test(
              field.name,
            ),
        ),
      [rawAttributes],
    )
    const handleBrowseMedia = useCallback(
      (propName: string) => () => {
        onPickMedia?.((url) => {
          const current = (
            Aglyn.canvas.toJSON().nodes as Record<string, any>
          )[node?.$id]
          Aglyn.canvas.updateNodeProps(node, {
            ...current?.props,
            [propName]: url,
          })
        })
      },
      [onPickMedia, node],
    )

    const handleFormCancel = useCallback((e: SyntheticEvent, reason?: string) => {}, [])
    const handleElementSave = useCallback(
      (values: Record<string, unknown>) => {
        // Hand-typed {{name}} tokens normalize to their rename-safe
        // {{var:id}} form at save (AGL-186); unknown names pass through.
        const normalized: Record<string, unknown> = { ...values }
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === 'string' && Aglyn.hasBindings(value)) {
            normalized[key] = Aglyn.normalizeBindingTokens(
              value,
              (bindingVariables ?? {}) as any,
              (bindingFunctions ?? {}) as any,
            )
          }
        }
        Aglyn.canvas.updateNodeProps(node, normalized)
      },
      [node, bindingVariables, bindingFunctions],
    )

    return (
      <>
        <NoSsr>
          <FormRenderer
            componentMapper={elementPropsComponentMapper}
            onCancel={handleFormCancel}
            onSubmit={handleElementSave}
            initialValues={nodeProps}
            schema={{ fields: attributes }}
            {...rest}
          >
            {({ formFields, schema, ...rest }) => (
              <>
                <ElementPropsFormTemplate
                  formFields={formFields}
                  schema={schema}
                  {...rest}
                />

                {boundPropSummaries.length ? (
                  <Box sx={{ mt: 2 }}>
                    <Box
                      component="span"
                      sx={{
                        fontSize: 12,
                        color: 'text.secondary',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {'Bindings on this element'}
                    </Box>
                    {boundPropSummaries.map((summary) => (
                      <Box
                        key={summary.prop}
                        sx={{
                          display: 'flex',
                          gap: 1,
                          fontSize: 13,
                          mt: 0.5,
                          color: summary.missing
                            ? 'warning.main'
                            : 'text.primary',
                        }}
                      >
                        <Box component="span" sx={{ color: 'text.secondary' }}>
                          {summary.prop}
                        </Box>
                        <Box
                          component="span"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {summary.display}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ) : null}
                {bindingOptions?.length && textEditable ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="secondary"
                      onClick={(event) =>
                        setBindingAnchor(event.currentTarget)
                      }
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Insert binding
                    </Button>
                    <MuiMenu
                      anchorEl={bindingAnchor}
                      open={Boolean(bindingAnchor)}
                      onClose={() => {
                        setBindingAnchor(null)
                        setBindingSearch('')
                      }}
                    >
                      <Box sx={{ px: 1.5, pb: 1 }}>
                        <TextField
                          size="small"
                          placeholder="Search bindings…"
                          value={bindingSearch}
                          onChange={(event) =>
                            setBindingSearch(event.target.value)
                          }
                          onKeyDown={(event) => event.stopPropagation()}
                          autoFocus
                          fullWidth
                        />
                      </Box>
                      {visibleBindingOptions.length === 0 ? (
                        <MuiMenuItem disabled>
                          {'No bindings match'}
                        </MuiMenuItem>
                      ) : null}
                      {visibleBindingOptions.map((option, index) => {
                        const previous = visibleBindingOptions[index - 1]
                        return [
                          option.group && option.group !== previous?.group ? (
                            <ListSubheader key={`${option.group}-header`}>
                              {option.group}
                            </ListSubheader>
                          ) : null,
                          <MuiMenuItem
                            key={option.token}
                            onClick={() => {
                              setBindingSearch('')
                              handleInsertBinding(option.token)
                            }}
                          >
                            <Stack sx={{ minWidth: 0 }}>
                              <Typography variant="body2" noWrap>
                                {option.label}
                              </Typography>
                              {/* Live value preview (AGL-262). */}
                              {option.preview ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  noWrap
                                >
                                  {option.preview}
                                </Typography>
                              ) : null}
                            </Stack>
                          </MuiMenuItem>,
                        ]
                      })}
                    </MuiMenu>
                  </FormControl>
                ) : null}
                {onPickMedia && mediaAttributes.length
                  ? mediaAttributes.map((field: any) => (
                      <FormControl key={field.name} margin="none" fullWidth>
                        <Button
                          color="secondary"
                          onClick={handleBrowseMedia(field.name)}
                          sx={{ mt: 2 }}
                          fullWidth
                        >
                          {mediaAttributes.length > 1
                            ? `Browse media — ${field.label ?? field.name}`
                            : 'Browse media'}
                        </Button>
                      </FormControl>
                    ))
                  : null}
                {interactions.onCreateInteraction && node?.$id ? (
                  <FormControl margin="none" fullWidth>
                    {/* Interactions (AGL-258): automations bound to this
                        element's stable data-aglyn selector. */}
                    <Typography
                      variant="overline"
                      color="text.secondary"
                      sx={{ mt: 2 }}
                    >
                      {'Interactions'}
                    </Typography>
                    {nodeAutomations.map((automation) => (
                      <Stack
                        key={automation.id}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', mb: 0.5 }}
                      >
                        <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                          {automation.name ?? automation.id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {automation.event}
                        </Typography>
                        {/* Manage in place (wave v7): toggle + remove
                            without leaving the canvas. */}
                        {interactions.onToggleInteraction ? (
                          <Switch
                            size="small"
                            checked={automation.enabled !== false}
                            onChange={(event) =>
                              interactions.onToggleInteraction?.({
                                id: automation.id,
                                enabled: event.target.checked,
                              })
                            }
                            slotProps={{
                              input: { 'aria-label': 'Interaction enabled' },
                            }}
                          />
                        ) : automation.enabled === false ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {'off'}
                          </Typography>
                        ) : null}
                        {/* Fluent builder (AGL-319): edit reopens the
                            inline dialog — no Workflows detour. */}
                        {interactions.onEditInteraction && node?.$id ? (
                          <IconButton
                            size="small"
                            aria-label="Edit interaction"
                            onClick={() =>
                              interactions.onEditInteraction?.({
                                id: automation.id,
                                nodeId: node.$id as string,
                              })
                            }
                          >
                            {'✎'}
                          </IconButton>
                        ) : null}
                        {interactions.onDeleteInteraction ? (
                          <IconButton
                            size="small"
                            aria-label="Remove interaction"
                            onClick={() =>
                              interactions.onDeleteInteraction?.({
                                id: automation.id,
                              })
                            }
                          >
                            {'✕'}
                          </IconButton>
                        ) : null}
                      </Stack>
                    ))}
                    <TextField
                      select
                      size="small"
                      label="Add interaction"
                      value=""
                      onChange={(event) => {
                        const trigger = event.target
                          .value as InteractionTriggerEvent
                        if (trigger && node?.$id) {
                          interactions.onCreateInteraction?.({
                            nodeId: node.$id,
                            event: trigger,
                          })
                        }
                      }}
                    >
                      <MuiMenuItem value="elementClick">
                        {'When clicked…'}
                      </MuiMenuItem>
                      {/* Hover choreography (AGL-562). */}
                      <MuiMenuItem value="elementHoverEnter">
                        {'When hovered…'}
                      </MuiMenuItem>
                      <MuiMenuItem value="elementHoverLeave">
                        {'When hover ends…'}
                      </MuiMenuItem>
                      <MuiMenuItem value="elementVisible">
                        {'When scrolled into view…'}
                      </MuiMenuItem>
                    </TextField>
                    {interactions.onCreateSectionExperiment ? (
                      nodeExperiment ? (
                        <Typography
                          variant="caption"
                          color="secondary"
                          sx={{ mt: 1 }}
                        >
                          {`A/B test: ${nodeExperiment.name ?? nodeExperiment.id}` +
                            ` (${nodeExperiment.status ?? 'draft'})`}
                        </Typography>
                      ) : (
                        <Button
                          color="secondary"
                          size="small"
                          sx={{ mt: 1, alignSelf: 'flex-start' }}
                          onClick={() =>
                            node?.$id &&
                            interactions.onCreateSectionExperiment?.({
                              nodeId: node.$id,
                            })
                          }
                        >
                          {'A/B test this section'}
                        </Button>
                      )
                    ) : null}
                  </FormControl>
                ) : null}
                {(node?.props as any)?.repeatDataset ? (
                  <FormControl margin="none" fullWidth>
                    {/* Repeat badge (AGL-168): make dataset-driven
                        duplication visible where props are edited. */}
                    <Alert severity="info" sx={{ mt: 2 }}>
                      {'Repeats over dataset "' +
                        String((node?.props as any).repeatDataset) +
                        '" — children render once per record on the live site.'}
                    </Alert>
                  </FormControl>
                ) : null}
                {onRewrite && (textEditable || hasTextAttributes) ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="secondary"
                      onClick={() => onRewrite(node)}
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Rewrite with AI
                    </Button>
                  </FormControl>
                ) : null}
                {onPromote && !isInstance && unlocked ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="secondary"
                      onClick={() => onPromote(node)}
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Save as reusable component
                    </Button>
                  </FormControl>
                ) : null}
                {onDemote && isInstance && unlocked ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="secondary"
                      onClick={() => onDemote(node)}
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Detach from component
                    </Button>
                  </FormControl>
                ) : null}
                <FormControl margin="none" fullWidth>
                  <Button
                    onClick={() => deleteElementCallback(node)}
                    sx={{ mt: 2, color: 'error.main' }}
                    fullWidth
                  >
                    Delete Element
                  </Button>
                </FormControl>
              </>
            )}
          </FormRenderer>
        </NoSsr>
      </>
    )
  },
)
ElementPropsFormRaw.displayName = 'ElementPropsForm'
ElementPropsFormRaw.aglyn = true

export const ElementPropsForm = observer(ElementPropsFormRaw)
export default ElementPropsForm
