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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { MarkdownField } from '@aglyn/aglyn-markdown-editor'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import {
  WAIVER_ADULT_AGE_RANGE,
  WAIVER_DEFAULT_ADULT_AGE,
  WAIVER_LIMITS,
  WAIVER_STATUS_LABELS,
  normalizeWaiverDraft,
  waiverAdultAge,
  type WaiverCheckbox,
  type WaiverTemplate,
  type WaiverValidity,
} from '../model/waiver'
import { useWaiversFetch } from './waivers-api'

export interface WaiverEditorProps {
  hostId: string
  /** `null` writes a new waiver. */
  waiverId: string | null
  canManage: boolean
  onSaved: (waiver: WaiverTemplate) => void
  onBack: () => void
}

interface VersionRow {
  version: number
  title: string
  savedAtMs: number
}

const STARTER_BODY =
  'Write your waiver here in your own words: the activity, the risks a rider takes on, what they agree to, and anything they must tell you before they ride.'

/** Every adult age a waiver may set, youngest first. */
const ADULT_AGES = Array.from(
  { length: WAIVER_ADULT_AGE_RANGE.max - WAIVER_ADULT_AGE_RANGE.min + 1 },
  (_, index) => WAIVER_ADULT_AGE_RANGE.min + index,
)

const blankValidity = (kind: WaiverValidity['kind'], current: WaiverValidity): WaiverValidity => {
  if (kind === current.kind) return current
  if (kind === 'season') return { kind: 'season', endDayKey: dayjs().endOf('year').format('YYYY-MM-DD') }
  if (kind === 'days') return { kind: 'days', days: 365 }
  return { kind: 'visit' }
}

/**
 * Writing a waiver (AGL-4042), in the merchant's own words with the
 * console's rich text editor — no code, no markup — plus the boxes a signer
 * must tick, the age from which a signer is an adult, whether a parent may
 * sign for minors, and how long a signature lasts. Saving a change to any of
 * that starts a new version; signatures already taken keep the version they
 * signed.
 */
export function WaiverEditor(props: WaiverEditorProps) {
  const { hostId, waiverId, canManage } = props
  const { ready, request } = useWaiversFetch()
  const [loaded, setLoaded] = useState<WaiverTemplate | null>(null)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [checkboxes, setCheckboxes] = useState<WaiverCheckbox[]>([])
  const [allowMinors, setAllowMinors] = useState(true)
  const [adultAge, setAdultAge] = useState<number>(WAIVER_DEFAULT_ADULT_AGE)
  const [validity, setValidity] = useState<WaiverValidity>({ kind: 'visit' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const apply = (waiver: WaiverTemplate) => {
    setLoaded(waiver)
    setTitle(waiver.title)
    setBody(waiver.body)
    setCheckboxes(waiver.checkboxes)
    setAllowMinors(waiver.allowMinors)
    setAdultAge(waiverAdultAge(waiver))
    setValidity(waiver.validity)
  }

  useEffect(() => {
    if (!ready) return
    if (!waiverId) {
      setBody(STARTER_BODY)
      setCheckboxes([
        { id: 'read', label: 'I have read this waiver and I understand it.' },
      ])
      return
    }
    let live = true
    void request<{ waiver: WaiverTemplate; versions: VersionRow[] }>(WAIVERS_API_ROUTES.template, {
      query: { hostId, waiverId },
    })
      .then((answer) => {
        if (!live) return
        apply(answer.waiver)
        setVersions(answer.versions)
      })
      .catch((caught: Error) => live && setError(caught.message))
    return () => {
      live = false
    }
  }, [ready, request, hostId, waiverId])

  const draft = { title, body, checkboxes, allowMinors, validity, adultAge }

  const save = async () => {
    const checked = normalizeWaiverDraft(draft)
    if (checked.ok === false) {
      setError(checked.error)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const answer = await request<{ waiver: WaiverTemplate }>(WAIVERS_API_ROUTES.templates, {
        body: { hostId, ...(loaded ? { waiverId: loaded.id } : {}), waiver: checked.draft },
      })
      const bumped = loaded && answer.waiver.version !== loaded.version
      apply(answer.waiver)
      if (bumped || !loaded) {
        setVersions((rows) => [
          { version: answer.waiver.version, title: answer.waiver.title, savedAtMs: answer.waiver.updatedAtMs },
          ...rows.filter((row) => row.version !== answer.waiver.version),
        ])
      }
      setNotice(bumped ? `Saved as version ${answer.waiver.version}.` : 'Saved.')
      props.onSaved(answer.waiver)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The waiver could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (action: 'publish' | 'unpublish' | 'retire') => {
    if (!loaded) return
    setBusy(true)
    setError(null)
    try {
      const answer = await request<{ waiver: WaiverTemplate }>(WAIVERS_API_ROUTES.template, {
        body: { hostId, waiverId: loaded.id, action },
      })
      apply(answer.waiver)
      setNotice(
        action === 'publish'
          ? 'Published: its share link, the site’s Sign waiver element and the window can take signatures now.'
          : action === 'retire'
            ? 'Retired: it takes no new signatures. Signatures already taken are kept.'
            : 'Unpublished: it takes no new signatures until you publish it again.',
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const dirty =
    !loaded ||
    JSON.stringify({
      title: loaded.title,
      body: loaded.body,
      checkboxes: loaded.checkboxes,
      allowMinors: loaded.allowMinors,
      validity: loaded.validity,
      adultAge: waiverAdultAge(loaded),
    }) !== JSON.stringify(draft)
  const blockedReason = 'Writing waivers needs the Manage waivers permission.'

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack spacing={3}>
        <Box>
          <Button onClick={props.onBack}>{'Back to Waivers'}</Button>
        </Box>
        <CardDisplay
          header={loaded ? loaded.title : 'New waiver'}
          subheader={loaded ? `${WAIVER_STATUS_LABELS[loaded.status]} · version ${loaded.version}` : 'Not saved yet'}
          help={pluginDocsHelp('waivers', { anchor: '#write-a-waiver' })}
          HeaderProps={{
            action: (
              <Stack direction="row" spacing={1}>
                {loaded && loaded.status === 'published' ? (
                  <BlockedControl blocked={!canManage} reason={blockedReason}>
                    <Button size="small" disabled={busy} onClick={() => void changeStatus('unpublish')}>
                      {'Unpublish'}
                    </Button>
                  </BlockedControl>
                ) : null}
                {loaded && loaded.status !== 'retired' ? (
                  <BlockedControl blocked={!canManage} reason={blockedReason}>
                    <Button size="small" disabled={busy} onClick={() => void changeStatus('retire')}>
                      {'Retire'}
                    </Button>
                  </BlockedControl>
                ) : null}
                {loaded && loaded.status !== 'published' ? (
                  <BlockedControl blocked={!canManage || dirty} reason={!canManage ? blockedReason : 'Save your changes first.'}>
                    <Button size="small" disabled={busy} onClick={() => void changeStatus('publish')}>
                      {'Publish'}
                    </Button>
                  </BlockedControl>
                ) : null}
                <BlockedControl blocked={!canManage} reason={blockedReason}>
                  <Button size="small" variant="contained" disabled={busy || !dirty} onClick={() => void save()}>
                    {'Save'}
                  </Button>
                </BlockedControl>
              </Stack>
            ),
          }}
          contentGutterX
          contentGutterY
        >
          <Stack spacing={3}>
            <Alert severity="info">
              {`Write your waiver in your own words. ${PLATFORM_BRAND_NAME} doesn’t review what it says, so ask your own lawyer what yours should cover. Saving a change starts a new version; signatures already taken keep the version they signed.`}
            </Alert>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {notice ? <Alert severity="success">{notice}</Alert> : null}
            <TextField
              label="Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              fullWidth
              disabled={!canManage}
              helperText="What signers see at the top, like “Rider release and waiver”."
              slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.title } }}
            />
            <MarkdownField
              label="Waiver text"
              value={body}
              onChange={setBody}
              helperText="Use the toolbar for headings, bold text and lists."
            />
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">{'Boxes every signer must tick'}</Typography>
              {checkboxes.map((box, index) => (
                <Stack key={box.id} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <TextField
                    label={`Checkbox ${index + 1}`}
                    value={box.label}
                    fullWidth
                    disabled={!canManage}
                    onChange={(event) =>
                      setCheckboxes(checkboxes.map((one, at) => (at === index ? { ...one, label: event.target.value } : one)))
                    }
                    slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.checkboxLabel } }}
                  />
                  <Button disabled={!canManage} onClick={() => setCheckboxes(checkboxes.filter((_, at) => at !== index))}>
                    {'Remove'}
                  </Button>
                </Stack>
              ))}
              {checkboxes.length < WAIVER_LIMITS.checkboxes ? (
                <Box>
                  <Button
                    disabled={!canManage}
                    onClick={() =>
                      setCheckboxes([...checkboxes, { id: `box-${Date.now().toString(36)}`, label: '' }])
                    }
                  >
                    {'Add a checkbox'}
                  </Button>
                </Box>
              ) : null}
            </Stack>
            <TextField
              select
              label="Adult age"
              value={adultAge}
              disabled={!canManage}
              onChange={(event) => setAdultAge(Number(event.target.value))}
              helperText={`Signers under ${adultAge} need a parent or guardian to sign for them.`}
              sx={{ maxWidth: (theme) => theme.breakpoints.values.sm }}
            >
              {ADULT_AGES.map((age) => (
                <MenuItem key={age} value={age}>
                  {String(age)}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Switch checked={allowMinors} disabled={!canManage} onChange={(event) => setAllowMinors(event.target.checked)} />
              }
              label={`A parent or guardian may sign for riders under ${adultAge}`}
            />
            <FormControl disabled={!canManage}>
              <FormLabel>{'One signature is good for'}</FormLabel>
              <RadioGroup
                value={validity.kind}
                onChange={(event) => setValidity(blankValidity(event.target.value as WaiverValidity['kind'], validity))}
              >
                <FormControlLabel value="visit" control={<Radio />} label="One visit: the day it is signed" />
                <FormControlLabel value="season" control={<Radio />} label="A season, through a day you choose" />
                <FormControlLabel value="days" control={<Radio />} label="A number of days" />
              </RadioGroup>
            </FormControl>
            {validity.kind === 'season' ? (
              <DatePicker
                label="Last day of the season"
                value={dayjs(validity.endDayKey)}
                disabled={!canManage}
                onChange={(value) =>
                  value?.isValid() && setValidity({ kind: 'season', endDayKey: value.format('YYYY-MM-DD') })
                }
              />
            ) : null}
            {validity.kind === 'days' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                <TextField
                  label="Days, the signing day included"
                  type="number"
                  value={validity.days}
                  disabled={!canManage}
                  onChange={(event) => setValidity({ kind: 'days', days: Math.trunc(Number(event.target.value) || 0) })}
                  slotProps={{ htmlInput: { min: 1, max: WAIVER_LIMITS.days } }}
                />
                {[7, 30, 365].map((days) => (
                  <Chip
                    key={days}
                    label={days === 365 ? 'A year' : `${days} days`}
                    onClick={canManage ? () => setValidity({ kind: 'days', days }) : undefined}
                    variant={validity.days === days ? 'filled' : 'outlined'}
                  />
                ))}
              </Stack>
            ) : null}
          </Stack>
        </CardDisplay>
        {versions.length ? (
          <CardDisplay header="Version history" help={pluginDocsHelp('waivers', { anchor: '#versions' })} contentGutterX contentGutterY>
            <List dense disablePadding>
              {versions.map((row) => (
                <ListItem key={row.version} divider disableGutters>
                  <ListItemText
                    primary={`Version ${row.version}${loaded?.version === row.version ? ' (current)' : ''}`}
                    secondary={`${row.title} · saved ${new Date(row.savedAtMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
                  />
                </ListItem>
              ))}
            </List>
          </CardDisplay>
        ) : null}
      </Stack>
    </LocalizationProvider>
  )
}

export default WaiverEditor
