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

import MarkdownLiteView from '@aglyn/aglyn-markdown-editor/markdown-lite-view.component'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import type { Dayjs } from 'dayjs'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { WAIVER_LIMITS } from '../model/waiver'
import type { WaiverMinor, WaiverStrokes } from '../model/waiver-signature'
import { SignaturePad } from './signature-pad.component'
import { newWaiverAttemptKey } from './waivers-api'

/** The scan code for a copy at the window or the display: loaded only when one finishes. */
const SignedCopyCode = lazy(() => import('./signed-copy-code.component'))

/*==========================================
 * THE SIGNING FORM (AGL-4042), one component for every place a waiver is
 * signed: the share link's page, the site's Sign waiver element, and the
 * tablet staff hand over at the window. Mobile first: one column, large
 * targets, the waiver's words in a scrolling panel above what the signer
 * fills in. The server checks everything again; this says what to fix
 * before the press.
 *=========================================*/

/** What the form is given to sign. */
export interface SignableWaiver {
  id: string
  version: number
  title: string
  body: string
  checkboxes: ReadonlyArray<{ id: string; label: string }>
  allowMinors: boolean
  validityText: string
}

/** What a signing answers: who it covers, for how long, and the signer's own copy. */
export interface SigningResult {
  people: string[]
  window: string
  emailed: boolean
  /** A one-hour link to the signed copy as a PDF (AGL-4042), when the signing made one. */
  copyUrl?: string | null
}

export interface SigningFormProps {
  siteName: string
  /** How a signer reaches the business: its contact email or phone (AGL-4042), when the site lists one. */
  siteContact?: string | null
  waiver: SignableWaiver
  consentText: string
  /** The heading over the consent, shown before the signature. */
  consentHeading?: string
  adultAge: number
  /** `online` asks for an email (the signed copy goes there); `at_window` only suggests it. */
  mode: 'online' | 'at_window'
  /** Sends the payload; answers what to show when it lands, or throws the sentence to show. */
  submit: (payload: Record<string, unknown>) => Promise<SigningResult>
  /** Drawn under the confirmation, e.g. "Next signer". */
  doneActions?: (reset: () => void) => ReactNode
  /** What staff already know of the signer, filled in for them to check. */
  initial?: { name?: string | null; email?: string | null }
}

const RELATIONSHIPS = ['Parent', 'Legal guardian', 'Grandparent', 'Step-parent', 'Aunt or uncle']
const DAY = 'YYYY-MM-DD'

const dayOf = (value: Dayjs | null): string => (value?.isValid() ? value.format(DAY) : '')

interface MinorDraft {
  name: string
  dateOfBirth: Dayjs | null
}

function DateField(props: { label: string; value: Dayjs | null; onChange: (value: Dayjs | null) => void; required?: boolean }) {
  return (
    <DatePicker
      label={props.label}
      value={props.value}
      onChange={props.onChange}
      disableFuture
      openTo="year"
      views={['year', 'month', 'day']}
      slotProps={{ textField: { fullWidth: true, required: props.required } }}
    />
  )
}

/**
 * The signer's own copy (AGL-4042): a download on their own device, and a
 * code to scan with their phone on the window's tablet or the register's
 * display, which is not theirs to keep a file on. The link works for an hour.
 */
function SignedCopy(props: { href: string; mode: 'online' | 'at_window' }) {
  if (props.mode === 'online') {
    return (
      <Box>
        <Button variant="outlined" href={props.href} download>
          {'Download your signed copy (PDF)'}
        </Button>
      </Box>
    )
  }
  return (
    <Suspense fallback={null}>
      <SignedCopyCode href={props.href} />
    </Suspense>
  )
}

export function SigningForm(props: SigningFormProps) {
  const { waiver, mode } = props
  const [attemptKey, setAttemptKey] = useState(newWaiverAttemptKey)
  const [name, setName] = useState(props.initial?.name ?? '')
  const [email, setEmail] = useState(props.initial?.email ?? '')
  const [phone, setPhone] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState<Dayjs | null>(null)
  const [forMinors, setForMinors] = useState(false)
  const [minors, setMinors] = useState<MinorDraft[]>([{ name: '', dateOfBirth: null }])
  const [relationship, setRelationship] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [method, setMethod] = useState<'drawn' | 'typed'>('drawn')
  const [drawn, setDrawn] = useState<{ strokes: WaiverStrokes; png: string } | null>(null)
  const [typed, setTyped] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<SigningResult | null>(null)

  const reset = () => {
    setAttemptKey(newWaiverAttemptKey())
    setName('')
    setEmail('')
    setPhone('')
    setDateOfBirth(null)
    setForMinors(false)
    setMinors([{ name: '', dateOfBirth: null }])
    setRelationship('')
    setChecked({})
    setMethod('drawn')
    setDrawn(null)
    setTyped('')
    setConsent(false)
    setError(null)
    setDone(null)
  }

  const missing = useMemo(() => {
    if (!name.trim()) return 'Enter your full name.'
    if (mode === 'online' && !email.trim()) return 'Enter your email address, so we can send you a signed copy.'
    if (!dateOfBirth?.isValid()) return 'Enter your date of birth.'
    if (forMinors) {
      if (minors.some((minor) => !minor.name.trim() || !minor.dateOfBirth?.isValid())) {
        return 'Enter each minor’s full name and date of birth.'
      }
      if (!relationship.trim()) return 'Say how you are related to the minors you are signing for.'
    }
    const box = waiver.checkboxes.find((one) => !checked[one.id])
    if (box) return `Tick “${box.label}” to sign.`
    if (method === 'drawn' && !drawn) return 'Sign in the box, or type your name instead.'
    if (method === 'typed' && !typed.trim()) return 'Type your name to sign.'
    if (!consent) return 'Agree to sign electronically, or ask for a paper waiver.'
    return null
  }, [name, email, mode, dateOfBirth, forMinors, minors, relationship, waiver.checkboxes, checked, method, drawn, typed, consent])

  const send = async () => {
    if (missing) {
      setError(missing)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const minorsPayload: WaiverMinor[] = forMinors
        ? minors.map((minor) => ({ name: minor.name.trim(), dateOfBirth: dayOf(minor.dateOfBirth) }))
        : []
      const answer = await props.submit({
        attemptKey,
        waiverId: waiver.id,
        version: waiver.version,
        signer: { name: name.trim(), email: email.trim(), phone: phone.trim(), dateOfBirth: dayOf(dateOfBirth) },
        minors: minorsPayload,
        guardianRelationship: forMinors ? relationship.trim() : '',
        checked: waiver.checkboxes.filter((box) => checked[box.id]).map((box) => box.id),
        signature: method === 'drawn' ? { kind: 'drawn', strokes: drawn?.strokes ?? [] } : { kind: 'typed', text: typed.trim() },
        ...(method === 'drawn' && drawn ? { signatureImage: drawn.png } : {}),
        consent,
        website,
      })
      setDone(answer)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Stack spacing={2} sx={{ py: 2 }}>
        <Alert severity="success">
          <Typography variant="subtitle1" component="p">
            {'Signed. Thank you!'}
          </Typography>
          <Typography variant="body2">
            {`${waiver.title} is signed for ${done.people.join(', ')}. ${done.window}.`}
          </Typography>
          {done.emailed ? (
            <Typography variant="body2">{'A signed copy is on its way to your email.'}</Typography>
          ) : null}
        </Alert>
        {done.copyUrl ? <SignedCopy href={done.copyUrl} mode={mode} /> : null}
        {props.doneActions?.(reset)}
      </Stack>
    )
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack spacing={3} component="form" noValidate onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}>
        <Stack spacing={0.5}>
          <Typography variant="overline" color="text.secondary">
            {props.siteName}
          </Typography>
          <Typography variant="h4" component="h1">
            {waiver.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {waiver.validityText}
          </Typography>
          {props.siteContact ? (
            <Typography variant="body2" color="text.secondary">
              {`Questions about this waiver? Contact ${props.siteName} at ${props.siteContact}.`}
            </Typography>
          ) : null}
        </Stack>

        <Paper variant="outlined" sx={{ p: 2, maxHeight: { xs: '50vh', md: '60vh' }, overflowY: 'auto' }}>
          <MarkdownLiteView source={waiver.body} />
        </Paper>

        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            {forMinors ? 'Parent or guardian' : 'About you'}
          </Typography>
          <TextField
            label="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            fullWidth
            autoComplete="name"
            slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.name } }}
          />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required={mode === 'online'}
            fullWidth
            autoComplete="email"
            helperText={mode === 'online' ? 'Your signed copy is sent here.' : 'Optional: a signed copy is sent here.'}
            slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.email } }}
          />
          <TextField
            label="Phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            fullWidth
            autoComplete="tel"
            slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.phone } }}
          />
          <DateField label="Date of birth" value={dateOfBirth} onChange={setDateOfBirth} required />
        </Stack>

        {waiver.allowMinors ? (
          <Stack spacing={2}>
            <FormControlLabel
              control={<Switch checked={forMinors} onChange={(event) => setForMinors(event.target.checked)} />}
              label={`I’m also signing for riders under ${props.adultAge}`}
            />
            {forMinors ? (
              <Stack spacing={2}>
                {minors.map((minor, index) => (
                  <Paper key={index} variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={2}>
                      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle2">{`Minor ${index + 1}`}</Typography>
                        {minors.length > 1 ? (
                          <Button size="small" onClick={() => setMinors(minors.filter((_, at) => at !== index))}>
                            {'Remove'}
                          </Button>
                        ) : null}
                      </Stack>
                      <TextField
                        label="Minor’s full name"
                        value={minor.name}
                        required
                        fullWidth
                        onChange={(event) =>
                          setMinors(minors.map((one, at) => (at === index ? { ...one, name: event.target.value } : one)))
                        }
                        slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.name } }}
                      />
                      <DateField
                        label="Minor’s date of birth"
                        value={minor.dateOfBirth}
                        required
                        onChange={(value) =>
                          setMinors(minors.map((one, at) => (at === index ? { ...one, dateOfBirth: value } : one)))
                        }
                      />
                    </Stack>
                  </Paper>
                ))}
                {minors.length < WAIVER_LIMITS.minors ? (
                  <Box>
                    <Button onClick={() => setMinors([...minors, { name: '', dateOfBirth: null }])}>
                      {'Add another minor'}
                    </Button>
                  </Box>
                ) : null}
                <Autocomplete
                  freeSolo
                  options={RELATIONSHIPS}
                  inputValue={relationship}
                  onInputChange={(_event, value) => setRelationship(value.slice(0, WAIVER_LIMITS.relationship))}
                  renderInput={(params) => (
                    <TextField {...params} label="Your relationship to them" required fullWidth />
                  )}
                />
              </Stack>
            ) : null}
          </Stack>
        ) : null}

        {waiver.checkboxes.length ? (
          <Stack spacing={1}>
            {waiver.checkboxes.map((box) => (
              <FormControlLabel
                key={box.id}
                sx={{ alignItems: 'flex-start' }}
                control={
                  <Checkbox
                    checked={Boolean(checked[box.id])}
                    onChange={(event) => setChecked({ ...checked, [box.id]: event.target.checked })}
                  />
                }
                label={<Typography variant="body2" sx={{ pt: 1.25 }}>{box.label}</Typography>}
              />
            ))}
          </Stack>
        ) : null}

        <Divider />

        {/* The consent comes BEFORE the signature (e-sign consent v2,
            AGL-4042), so the disclosure plainly precedes the act of signing. */}
        <Stack spacing={1}>
          <Typography variant="h6" component="h2">
            {props.consentHeading || 'Signing electronically'}
          </Typography>
          <FormControlLabel
            sx={{ alignItems: 'flex-start' }}
            control={<Checkbox checked={consent} onChange={(event) => setConsent(event.target.checked)} />}
            label={<Typography variant="body2" sx={{ pt: 1.25 }}>{props.consentText}</Typography>}
          />
        </Stack>

        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            {'Signature'}
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={method}
            onChange={(_event, value) => value && setMethod(value)}
            size="small"
            aria-label="How to sign"
          >
            <ToggleButton value="drawn">{'Draw'}</ToggleButton>
            <ToggleButton value="typed">{'Type'}</ToggleButton>
          </ToggleButtonGroup>
          {method === 'drawn' ? (
            <SignaturePad onChange={setDrawn} disabled={busy} />
          ) : (
            <Stack spacing={1}>
              <TextField
                label="Type your full name"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                fullWidth
                slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.name } }}
              />
              {typed.trim() ? (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h4" component="p" sx={{ fontStyle: 'italic' }}>
                    {typed}
                  </Typography>
                </Paper>
              ) : null}
            </Stack>
          )}
        </Stack>

        {/* Left empty by people; a bot that fills every field fills this one. */}
        <Box sx={visuallyHidden} aria-hidden>
          <label>
            {'Website'}
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
          </label>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}
        <Button type="submit" variant="contained" size="large" disabled={busy} fullWidth>
          {busy ? 'Signing…' : 'Sign waiver'}
        </Button>
      </Stack>
    </LocalizationProvider>
  )
}

export default SigningForm
