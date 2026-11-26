'use client'

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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import type { PhoneOpenSpan, PhoneSettings, PhoneTemplate } from '../model/phone.types'
import type { PhoneSectionProps } from './phone-console-page'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function toClock(minute: number): string {
  const hours = Math.floor(minute / 60) % 24
  return `${String(hours).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function fromClock(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/**
 * Settings (AGL-4251): business hours, the cells calls forward to, how long
 * they ring, what callers hear, the missed-call text, and saved replies.
 */
export function PhoneSettingsSection({ api, status, reload }: PhoneSectionProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [settings, setSettings] = useState<PhoneSettings>(status.settings)
  const [busy, setBusy] = useState(false)
  const locked = !status.canManage
  const patch = (next: Partial<PhoneSettings>) => setSettings((current) => ({ ...current, ...next }))

  const spanFor = (day: number): PhoneOpenSpan | undefined => settings.hours.find((span) => span.day === day)
  const setSpan = (day: number, span: PhoneOpenSpan | null) =>
    patch({ hours: [...settings.hours.filter((one) => one.day !== day), ...(span ? [span] : [])].sort((a, b) => a.day - b.day) })

  const save = async () => {
    setBusy(true)
    try {
      setSettings(await api.saveSettings(settings))
      await reload()
      enqueueSnackbar('Saved.', { variant: 'success' })
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={2}>
      <CardDisplay
        header="Business hours"
        subheader={settings.hours.length ? settings.timeZone : 'Always open'}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            During hours, calls ring the cells below. Outside them, callers hear your closed message and can leave a
            voicemail. With no days ticked, the number is always open.
          </Typography>
          <TextField
            size="small"
            label="Time zone"
            value={settings.timeZone}
            disabled={locked}
            onChange={(event) => patch({ timeZone: event.target.value })}
            sx={{ maxWidth: 280 }}
          />
          {DAYS.map((name, day) => {
            const span = spanFor(day)
            return (
              <Stack sx={{ alignItems: 'center' }} key={name} direction="row" spacing={1}>
                <FormControlLabel
                  sx={{ width: 150 }}
                  control={
                    <Checkbox
                      checked={Boolean(span)}
                      disabled={locked}
                      onChange={(event) =>
                        setSpan(day, event.target.checked ? { day, openMinute: 9 * 60, closeMinute: 17 * 60 } : null)
                      }
                    />
                  }
                  label={name}
                />
                {span ? (
                  <>
                    <TextField
                      size="small"
                      type="time"
                      label="Opens"
                      value={toClock(span.openMinute)}
                      disabled={locked}
                      onChange={(event) => setSpan(day, { ...span, openMinute: fromClock(event.target.value) })}
                    />
                    <TextField
                      size="small"
                      type="time"
                      label="Closes"
                      value={toClock(span.closeMinute)}
                      disabled={locked}
                      onChange={(event) => setSpan(day, { ...span, closeMinute: fromClock(event.target.value) })}
                    />
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Closed
                  </Typography>
                )}
              </Stack>
            )
          })}
        </Stack>
      </CardDisplay>

      <CardDisplay header="Calls" contentGutterX contentGutterY>
        <Stack spacing={2}>
          <TextField
            size="small"
            label="Ring these cell phones"
            helperText="Up to five numbers, separated by commas. Every one rings at once; the first to answer takes the call."
            value={settings.forwardTo.join(', ')}
            disabled={locked}
            onChange={(event) =>
              patch({ forwardTo: event.target.value.split(',').map((one) => one.trim()).filter(Boolean) })
            }
          />
          <TextField
            size="small"
            type="number"
            label="Seconds to ring before voicemail"
            value={settings.ringSeconds}
            disabled={locked}
            slotProps={{ htmlInput: { min: 10, max: 60 } }}
            onChange={(event) => patch({ ringSeconds: Number(event.target.value) })}
            sx={{ maxWidth: 280 }}
          />
          <TextField
            size="small"
            multiline
            label="Voicemail greeting"
            value={settings.voicemailGreeting}
            disabled={locked}
            onChange={(event) => patch({ voicemailGreeting: event.target.value })}
          />
          <TextField
            size="small"
            multiline
            label="Closed message"
            value={settings.closedGreeting}
            disabled={locked}
            onChange={(event) => patch({ closedGreeting: event.target.value })}
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.voicemailTranscription}
                disabled={locked}
                onChange={(event) => patch({ voicemailTranscription: event.target.checked })}
              />
            }
            label="Write out voicemails as text"
          />
          <TextField
            size="small"
            multiline
            label="Text a missed caller"
            helperText="Sent from your number after a call nobody answered. Leave it empty to send nothing."
            value={settings.missedCallText}
            disabled={locked}
            onChange={(event) => patch({ missedCallText: event.target.value })}
          />
        </Stack>
      </CardDisplay>

      <PhoneTemplatesCard
        templates={settings.templates}
        locked={locked}
        onChange={(templates) => patch({ templates })}
      />

      {!locked ? (
        <Stack sx={{ justifyContent: 'flex-end' }} direction="row">
          <Button variant="contained" disabled={busy} onClick={() => void save()}>
            Save settings
          </Button>
        </Stack>
      ) : null}
    </Stack>
  )
}

function PhoneTemplatesCard(props: { templates: PhoneTemplate[]; locked: boolean; onChange(next: PhoneTemplate[]): void }) {
  const { templates, locked, onChange } = props
  const update = (index: number, next: Partial<PhoneTemplate>) =>
    onChange(templates.map((one, i) => (i === index ? { ...one, ...next } : one)))
  return (
    <CardDisplay
      header="Saved replies"
      HeaderProps={{
        action: !locked ? (
          <Button
            size="small"
            onClick={() => onChange([...templates, { id: `t${Date.now().toString(36)}`, label: 'New reply', body: '' }])}
          >
            Add reply
          </Button>
        ) : undefined,
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Offered under the message box. {siteLink} becomes your site’s address and {businessName} its name. Paste your booking or waiver page’s link into a reply to send it in one tap.'}
        </Typography>
        {templates.map((template, index) => (
          <Stack sx={{ alignItems: 'flex-start' }} key={template.id} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              label="Name"
              value={template.label}
              disabled={locked}
              onChange={(event) => update(index, { label: event.target.value })}
              sx={{ minWidth: 180 }}
            />
            <TextField
              size="small"
              label="Text"
              multiline
              fullWidth
              value={template.body}
              disabled={locked}
              onChange={(event) => update(index, { body: event.target.value })}
            />
            {!locked ? (
              <IconButton aria-label={`Remove ${template.label}`} onClick={() => onChange(templates.filter((_, i) => i !== index))}>
                ×
              </IconButton>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </CardDisplay>
  )
}

export default PhoneSettingsSection
