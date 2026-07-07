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
  simpleComponentMapper,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import {
  mdiContentSave,
} from '@aglyn/shared-data-mdi'
import {
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { NoSsr } from '@mui/material'
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

    // AI copy assist (AGL-89): only for text-editable elements, and only
    // when the host app provides the rewrite callback.
    const { onRewrite } = useContext(AiAssistContext)
    const textEditable =
      ((schema?.flags?.textEditable ?? Aglyn.FEATURE_FLAG.DISABLED) &
        Aglyn.FEATURE_FLAG.ENABLED) !==
      0

    // Insert binding (AGL-100): appends a {{token}} to the element text.
    // Options come from the host app (variables + functions); the commit
    // spreads current props — updateNodeProps REPLACES the props object.
    const { options: bindingOptions } = useContext(BindingPickerContext)
    const [bindingAnchor, setBindingAnchor] = useState<HTMLElement | null>(
      null,
    )
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

    const handleFormCancel = useCallback((e: SyntheticEvent, reason?: string) => {}, [])
    const handleElementSave = useCallback(
      (values: Record<string, unknown>) => {
        Aglyn.canvas.updateNodeProps(node, values)
      },
      [node],
    )

    return (
      <>
        <NoSsr>
          <FormRenderer
            componentMapper={simpleComponentMapper}
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
                      onClose={() => setBindingAnchor(null)}
                    >
                      {bindingOptions.map((option, index) => {
                        const previous = bindingOptions[index - 1]
                        return [
                          option.group && option.group !== previous?.group ? (
                            <ListSubheader key={`${option.group}-header`}>
                              {option.group}
                            </ListSubheader>
                          ) : null,
                          <MuiMenuItem
                            key={option.token}
                            onClick={() => handleInsertBinding(option.token)}
                          >
                            {option.label}
                          </MuiMenuItem>,
                        ]
                      })}
                    </MuiMenu>
                  </FormControl>
                ) : null}
                {onRewrite && textEditable ? (
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
