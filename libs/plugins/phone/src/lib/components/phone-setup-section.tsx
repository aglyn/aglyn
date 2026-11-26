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
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { formatPhoneForDisplay, missingComplianceFields } from '../model/phone-rules'
import type { PhoneComplianceForm, PhoneNumberKind, PhoneNumberRecord } from '../model/phone.types'
import type { PhoneSectionProps } from './phone-console-page'
import type { PhoneAvailableNumber } from './use-phone-api'

/**
 * Setup (AGL-4251): the business number (choose one, or move an existing one
 * in), its texting registration, and releasing it. Owners and admins only
 * (`phone.manage`); everyone else reads where it stands.
 */
export function PhoneSetupSection(props: PhoneSectionProps) {
  const { status } = props
  const number = status.numbers[0] ?? null
  return (
    <Stack spacing={2}>
      {!status.configured ? (
        <Alert severity="warning">Phone is not connected to the phone company on this server yet.</Alert>
      ) : null}
      {number ? <PhoneNumberCard {...props} number={number} /> : <PhoneChooseNumberCard {...props} />}
      {number ? <PhoneComplianceCard {...props} number={number} /> : null}
      <PhonePortCard {...props} />
    </Stack>
  )
}

function useRun() {
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true)
    try {
      await action()
      if (done) enqueueSnackbar(done, { variant: 'success' })
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function PhoneChooseNumberCard({ api, status, reload, sites }: PhoneSectionProps) {
  const { busy, run } = useRun()
  const [kind, setKind] = useState<PhoneNumberKind>('local')
  const [areaCode, setAreaCode] = useState('')
  const [results, setResults] = useState<PhoneAvailableNumber[] | null>(null)
  const [picked, setPicked] = useState<PhoneAvailableNumber | null>(null)
  const [hostId, setHostId] = useState(sites[0]?.id ?? '')
  const [label, setLabel] = useState('Front desk')

  return (
    <CardDisplay header="Choose your business number" contentGutterX contentGutterY>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Your Phone add-on includes one number. Customers call and text it, and your team answers here. Already have a
          number customers know? Move it in below instead.
        </Typography>
        {!status.canManage ? (
          <Alert severity="info">Only owners and admins can choose the number.</Alert>
        ) : (
          <>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={kind}
              onChange={(_, value) => value && (setKind(value), setResults(null), setPicked(null))}
            >
              <ToggleButton value="local">Local</ToggleButton>
              <ToggleButton value="tollFree">Toll-free</ToggleButton>
            </ToggleButtonGroup>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              {kind === 'local' ? (
                <TextField
                  label="Area code"
                  size="small"
                  value={areaCode}
                  onChange={(event) => setAreaCode(event.target.value.replace(/\D/g, '').slice(0, 3))}
                />
              ) : null}
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setPicked(null)
                    setResults(await api.searchNumbers({ kind, ...(areaCode ? { areaCode } : {}) }))
                  })
                }
              >
                Find numbers
              </Button>
            </Stack>
            {results ? (
              results.length ? (
                <List dense aria-label="Numbers for sale" sx={{ maxHeight: 280, overflowY: 'auto' }}>
                  {results.map((one) => (
                    <ListItemButton key={one.e164} selected={picked?.e164 === one.e164} onClick={() => setPicked(one)}>
                      <ListItemText
                        primary={formatPhoneForDisplay(one.e164)}
                        secondary={[one.locality, one.region].filter(Boolean).join(', ') || undefined}
                      />
                    </ListItemButton>
                  ))}
                </List>
              ) : (
                <Typography variant="body2">No numbers matched. Try another area code.</Typography>
              )
            ) : null}
            {picked ? (
              <Stack spacing={2}>
                <TextField select label="Site it answers for" size="small" value={hostId} onChange={(e) => setHostId(e.target.value)}>
                  {sites.map((site) => (
                    <MenuItem key={site.id} value={site.id}>
                      {site.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField label="Name in the inbox" size="small" value={label} onChange={(e) => setLabel(e.target.value)} />
                <Button
                  variant="contained"
                  disabled={busy || !hostId}
                  onClick={() =>
                    run(async () => {
                      await api.buyNumber({ e164: picked.e164, kind, hostId, label })
                      await reload()
                    }, `${formatPhoneForDisplay(picked.e164)} is your business number.`)
                  }
                >
                  {`Use ${formatPhoneForDisplay(picked.e164)}`}
                </Button>
              </Stack>
            ) : null}
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}

function PhoneNumberCard({ api, status, reload, sites, number }: PhoneSectionProps & { number: PhoneNumberRecord }) {
  const { busy, run } = useRun()
  const [confirming, setConfirming] = useState(false)
  const site = sites.find((one) => one.id === number.hostId)
  return (
    <CardDisplay
      header="Business number"
      HeaderProps={{
        action: status.canManage ? (
          <Button color="error" size="small" onClick={() => setConfirming(true)}>
            Release
          </Button>
        ) : undefined,
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <Typography variant="h6">{formatPhoneForDisplay(number.e164)}</Typography>
        <Stack direction="row" spacing={1}>
          <Chip size="small" label={number.kind === 'tollFree' ? 'Toll-free' : 'Local'} />
          <Chip size="small" label={number.label} variant="outlined" />
          {site ? <Chip size="small" label={site.name} variant="outlined" /> : null}
        </Stack>
      </Stack>
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>Release this number?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`${formatPhoneForDisplay(number.e164)} goes back to the phone company. Calls and texts to it stop reaching you, and you may not be able to get it back. Your conversations stay here.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Keep it</Button>
          <Button
            color="error"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.releaseNumber(number.id)
                setConfirming(false)
                await reload()
              }, 'The number was released.')
            }
          >
            Release
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

const EMPTY_FORM: PhoneComplianceForm = {
  kind: 'a2p10dlc',
  legalBusinessName: '',
  ein: '',
  businessType: 'llc',
  website: '',
  street: '',
  city: '',
  region: '',
  postalCode: '',
  country: 'US',
  contactFirstName: '',
  contactLastName: '',
  contactEmail: '',
  contactPhone: '',
  useCaseDescription: '',
  sampleMessages: ['', ''],
  optInDescription: '',
  monthlyVolume: 1000,
}

const STATUS_WORDS: Record<string, string> = {
  draft: 'Not sent yet',
  submitted: 'Sent to the carriers',
  'in-review': 'Carriers are reviewing it',
  approved: 'Approved: texts deliver',
  rejected: 'Not approved',
}

function PhoneComplianceCard({ api, status, reload, number }: PhoneSectionProps & { number: PhoneNumberRecord }) {
  const { busy, run } = useRun()
  const saved = status.compliance
  const [form, setForm] = useState<PhoneComplianceForm>({
    ...EMPTY_FORM,
    ...(saved?.form ?? {}),
    kind: number.kind === 'tollFree' ? 'tollFree' : 'a2p10dlc',
  })
  const locked = Boolean(saved && ['submitted', 'in-review', 'approved'].includes(saved.status))
  const set = (key: keyof PhoneComplianceForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))
  const missing = missingComplianceFields(form)
  const field = (key: keyof PhoneComplianceForm, label: string, extra: Record<string, unknown> = {}) => (
    <TextField
      size="small"
      label={label}
      value={String(form[key] ?? '')}
      onChange={set(key)}
      disabled={locked || !status.canManage}
      {...extra}
    />
  )
  return (
    <CardDisplay
      header="Texting registration"
      subheader={STATUS_WORDS[saved?.status ?? 'draft']}
      HeaderProps={{
        action: locked && status.canManage ? (
          <Button size="small" disabled={busy} onClick={() => run(async () => {
            await api.refreshCompliance()
            await reload()
          })}>
            Check status
          </Button>
        ) : undefined,
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {number.kind === 'tollFree'
            ? 'US carriers deliver texts from a toll-free number once it is verified. Verification usually takes a few business days.'
            : 'US carriers deliver texts from a local number once your business is registered (A2P 10DLC). Registration usually takes one to two weeks. Sole proprietors without an EIN should use a toll-free number.'}
        </Typography>
        {saved?.status === 'rejected' && saved.rejectionReason ? (
          <Alert severity="error">{saved.rejectionReason}</Alert>
        ) : null}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          {field('legalBusinessName', 'Legal business name', { fullWidth: true })}
          <TextField
            select
            size="small"
            label="Business type"
            value={form.businessType}
            onChange={set('businessType')}
            disabled={locked || !status.canManage}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="llc">LLC</MenuItem>
            <MenuItem value="corporation">Corporation</MenuItem>
            <MenuItem value="partnership">Partnership</MenuItem>
            <MenuItem value="nonprofit">Nonprofit</MenuItem>
            <MenuItem value="sole-proprietor">Sole proprietor</MenuItem>
          </TextField>
          {field('ein', 'EIN')}
        </Stack>
        {field('website', 'Website')}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          {field('street', 'Street address', { fullWidth: true })}
          {field('city', 'City')}
          {field('region', 'State')}
          {field('postalCode', 'ZIP code')}
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          {field('contactFirstName', 'Contact first name')}
          {field('contactLastName', 'Contact last name')}
          {field('contactEmail', 'Contact email')}
          {field('contactPhone', 'Contact phone')}
        </Stack>
        {field('useCaseDescription', 'What your texts are for', {
          multiline: true,
          minRows: 2,
          placeholder: 'Answering customer questions, booking and reservation reminders, waiver links.',
        })}
        {field('optInDescription', 'How customers agree to texts', {
          multiline: true,
          minRows: 2,
          placeholder: 'Customers text our number first, or give us their number at checkout and agree to texts.',
        })}
        {[0, 1].map((index) => (
          <TextField
            key={index}
            size="small"
            label={`Example text ${index + 1}`}
            value={form.sampleMessages[index] ?? ''}
            disabled={locked || !status.canManage}
            onChange={(event) =>
              setForm((current) => {
                const samples = [...current.sampleMessages]
                samples[index] = event.target.value
                return { ...current, sampleMessages: samples }
              })
            }
          />
        ))}
        {!locked && status.canManage ? (
          <Stack sx={{ justifyContent: 'flex-end' }} direction="row" spacing={1}>
            <Button disabled={busy} onClick={() => run(async () => {
              await api.saveCompliance(form, false)
              await reload()
            }, 'Saved.')}>
              Save draft
            </Button>
            <Button
              variant="contained"
              disabled={busy || missing.length > 0}
              onClick={() =>
                run(async () => {
                  await api.saveCompliance(form, true)
                  await reload()
                }, 'Sent to the carriers.')
              }
            >
              Submit registration
            </Button>
          </Stack>
        ) : null}
        {!locked && missing.length ? (
          <Typography variant="caption" color="text.secondary">{`Still needed: ${missing.join(', ')}.`}</Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

function PhonePortCard({ api, status, reload, sites }: PhoneSectionProps) {
  const { busy, run } = useRun()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({
    number: '',
    accountHolderName: '',
    currentCarrier: '',
    accountNumber: '',
    pin: '',
    street: '',
    city: '',
    region: '',
    postalCode: '',
    hostId: sites[0]?.id ?? '',
  })
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))
  return (
    <CardDisplay
      header="Move a number you already have"
      HeaderProps={{
        action: status.canManage ? (
          <Button size="small" onClick={() => setOpen(true)}>
            Move a number
          </Button>
        ) : undefined,
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          Keep the number your customers already call. Moving it from your current carrier usually takes one to three
          weeks, and calls keep reaching you there until the day it moves.
        </Typography>
        {status.ports.map((port) => (
          <Typography key={port.id} variant="body2">
            {`${port.numbers.map(formatPhoneForDisplay).join(', ')}: ${port.status === 'submitted' ? 'requested' : port.status.replace('-', ' ')}`}
          </Typography>
        ))}
      </Stack>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Move a number to Aglyn</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText variant="body2">
              Enter the details exactly as your current carrier’s bill shows them. The transfer PIN is sent to the phone
              company once and is not stored.
            </DialogContentText>
            <TextField size="small" label="Number to move" value={values.number} onChange={set('number')} />
            <TextField size="small" label="Account holder name" value={values.accountHolderName} onChange={set('accountHolderName')} />
            <TextField size="small" label="Current carrier" value={values.currentCarrier} onChange={set('currentCarrier')} />
            <TextField size="small" label="Account number" value={values.accountNumber} onChange={set('accountNumber')} />
            <TextField size="small" label="Transfer PIN" value={values.pin} onChange={set('pin')} />
            <TextField size="small" label="Service street address" value={values.street} onChange={set('street')} />
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="City" value={values.city} onChange={set('city')} />
              <TextField size="small" label="State" value={values.region} onChange={set('region')} />
              <TextField size="small" label="ZIP code" value={values.postalCode} onChange={set('postalCode')} />
            </Stack>
            <TextField select size="small" label="Site it answers for" value={values.hostId} onChange={set('hostId')}>
              {sites.map((site) => (
                <MenuItem key={site.id} value={site.id}>
                  {site.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy || !values.number || !values.accountHolderName || !values.accountNumber || !values.currentCarrier}
            onClick={() =>
              run(async () => {
                await api.requestPort({
                  numbers: [values.number],
                  accountHolderName: values.accountHolderName,
                  currentCarrier: values.currentCarrier,
                  accountNumber: values.accountNumber,
                  pin: values.pin,
                  hostId: values.hostId,
                  serviceAddress: {
                    street: values.street,
                    city: values.city,
                    region: values.region,
                    postalCode: values.postalCode,
                    country: 'US',
                  },
                })
                setOpen(false)
                await reload()
              }, 'Move requested. The phone company emails you as it goes.')
            }
          >
            Request the move
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

export default PhoneSetupSection
