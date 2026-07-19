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
import { mdiEmailFastOutline, mdiFormTextbox } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Rating from '@mui/material/Rating'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { type FormEvent, forwardRef, useCallback, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const FORM_ID: Aglyn.ComponentId = 'form'
export const FORM_FIELD_ID: Aglyn.ComponentId = 'formField'

export interface FormProps {
  /** Identifies the form in the submissions inbox. */
  formName?: string
  /**
   * Dataset (by name) submissions also append into, mapped by field name
   * (AGL-141); the inbox copy is always written.
   */
  datasetName?: string
  submitLabel?: string
  successMessage?: string
  children?: React.ReactNode
}

/**
 * Lead-capture form (AGL-76): collects its field children's values and
 * posts them to the tenant's `/api/forms/submit` with the site's host id
 * from SiteContext. Without a site context (besigner canvas, preview) the
 * submit is inert, so editing never creates submissions. Includes a
 * honeypot input for naive bots.
 */
const Form = forwardRef<HTMLFormElement, FormProps>((props, ref) => {
  const {
    formName,
    datasetName,
    submitLabel,
    successMessage,
    children,
    ...rest
  } = props
  const { hostId } = Aglyn.useSite()
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  )
  const [alerts, setAlerts] = useState<
    Array<{ message: string; severity?: string }>
  >([])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!hostId || status === 'sending') return
      const data = new FormData(event.currentTarget)
      const fields: Record<string, string> = {}
      let website = ''
      for (const [key, value] of data.entries()) {
        if (typeof value !== 'string') continue
        if (key === 'website') {
          website = value
          continue
        }
        // `__`-prefixed inputs are internal controls (e.g. the rating
        // field's star radios) and never submit (AGL-544).
        if (key.startsWith('__')) continue
        // Checkbox groups emit one entry per ticked box; join them under
        // the field name instead of letting the last one win (AGL-544).
        fields[key] = (
          key in fields ? `${fields[key]}, ${value}` : value
        ).slice(0, 2000)
      }
      setStatus('sending')
      try {
        const response = await fetch('/api/forms/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            formName: formName || 'Form',
            ...(datasetName ? { dataset: datasetName } : {}),
            path: window.location.pathname,
            fields,
            website,
          }),
        })
        if (response.ok) {
          // Site alerts from the actions builder (AGL-148).
          const payload = await response.json().catch(() => ({}))
          if (Array.isArray(payload?.alerts)) setAlerts(payload.alerts)
        }
        setStatus(response.ok ? 'sent' : 'error')
      } catch {
        setStatus('error')
      }
    },
    [hostId, status, formName, datasetName],
  )

  if (status === 'sent') {
    return (
      <Alert severity="success">
        {successMessage || 'Thanks — your message has been sent.'}
      </Alert>
    )
  }

  return (
    <Stack
      ref={ref}
      component="form"
      spacing={2}
      onSubmit={handleSubmit}
      {...rest}
    >
      {children}
      {/* Honeypot: humans never see or fill this. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-5000px', height: 0, width: 0 }}
      />
      {status === 'error' ? (
        <Alert severity="error">
          {'Something went wrong — please try again.'}
        </Alert>
      ) : null}
      {alerts.map((alert, index) => (
        <Alert key={index} severity={(alert.severity as any) || 'info'}>
          {alert.message}
        </Alert>
      ))}
      <Button
        type="submit"
        variant="contained"
        disabled={status === 'sending'}
        sx={{ alignSelf: 'flex-start' }}
      >
        {status === 'sending' ? 'Sending…' : submitLabel || 'Send'}
      </Button>
    </Stack>
  )
})
Form.displayName = 'AglynForm'

export interface FormFieldProps {
  /** Submission key; also the input's name attribute. */
  fieldName?: string
  label?: string
  fieldType?:
    | 'text'
    | 'email'
    | 'textarea'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'rating'
  /**
   * Choice list for select/radio/checkbox fields (AGL-544): newline- or
   * comma-separated. Ignored by the other types.
   */
  options?: string
  required?: boolean
}

/**
 * Splits a newline- or comma-separated choice list into trimmed,
 * non-empty entries (AGL-544).
 */
export const parseFieldOptions = (options?: string): string[] =>
  (options || '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)

/**
 * Single input inside a Form (AGL-76). Survey field types — select,
 * radio, checkbox group, and star rating — are AGL-544.
 */
const FormField = forwardRef<HTMLDivElement, FormFieldProps>((props, ref) => {
  const { fieldName, label, fieldType, options, required, ...rest } = props
  const name = fieldName || 'field'
  const fieldLabel = label || fieldName || 'Field'
  const choices = parseFieldOptions(options)
  // Checkbox groups count ticked boxes so "required" can mean "at least
  // one": native `required` is only asserted while none are ticked.
  const [checkedCount, setCheckedCount] = useState(0)
  // Rating is controlled so a hidden input can serialize the number.
  const [rating, setRating] = useState<number | null>(null)

  if (fieldType === 'select') {
    return (
      <TextField
        ref={ref}
        select
        name={name}
        label={fieldLabel}
        required={Boolean(required)}
        defaultValue=""
        fullWidth
        size="small"
        {...rest}
      >
        {choices.map((choice, index) => (
          <MenuItem key={index} value={choice}>
            {choice}
          </MenuItem>
        ))}
      </TextField>
    )
  }

  if (fieldType === 'radio') {
    return (
      <FormControl ref={ref} required={Boolean(required)} {...rest}>
        <FormLabel>{fieldLabel}</FormLabel>
        <RadioGroup name={name}>
          {choices.map((choice, index) => (
            <FormControlLabel
              key={index}
              value={choice}
              label={choice}
              control={<Radio size="small" required={Boolean(required)} />}
            />
          ))}
        </RadioGroup>
      </FormControl>
    )
  }

  if (fieldType === 'checkbox') {
    return (
      <FormControl ref={ref} required={Boolean(required)} {...rest}>
        <FormLabel>{fieldLabel}</FormLabel>
        <FormGroup>
          {choices.map((choice, index) => (
            <FormControlLabel
              key={index}
              label={choice}
              control={
                <Checkbox
                  name={name}
                  value={choice}
                  size="small"
                  required={Boolean(required) && checkedCount === 0}
                  onChange={(event) =>
                    setCheckedCount(
                      (count) => count + (event.target.checked ? 1 : -1),
                    )
                  }
                />
              }
            />
          ))}
        </FormGroup>
      </FormControl>
    )
  }

  if (fieldType === 'rating') {
    return (
      <FormControl ref={ref} required={Boolean(required)} {...rest}>
        <FormLabel>{fieldLabel}</FormLabel>
        <Rating
          // `__`-prefixed so the star radios themselves are skipped by
          // Form.handleSubmit; the hidden input carries the value.
          name={`__${name}`}
          value={rating}
          onChange={(_event, value) => setRating(value)}
        />
        <input type="hidden" name={name} value={rating ?? ''} />
      </FormControl>
    )
  }

  return (
    <TextField
      ref={ref}
      name={name}
      label={fieldLabel}
      type={fieldType === 'email' ? 'email' : 'text'}
      required={Boolean(required)}
      multiline={fieldType === 'textarea'}
      minRows={fieldType === 'textarea' ? 3 : undefined}
      fullWidth
      size="small"
      {...rest}
    />
  )
})
FormField.displayName = 'AglynFormField'

export const formSchema: Aglyn.ComponentSchema<FormProps> = {
  $id: FORM_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Form',
  category: Aglyn.ComponentCategory.FORMS,
  icon: { path: mdiEmailFastOutline.path, sx: { color: '#0288d1' } },
  attributes: [
    {
      name: 'formName',
      description: 'Identifies this form in the submissions inbox.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Form name',
    },
    {
      name: 'datasetName',
      description:
        'Optional dataset (by name, from the Data page) submissions are ' +
        'appended to — fields map by name. The inbox always gets a copy.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Write to dataset',
    },
    {
      name: 'submitLabel',
      description: 'Label of the submit button.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Submit label',
    },
    {
      name: 'successMessage',
      description: 'Shown after a successful submission.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Success message',
    },
  ],
}

export const formFieldSchema: Aglyn.ComponentSchema<FormFieldProps> = {
  $id: FORM_FIELD_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Form Field',
  category: Aglyn.ComponentCategory.FORMS,
  icon: { path: mdiFormTextbox.path, sx: { color: '#0288d1' } },
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    {
      name: 'fieldName',
      description: 'Key this value is stored under in submissions.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Field name',
    },
    {
      name: 'label',
      description: 'Visible input label.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Label',
    },
    {
      name: 'fieldType',
      description: 'Input type.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Type',
      options: [
        { value: '', label: 'Text' },
        { value: 'email', label: 'Email' },
        { value: 'textarea', label: 'Multiline' },
        { value: 'select', label: 'Dropdown' },
        { value: 'radio', label: 'Radio choice' },
        { value: 'checkbox', label: 'Checkboxes' },
        { value: 'rating', label: 'Star rating' },
      ],
    },
    {
      name: 'options',
      description:
        'Choices for dropdown, radio, and checkbox fields — one per line ' +
        '(or comma-separated). Ignored by the other types.',
      component: Aglyn.FieldComponentType.TEXTAREA,
      label: 'Options',
    },
    {
      name: 'required',
      description: 'Whether the field must be filled.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Required?',
    },
  ],
}

export const formPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(FORM_ID, 'contact'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Contact Form',
    pluginId: BUNDLE_ID,
    description: 'Name, email, and message with a send button',
    category: Aglyn.ComponentCategory.FORMS,
    icon: { path: mdiEmailFastOutline.path, sx: { color: '#0288d1' } },
    data: {
      $id: null,
      componentId: FORM_ID,
      pluginId: BUNDLE_ID,
      props: { formName: 'Contact' },
      nodes: [
        {
          $id: null,
          componentId: FORM_FIELD_ID,
          pluginId: BUNDLE_ID,
          props: { fieldName: 'name', label: 'Name', required: true },
        },
        {
          $id: null,
          componentId: FORM_FIELD_ID,
          pluginId: BUNDLE_ID,
          props: {
            fieldName: 'email',
            label: 'Email',
            fieldType: 'email',
            required: true,
          },
        },
        {
          $id: null,
          componentId: FORM_FIELD_ID,
          pluginId: BUNDLE_ID,
          props: {
            fieldName: 'message',
            label: 'Message',
            fieldType: 'textarea',
            required: true,
          },
        },
      ],
    },
  },
  {
    $id: generatePresetId(FORM_FIELD_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Form Field',
    pluginId: BUNDLE_ID,
    description: 'Single input inside a form',
    category: Aglyn.ComponentCategory.FORMS,
    icon: { path: mdiFormTextbox.path, sx: { color: '#0288d1' } },
    data: {
      $id: null,
      componentId: FORM_FIELD_ID,
      pluginId: BUNDLE_ID,
      props: { fieldName: 'field', label: 'Field' },
    },
  },
]

export { Form, FormField }
export default Form
