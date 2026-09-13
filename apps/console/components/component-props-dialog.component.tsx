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
import { COMPONENT_PROP_NAME_PATTERN, readYesNoValue } from '@aglyn/aglyn'
import { mdiDelete, mdiPlus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { ScreenLinkValuePicker } from '@aglyn/besigner-ui'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormHelperText,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

const TYPE_OPTIONS: Array<{
  value: Aglyn.ReusableComponentPropType
  label: string
}> = [
  { value: 'text', label: 'Text' },
  { value: 'richText', label: 'Long text' },
  { value: 'image', label: 'Image' },
  { value: 'href', label: 'Link' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'choice', label: 'Choice' },
]

/**
 * Kinds whose default is free text in one shape or another — a word, a
 * number, an image address, a link — so a default typed under one still
 * means something under another.
 */
const TEXT_SHAPED_TYPES: ReadonlySet<Aglyn.ReusableComponentPropType> = new Set(
  ['text', 'richText', 'image', 'href', 'number'],
)

/**
 * The patch that changes a property's type, keeping the default only where it
 * still means something.
 *
 * A headline typed as the default of a Text property is not a yes or a no:
 * carried into a Yes / no property it would read as Yes, which nobody chose.
 * So a default survives a change between text-shaped kinds and is dropped on
 * any change into or out of the others, leaving that kind's own "not set".
 * A Choice's list of answers belongs to the Choice, and goes with it.
 */
export function retypeComponentProp(
  prop: Aglyn.ReusableComponentProp,
  type: Aglyn.ReusableComponentPropType,
): Partial<Aglyn.ReusableComponentProp> {
  const from = prop.type ?? 'text'
  if (from === type) return { type }
  const keepsDefault = TEXT_SHAPED_TYPES.has(from) && TEXT_SHAPED_TYPES.has(type)
  return {
    type,
    ...(keepsDefault ? {} : { defaultValue: undefined }),
    options: type === 'choice' ? (prop.options ?? []) : undefined,
  }
}

/** What is wrong with one property, field by field — `''` where nothing is. */
export interface ComponentPropErrors {
  name: string
  choices: string
}

/**
 * Every property's problems, in draft order.
 *
 * A name is checked against the pattern the graft requires and against every
 * name before it. A Choice needs answers, and each answer needs a value no
 * other answer has: the value is what a bound field receives, so an empty one
 * could never be picked and a repeated one would be two labels for one
 * result.
 */
export function componentPropErrors(
  draft: readonly Aglyn.ReusableComponentProp[],
): ComponentPropErrors[] {
  const seen = new Set<string>()
  return draft.map((prop) => {
    const name = prop.name?.trim() ?? ''
    let nameError = ''
    if (!name) nameError = 'A name is required'
    else if (!COMPONENT_PROP_NAME_PATTERN.test(name)) {
      nameError =
        'Letters, numbers and underscores only, not starting with a number'
    } else if (seen.has(name)) nameError = 'Already used by another property'
    if (name) seen.add(name)

    let choicesError = ''
    if (prop.type === 'choice') {
      const values = (prop.options ?? []).map((option) =>
        (option?.value ?? '').trim(),
      )
      const repeated = values.find(
        (value, index) => value && values.indexOf(value) !== index,
      )
      if (!values.length) choicesError = 'Add at least one choice'
      else if (values.some((value) => !value)) {
        choicesError = 'Every choice needs a value'
      } else if (repeated) {
        choicesError = `Two choices share the value "${repeated}"`
      }
    }
    return { name: nameError, choices: choicesError }
  })
}

/**
 * The draft as it is saved: trimmed, with only the fields its type uses.
 *
 * A Choice's default is kept only while it still names one of its answers —
 * editing an answer's value would otherwise leave the default pointing at a
 * value no page can pick, and every page that sets nothing would render it.
 */
export function cleanComponentProps(
  draft: readonly Aglyn.ReusableComponentProp[],
): Aglyn.ReusableComponentProp[] {
  return draft.map((prop) => {
    const type = prop.type ?? 'text'
    const options =
      type === 'choice'
        ? (prop.options ?? []).map((option) => ({
            value: (option?.value ?? '').trim(),
            ...(option?.label?.trim() && { label: option.label.trim() }),
          }))
        : undefined
    const defaultValue =
      type === 'choice' &&
      !options?.some((option) => option.value === prop.defaultValue)
        ? undefined
        : prop.defaultValue
    return {
      name: prop.name.trim(),
      type,
      ...(prop.label?.trim() && { label: prop.label.trim() }),
      ...(defaultValue && { defaultValue }),
      ...(options && { options }),
    }
  })
}

/**
 * A Choice's answers, edited as rows of plain fields: the label a page author
 * picks from, and the value the bound field receives.
 */
function ChoiceOptionsEditor(props: {
  options: Aglyn.ReusableComponentPropOption[]
  error: string
  onChange: (options: Aglyn.ReusableComponentPropOption[]) => void
}) {
  const { options, error, onChange } = props
  const edit = (index: number, patch: Partial<Aglyn.ReusableComponentPropOption>) =>
    onChange(
      options.map((option, i) => (i === index ? { ...option, ...patch } : option)),
    )
  return (
    <Stack
      spacing={1}
      sx={{ pl: { sm: 2 }, borderLeft: { sm: 2 }, borderColor: { sm: 'divider' } }}
    >
      <Typography variant="caption" color="text.secondary">
        {'Choices. A page picks one by its label, and the field this property '}
        {'is bound to receives its value — for a dropdown, use the values it '}
        {'offers, which the Attributes panel lists when you bind it.'}
      </Typography>
      {options.map((option, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            label="Label"
            size="small"
            value={option.label ?? ''}
            placeholder={option.value}
            onChange={(event) => edit(index, { label: event.target.value })}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Value"
            size="small"
            value={option.value ?? ''}
            onChange={(event) => edit(index, { value: event.target.value })}
            sx={{ flex: 1 }}
          />
          <IconButton
            aria-label={`Remove choice ${option.label || option.value || index + 1}`}
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            <MdiIcon path={mdiDelete.path} />
          </IconButton>
        </Stack>
      ))}
      <Box>
        <Button
          size="small"
          startIcon={<MdiIcon path={mdiPlus.path} />}
          onClick={() => onChange([...options, { value: '', label: '' }])}
        >
          {'Add choice'}
        </Button>
      </Box>
      {error ? <FormHelperText error>{error}</FormHelperText> : null}
    </Stack>
  )
}

export interface ComponentPropsDialogProps {
  open: boolean
  /** Props currently declared on the version being edited. */
  value: Aglyn.ReusableComponentProp[] | undefined
  onClose: () => void
  onSave: (props: Aglyn.ReusableComponentProp[]) => Promise<void> | void
}

/**
 * Declares the props a reusable component exposes (AGL-1247) — the authoring
 * half of the feature whose renderer half is `composeReusableComponentNodes`.
 *
 * Inside the component the author binds a node prop to one of these with the
 * existing token syntax (`{{prop.headline}}`); placing the component then
 * gives each instance its own fields in the Attributes panel. That is what
 * lets one hero serve eleven pages instead of being copied onto each.
 *
 * Renaming is called out rather than prevented: instance values are keyed by
 * prop NAME, so a rename orphans every value already set on every page. The
 * warning is worth more than a block here — the author may genuinely be
 * fixing a typo on a prop nothing uses yet.
 */
export function ComponentPropsDialog(props: ComponentPropsDialogProps) {
  const { open, value, onClose, onSave } = props
  const [draft, setDraft] = useState<Aglyn.ReusableComponentProp[]>([])
  const [saving, setSaving] = useState(false)

  // Re-seed each time the dialog opens so a cancelled edit is truly
  // discarded rather than lingering into the next open.
  useEffect(() => {
    if (open) setDraft(value?.length ? value.map((prop) => ({ ...prop })) : [])
  }, [open, value])

  const originalNames = useMemo(
    () => new Set((value ?? []).map((prop) => prop.name)),
    [value],
  )

  const errors = useMemo(() => componentPropErrors(draft), [draft])

  const hasErrors = errors.some((error) => error.name || error.choices)
  // A name that existed before and no longer does orphans whatever the
  // pages already set for it.
  const renamed = useMemo(() => {
    const next = new Set(draft.map((prop) => prop.name?.trim()))
    return [...originalNames].filter((name) => name && !next.has(name))
  }, [draft, originalNames])

  const update = (index: number, patch: Partial<Aglyn.ReusableComponentProp>) =>
    setDraft((current) =>
      current.map((prop, i) => (i === index ? { ...prop, ...patch } : prop)),
    )

  const handleSave = async () => {
    if (hasErrors || saving) return
    setSaving(true)
    try {
      await onSave(cleanComponentProps(draft))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{'Component properties'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {'Properties let one component show different content on each page. '}
          {'Add one here, then use its token — for example '}
          <code>{'{{prop.headline}}'}</code>
          {' — anywhere inside this component. Each place you use the '}
          {'component gets its own fields in the Attributes panel.'}
        </Typography>

        {draft.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {'No properties yet.'}
          </Typography>
        ) : null}

        <Stack spacing={2}>
          {draft.map((prop, index) => (
            <Stack key={index} spacing={1}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ alignItems: 'flex-start' }}
              >
                <TextField
                  label="Name"
                  size="small"
                  value={prop.name ?? ''}
                  error={Boolean(errors[index]?.name)}
                  helperText={
                    errors[index]?.name || `{{prop.${prop.name || '…'}}}`
                  }
                  onChange={(event) => update(index, { name: event.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  select
                  label="Type"
                  size="small"
                  value={prop.type ?? 'text'}
                  onChange={(event) =>
                    update(
                      index,
                      retypeComponentProp(
                        prop,
                        event.target.value as Aglyn.ReusableComponentPropType,
                      ),
                    )
                  }
                  sx={{ minWidth: 130 }}
                >
                  {TYPE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Label"
                  size="small"
                  value={prop.label ?? ''}
                  helperText="Shown in Attributes"
                  onChange={(event) =>
                    update(index, { label: event.target.value })
                  }
                  sx={{ flex: 1 }}
                />
                {prop.type === 'href' ? (
                  // A `Link` default is a screen, not a path (AGL-1335): the
                  // picker stores the screen id, so the component's fallback
                  // link survives a rename of the screen it points at — which
                  // is what "Link" promised and a text box could not deliver.
                  <Box sx={{ flex: 1 }}>
                    <ScreenLinkValuePicker
                      label="Default"
                      value={prop.defaultValue ?? ''}
                      emptyLabel="No default"
                      helperText="Used where a page sets nothing"
                      onChange={(next) =>
                        update(index, { defaultValue: next })
                      }
                    />
                  </Box>
                ) : prop.type === 'boolean' ? (
                  // A yes or a no, never a typed word: the default is read with
                  // the same spellings every Yes / no reader uses, so a default
                  // typed as `off` before this was a dropdown still shows No.
                  <TextField
                    select
                    label="Default"
                    size="small"
                    value={
                      readYesNoValue(prop.defaultValue) === true ? 'true' : 'false'
                    }
                    helperText="Used where a page sets nothing"
                    onChange={(event) =>
                      update(index, { defaultValue: event.target.value })
                    }
                    sx={{ flex: 1 }}
                  >
                    <MenuItem value="true">{'Yes'}</MenuItem>
                    <MenuItem value="false">{'No'}</MenuItem>
                  </TextField>
                ) : prop.type === 'choice' ? (
                  // One of the answers below, picked by label — never a typed
                  // value that might match none of them.
                  <TextField
                    select
                    label="Default"
                    size="small"
                    value={
                      (prop.options ?? []).some(
                        (option) =>
                          option.value && option.value === prop.defaultValue,
                      )
                        ? prop.defaultValue
                        : ''
                    }
                    helperText="Used where a page sets nothing"
                    onChange={(event) =>
                      update(index, {
                        defaultValue: event.target.value || undefined,
                      })
                    }
                    slotProps={{
                      select: { displayEmpty: true },
                      inputLabel: { shrink: true },
                    }}
                    sx={{ flex: 1 }}
                  >
                    <MenuItem value="">{'No default'}</MenuItem>
                    {(prop.options ?? [])
                      .filter((option) => option.value)
                      .map((option, optionIndex) => (
                        <MenuItem key={optionIndex} value={option.value}>
                          {option.label || option.value}
                        </MenuItem>
                      ))}
                  </TextField>
                ) : (
                  <TextField
                    label="Default"
                    size="small"
                    value={prop.defaultValue ?? ''}
                    helperText="Used where a page sets nothing"
                    onChange={(event) =>
                      update(index, { defaultValue: event.target.value })
                    }
                    sx={{ flex: 1 }}
                  />
                )}
                <IconButton
                  aria-label={`Remove ${prop.name || 'property'}`}
                  onClick={() =>
                    setDraft((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <MdiIcon path={mdiDelete.path} />
                </IconButton>
              </Stack>
              {prop.type === 'choice' ? (
                <ChoiceOptionsEditor
                  options={prop.options ?? []}
                  error={errors[index]?.choices ?? ''}
                  onChange={(options) => update(index, { options })}
                />
              ) : null}
            </Stack>
          ))}
        </Stack>

        <Button
          startIcon={<MdiIcon path={mdiPlus.path} />}
          onClick={() =>
            setDraft((current) => [...current, { name: '', type: 'text' }])
          }
          sx={{ mt: 2 }}
        >
          {'Add property'}
        </Button>

        {renamed.length ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {renamed.length === 1
              ? `"${renamed[0]}" was renamed or removed. `
              : `${renamed.length} properties were renamed or removed. `}
            {'Pages using this component keep whatever they set for the old '}
            {'name, but it will no longer be used — those pages fall back to '}
            {'the default.'}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          {'Cancel'}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={hasErrors || saving}
        >
          {'Save properties'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ComponentPropsDialog
