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
import { Alert, NoSsr, TextField } from '@mui/material'
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
    // map + labels the console provides via ScreenLinkContext.
    const { screens, labels } = useContext(Aglyn.ScreenLinkContext)
    const attributes = useMemo(
      () =>
        (rawAttributes ?? []).map((field) =>
          field.component === Aglyn.FieldComponentType.SCREEN_SELECT
            ? {
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
            : field,
        ),
      [rawAttributes, screens, labels],
    )

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
    const hasSrcAttribute = (rawAttributes ?? []).some(
      (field: any) => field?.name === 'src',
    )
    const handleBrowseMedia = useCallback(() => {
      onPickMedia?.((url) => {
        const current = (Aglyn.canvas.toJSON().nodes as Record<string, any>)[
          node?.$id
        ]
        Aglyn.canvas.updateNodeProps(node, { ...current?.props, src: url })
      })
    }, [onPickMedia, node])

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
                            {option.label}
                          </MuiMenuItem>,
                        ]
                      })}
                    </MuiMenu>
                  </FormControl>
                ) : null}
                {onPickMedia && hasSrcAttribute ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="secondary"
                      onClick={handleBrowseMedia}
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Browse media
                    </Button>
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
