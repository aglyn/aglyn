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

import type * as Aglyn from '@aglyn/aglyn'
import {
  canvas,
  components,
  EntityPickerContext,
  FieldComponentType,
  getKnownPluginInstallsVersion,
  ScreenLinkContext,
  subscribeKnownPluginInstalls,
} from '@aglyn/aglyn'
import { useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import {
  FormRenderer,
  FormSpy,
  type FormTemplateRenderProps,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import { useHostThemeDocument } from '@aglyn/shared-ui-theme'
import { Grid } from '@mui/material'
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { MediaPickerContext } from '../contexts/media-picker-context'
import useInsertTokenOptions from '../hooks/use-insert-token-options'
import { buildStyleThemeScales } from '../utils/theme-scale-options'
import {
  type AttributeFieldResolveContext,
  buildPropertyField,
  elementPropsComponentMapper,
  entityKindsForAttributes,
  type PropertyOwnerNoun,
  resolveAttributeField,
  withNumericValueParse,
} from './element-props-form.component'
import { TOKEN_TEXT_FIELD_COMPONENT } from './token-text-field.component'

/**
 * Property values edited OUTSIDE the Attributes panel, with the Attributes
 * panel's own controls (AGL-2893): the Properties dialog's Default for each
 * property, a kind's settings, a condition's operand, and a screen's values
 * for the layout it renders inside.
 *
 * Each field is an attribute field — {@link buildPropertyField} for a
 * property — finished by {@link resolveAttributeField} against the same site
 * data the panel reads and drawn by `elementPropsComponentMapper`. So a Yes /
 * no is the switch, an Icon the icon picker and a Color the color picker
 * here exactly as they are on an instance, and nothing here can drift from
 * the panel into a look-alike.
 */

/** The form's nothing-to-submit: every change is reported as it happens. */
const noop = () => undefined

/** The values each change reports, compared so a re-render is not a change. */
function serialize(values: unknown): string {
  try {
    return JSON.stringify(values ?? {})
  } catch {
    return ''
  }
}

/** Hands the parent every change, and the form API for writes from outside. */
function AttributeFieldsFormTemplate(
  props: FormTemplateRenderProps & {
    onValues: (values: Record<string, unknown>) => void
    formApiRef: { current: ReturnType<typeof useFormApi> | undefined }
  },
) {
  const { formFields, onValues, formApiRef } = props
  const formApi = useFormApi()
  formApiRef.current = formApi
  // The values the form opened with, so the spy's first report — the state
  // it subscribed to, not a change — is not handed on as one.
  const last = useRef(serialize(formApi.getState().values))
  return (
    <form onSubmit={(event) => event.preventDefault()} noValidate>
      <Grid container spacing={2}>
        {formFields as unknown as JSX.Node}
      </Grid>
      <FormSpy
        subscription={{ values: true }}
        onChange={({ values }: { values: Record<string, unknown> }) => {
          const next = serialize(values)
          if (next === last.current) return
          last.current = next
          onValues(values)
        }}
      />
    </form>
  )
}

export interface AttributeFieldsFormProps {
  /**
   * Attribute fields — as a coded component would declare them, or as
   * {@link buildPropertyField} draws a property — named for paths in
   * `values`.
   */
  fields: ReadonlyArray<Record<string, unknown>>
  /** The values the form starts from. Later changes to this are not re-read. */
  values?: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  /** Written into the field when a media library pick lands, by field name. */
  mediaFields?: ReadonlySet<string>
}

/**
 * Attribute fields in a form of their own, resolved and drawn exactly as the
 * Attributes panel draws them, reporting every change.
 */
export function AttributeFieldsForm(props: AttributeFieldsFormProps) {
  const { fields, values, onChange, mediaFields } = props
  const [initialValues] = useState(() => values ?? {})
  const formApiRef = useRef<ReturnType<typeof useFormApi> | undefined>(undefined)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { screens, labels } = useContext(ScreenLinkContext)
  const entityOptions = useContext(EntityPickerContext)
  const { onPickMedia } = useContext(MediaPickerContext)
  const { options: insertOptions, labelContext: tokenLabelContext } =
    useInsertTokenOptions(undefined)
  const pluginInstallsVersion = useSyncExternalStore(
    subscribeKnownPluginInstalls,
    getKnownPluginInstallsVersion,
    getKnownPluginInstallsVersion,
  )

  // Ask for the entity lists these fields' pickers show (AGL-703), as the
  // Attributes panel does for the element it edits.
  const requestEntities = entityOptions.request
  useEffect(() => {
    if (!requestEntities) return
    for (const kind of entityKindsForAttributes(
      fields as unknown as Aglyn.AglynAttributeSchema[],
    )) {
      requestEntities(kind)
    }
  }, [fields, requestEntities])

  // The canvas's elements, for element pickers.
  const wantsNodes = fields.some(
    (field) => field['component'] === FieldComponentType.NODE_SELECT,
  )
  const nodeOptions = useMemo(() => {
    if (!wantsNodes) return []
    const canvasNodes = (canvas.toJSON().nodes ?? {}) as Record<string, any>
    return Object.entries(canvasNodes)
      .filter(([id]) => Boolean(id))
      .map(([id, candidate]) => {
        const displayName =
          components.getSchema(candidate?.componentId)?.displayName ??
          candidate?.componentId ??
          'Element'
        const text =
          typeof candidate?.props?.children === 'string'
            ? candidate.props.children.trim().slice(0, 24)
            : ''
        return {
          value: id,
          label: `${displayName}${text ? ` "${text}"` : ''} · ${id.slice(0, 6)}`,
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [wantsNodes])

  const context = useMemo<AttributeFieldResolveContext>(
    () => ({
      screens,
      labels,
      values: initialValues,
      entityOptions,
      nodeOptions,
      insertOptions,
      tokenLabelContext,
      pluginInstallsVersion,
    }),
    [
      screens,
      labels,
      initialValues,
      entityOptions,
      nodeOptions,
      insertOptions,
      tokenLabelContext,
      pluginInstallsVersion,
    ],
  )

  const resolved = useMemo(
    () =>
      fields
        .map((field) => resolveAttributeField(field, context))
        .map((field) =>
          onPickMedia &&
          mediaFields?.has(String(field['name'])) &&
          field['component'] === TOKEN_TEXT_FIELD_COMPONENT
            ? {
                ...field,
                onBrowseMedia: () =>
                  onPickMedia((value) =>
                    formApiRef.current?.change(String(field['name']), value),
                  ),
              }
            : field,
        )
        .filter((field) => String(field['component']) in elementPropsComponentMapper)
        .map(withNumericValueParse),
    [fields, context, onPickMedia, mediaFields],
  )

  // One component for the life of the form: a template created per render
  // would be a new component type each time, remounting every field.
  const [Template] = useState(
    () =>
      function BoundTemplate(templateProps: FormTemplateRenderProps) {
        return (
          <AttributeFieldsFormTemplate
            {...templateProps}
            formApiRef={formApiRef}
            onValues={(next) => onChangeRef.current(next)}
          />
        )
      },
  )

  return (
    <FormRenderer
      componentMapper={elementPropsComponentMapper}
      FormTemplate={Template}
      initialValues={initialValues}
      onSubmit={noop}
      schema={{ fields: resolved as never }}
    />
  )
}

export interface PropertyValuesFormProps {
  /** The properties the owner declares. */
  declared: readonly Aglyn.ReusableComponentProp[]
  /** Each property's value, by name. */
  values?: Record<string, unknown>
  /** Every property's value, by name, after each change. */
  onChange: (values: Record<string, unknown>) => void
  /**
   * `value` for a page setting them, with each empty field falling back to
   * the default and every condition applied; `default` for declaring those
   * defaults.
   */
  role?: 'value' | 'default'
  noun?: PropertyOwnerNoun
  /** Only these properties, by name; all of them when omitted. */
  only?: readonly string[]
}

/** The path a property's value sits at inside this form. */
const VALUES_KEY = 'values'
const pathOf = (name: string) => `${VALUES_KEY}.${name}`

/**
 * A component's or layout's properties, each edited with the control its
 * kind names in the Attributes panel.
 */
export function PropertyValuesForm(props: PropertyValuesFormProps) {
  const { declared, values, onChange, role = 'value', noun = 'component', only } = props
  const hostThemeDoc = useHostThemeDocument()
  const siteTheme = useAglynSiteTheme({ theme: hostThemeDoc })
  const themeScales = useMemo(
    () => buildStyleThemeScales(siteTheme as any) as unknown as Record<string, unknown>,
    [siteTheme],
  )
  const shown = useMemo(
    () =>
      declared.filter(
        (prop) => Boolean(prop?.name) && (!only || only.includes(prop.name)),
      ),
    [declared, only],
  )
  const fields = useMemo(
    () =>
      shown.map((prop) =>
        buildPropertyField(prop, {
          name: pathOf(prop.name),
          role,
          declared,
          valuePath: pathOf,
          noun,
          themeScales,
        }),
      ),
    [shown, role, declared, noun, themeScales],
  )
  const mediaFields = useMemo(
    () =>
      new Set(
        shown
          .filter((prop) => prop.type === 'image')
          .map((prop) => pathOf(prop.name)),
      ),
    [shown],
  )
  const [initial] = useState(() => ({ [VALUES_KEY]: values ?? {} }))
  return (
    <AttributeFieldsForm
      fields={fields}
      values={initial}
      mediaFields={mediaFields}
      onChange={(next) =>
        onChange(
          (next?.[VALUES_KEY] as Record<string, unknown> | undefined) ?? {},
        )
      }
    />
  )
}

export default PropertyValuesForm
