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

import * as Aglyn from '@aglyn/aglyn'
import { mdiDelete, mdiPlus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
]

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

  const errors = useMemo(() => {
    const seen = new Set<string>()
    return draft.map((prop) => {
      const name = prop.name?.trim() ?? ''
      if (!name) return 'A name is required'
      if (!Aglyn.COMPONENT_PROP_NAME_PATTERN.test(name)) {
        return 'Letters, numbers and underscores only, not starting with a number'
      }
      if (seen.has(name)) return 'Already used by another property'
      seen.add(name)
      return ''
    })
  }, [draft])

  const hasErrors = errors.some(Boolean)
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
      await onSave(
        draft.map((prop) => ({
          name: prop.name.trim(),
          type: prop.type ?? 'text',
          ...(prop.label?.trim() && { label: prop.label.trim() }),
          ...(prop.defaultValue && { defaultValue: prop.defaultValue }),
        })),
      )
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
            <Stack
              key={index}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: 'flex-start' }}
            >
              <TextField
                label="Name"
                size="small"
                value={prop.name ?? ''}
                error={Boolean(errors[index])}
                helperText={errors[index] || `{{prop.${prop.name || '…'}}}`}
                onChange={(event) => update(index, { name: event.target.value })}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                label="Type"
                size="small"
                value={prop.type ?? 'text'}
                onChange={(event) =>
                  update(index, {
                    type: event.target
                      .value as Aglyn.ReusableComponentPropType,
                  })
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
              <IconButton
                aria-label={`Remove ${prop.name || 'property'}`}
                onClick={() =>
                  setDraft((current) => current.filter((_, i) => i !== index))
                }
              >
                <MdiIcon path={mdiDelete.path} />
              </IconButton>
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
