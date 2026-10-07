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

import * as CommerceModel from '../../model'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useFirestoreCollection, useUser } from '@aglyn/tenant-feature-instance'

/**
 * The Hardware card for one register (AGL-3619): the cloud receipt printers
 * paired with it, with their live status and recent jobs, and the way to add
 * one — brand, model, MAC or ID — and get the URL to paste into the printer.
 *
 * Every write goes through `/api/commerce/printers`: the printer documents
 * and the queue are server-written, so this card only reads Firestore.
 */

type PrinterRow = CommerceModel.PosPrinter & { $id: string }
type JobRow = CommerceModel.PrintJob & { $id: string }

const STATE_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  online: 'success',
  paper_low: 'warning',
  paper_out: 'error',
  cover_open: 'error',
  error: 'error',
  offline: 'default',
  unknown: 'default',
}

const JOB_LABELS: Record<CommerceModel.PrintJobKind, string> = {
  receipt: 'Receipt',
  drawer: 'Open drawer',
  test: 'Test print',
}

/** "just now", "3 min ago", "2 h ago". */
export function seenAgo(atMs: number | undefined, nowMs: number): string {
  if (!atMs) return 'never'
  const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function usePrintersApi(hostId: string) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  return useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, any> | null> => {
      try {
        const response = await authorizedFetch(user, '/api/commerce/printers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, ...body }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? 'The printer could not be updated', {
            variant: 'warning',
            persist: false,
          })
          return null
        }
        return payload
      } catch {
        enqueueSnackbar('The printer could not be reached. Check your connection.', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
    },
    [user, hostId, enqueueSnackbar],
  )
}

/** Where each brand's poll URL goes, step by step. */
export function printerSetupSteps(brand: CommerceModel.PrinterBrand): string[] {
  return brand === 'star'
    ? [
        'Open the printer’s web page: print a self-test (hold FEED while switching on) to find its IP address, then browse to it and sign in (default user root, password public, or the password on the printer’s label).',
        'Go to Settings → CloudPRNT. Turn CloudPRNT on and paste the URL below as the Server URL.',
        'Set the polling interval to 5 seconds, then Submit and Save → Restart device.',
        'Come back here: the printer shows Online within a minute. Send a test print.',
      ]
    : [
        'Open EPSON TMNet WebConfig: browse to the printer’s IP address (print a status sheet by holding FEED while switching on).',
        'Open Server Direct Print (under Web Service Settings on most models). Select Enable and enter the ID below.',
        'Paste the URL below as Server 1 URL and set the interval to 5 seconds. Submit, then reset the printer.',
        'Come back here: the printer shows Online within a minute. Send a test print.',
      ]
}

interface PrinterFormState {
  brand: CommerceModel.PrinterBrand
  name: string
  model: string
  deviceId: string
  paperWidthMm: CommerceModel.PrinterPaperWidth
  autoPrintReceipts: boolean
  kickDrawer: boolean
  logoKey: string
}

const EMPTY_FORM: PrinterFormState = {
  brand: 'star',
  name: '',
  model: '',
  deviceId: '',
  paperWidthMm: 80,
  autoPrintReceipts: true,
  kickDrawer: true,
  logoKey: '',
}

function PrinterForm(props: {
  value: PrinterFormState
  onChange: (next: PrinterFormState) => void
  brandLocked?: boolean
}) {
  const { value, onChange, brandLocked } = props
  const set = <K extends keyof PrinterFormState>(key: K, next: PrinterFormState[K]) =>
    onChange({ ...value, [key]: next })
  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <TextField
        select
        label="Brand"
        value={value.brand}
        disabled={brandLocked}
        onChange={(event) => set('brand', event.target.value as CommerceModel.PrinterBrand)}
      >
        {CommerceModel.PRINTER_BRANDS.map((brand) => (
          <MenuItem key={brand} value={brand}>
            {CommerceModel.PRINTER_BRAND_LABELS[brand]}
          </MenuItem>
        ))}
      </TextField>
      <Autocomplete
        freeSolo
        options={[...CommerceModel.PRINTER_MODEL_SUGGESTIONS[value.brand]]}
        value={value.model}
        onInputChange={(_event, next) => set('model', next)}
        renderInput={(params) => <TextField {...params} label="Model" />}
      />
      <TextField label="Name" value={value.name} placeholder="Counter printer" onChange={(event) => set('name', event.target.value)} />
      <TextField
        label={value.brand === 'star' ? 'MAC address' : 'Server Direct Print ID'}
        value={value.deviceId}
        placeholder={value.brand === 'star' ? '00:11:62:12:34:56' : 'counter-1'}
        helperText={
          value.brand === 'star'
            ? 'The Ethernet MAC on the self-test print, even if the printer uses Wi-Fi.'
            : 'Any ID you choose (letters, digits, - _ .), entered again in WebConfig.'
        }
        onChange={(event) => set('deviceId', event.target.value)}
      />
      <TextField
        select
        label="Paper"
        value={value.paperWidthMm}
        onChange={(event) => set('paperWidthMm', Number(event.target.value) === 58 ? 58 : 80)}
      >
        <MenuItem value={80}>{'80 mm (3 1/8 in)'}</MenuItem>
        <MenuItem value={58}>{'58 mm (2 1/4 in)'}</MenuItem>
      </TextField>
      <TextField
        label="Stored logo (optional)"
        value={value.logoKey}
        placeholder={value.brand === 'star' ? '1' : '48,48'}
        helperText={
          value.brand === 'star'
            ? 'The logo number saved in the printer with Star Quick Setup Utility.'
            : 'The key saved in the printer with Epson TM Utility, as two numbers.'
        }
        onChange={(event) => set('logoKey', event.target.value)}
      />
      <FormControlLabel
        control={
          <Switch checked={value.autoPrintReceipts} onChange={(event) => set('autoPrintReceipts', event.target.checked)} />
        }
        label="Print a receipt for every sale on this register"
      />
      <FormControlLabel
        control={<Switch checked={value.kickDrawer} onChange={(event) => set('kickDrawer', event.target.checked)} />}
        label="A cash drawer is plugged into this printer"
      />
    </Stack>
  )
}

function PollUrlPanel(props: { credentials: { brand: CommerceModel.PrinterBrand; pollUrl: string; deviceId: string } }) {
  const { credentials } = props
  const { enqueueSnackbar } = useSnackbar()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(credentials.pollUrl)
      enqueueSnackbar('Copied', { variant: 'success', persist: false })
    } catch {
      enqueueSnackbar('Select the URL and copy it', { variant: 'info', persist: false })
    }
  }
  return (
    <Stack spacing={1.5}>
      <Alert severity="info">
        {'This URL is the printer’s password: anyone with it can collect this register’s receipts. ' +
          'Regenerate it if it is ever shared.'}
      </Alert>
      <TextField
        label={credentials.brand === 'star' ? 'CloudPRNT Server URL' : 'Server Direct Print URL'}
        value={credentials.pollUrl}
        multiline
        slotProps={{ htmlInput: { readOnly: true } }}
      />
      {credentials.brand === 'epson' ? (
        <TextField label="ID" value={credentials.deviceId} slotProps={{ htmlInput: { readOnly: true } }} />
      ) : null}
      <Box>
        <Button size="small" onClick={copy}>
          {'Copy URL'}
        </Button>
      </Box>
      <Box component="ol" sx={{ pl: 2.5, m: 0 }}>
        {printerSetupSteps(credentials.brand).map((step) => (
          <Typography component="li" variant="body2" key={step} sx={{ mb: 0.5 }}>
            {step}
          </Typography>
        ))}
      </Box>
    </Stack>
  )
}

function PrinterRowView(props: {
  printer: PrinterRow
  now: number
  call: ReturnType<typeof usePrintersApi>
  onSettings: (printer: PrinterRow) => void
}) {
  const { printer, now, call, onSettings } = props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const state = CommerceModel.printerDisplayState(printer.status, now)
  const label = state === 'offline' ? 'Offline' : CommerceModel.PRINTER_STATE_LABELS[state]
  const send = async (action: 'test' | 'drawer') => {
    const result = await call({ action, printerId: printer.$id })
    if (result) {
      enqueueSnackbar(action === 'test' ? 'Test print sent' : 'Drawer kick sent', {
        variant: 'success',
        persist: false,
      })
    }
  }
  const remove = async () => {
    const confirmed = await confirm({
      title: `Remove ${printer.name}?`,
      description: 'Its URL stops working and anything it has not printed is canceled.',
      confirmationText: 'Remove',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (confirmed) await call({ action: 'remove', printerId: printer.$id })
  }
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="body2" sx={{ flex: '1 1 160px', minWidth: 0 }} noWrap>
          {printer.name}
          <Typography component="span" variant="caption" color="text.secondary">
            {` · ${printer.brand === 'star' ? 'Star' : 'Epson'}${printer.model ? ` ${printer.model}` : ''}`}
          </Typography>
        </Typography>
        <Chip size="small" variant="outlined" color={STATE_COLOR[state]} label={label} />
        <Button size="small" onClick={() => send('test')}>
          {'Test print'}
        </Button>
        {printer.kickDrawer ? (
          <Button size="small" onClick={() => send('drawer')}>
            {'Open drawer'}
          </Button>
        ) : null}
        <Button size="small" onClick={() => onSettings(printer)}>
          {'Settings'}
        </Button>
        <Button size="small" color="error" onClick={remove}>
          {'Remove'}
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {printer.status?.atMs
          ? `Last seen ${seenAgo(printer.status.atMs, now)}${printer.status.detail ? ` · ${printer.status.detail}` : ''}`
          : 'Waiting for the printer to poll — paste its URL into the printer to finish.'}
        {printer.autoPrintReceipts ? ' · Prints every sale' : ''}
        {printer.kickDrawer ? ' · Cash drawer' : ''}
      </Typography>
    </Stack>
  )
}

export interface RegisterHardwareCardProps {
  hostId: string
  registerId: string
  registerName: string
}

export function RegisterHardwareCard(props: RegisterHardwareCardProps) {
  const { hostId, registerId, registerName } = props
  const firestore = useFirestore()
  const call = usePrintersApi(hostId)
  const now = useNow(15_000)
  const { data: printerDocs } = useFirestoreCollection<PrinterRow>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'printers'),
        where('registerId', '==', registerId),
        limit(4),
      ),
    [firestore, hostId, registerId],
    { idField: '$id' },
  )
  const { data: jobDocs } = useFirestoreCollection<JobRow>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'printJobs'),
        where('registerId', '==', registerId),
        orderBy('createdAtMs', 'desc'),
        limit(6),
      ),
    [firestore, hostId, registerId],
    { idField: '$id' },
  )
  const printers = [...(printerDocs ?? [])].sort((a, b) => a.createdAtMs - b.createdAtMs)
  const jobs = jobDocs ?? []

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<PrinterFormState>(EMPTY_FORM)
  const [editing, setEditing] = useState<PrinterRow | null>(null)
  const [credentials, setCredentials] = useState<{
    brand: CommerceModel.PrinterBrand
    pollUrl: string
    deviceId: string
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setCredentials(null)
    setAdding(true)
  }
  const create = async () => {
    setBusy(true)
    const created = await call({ action: 'create', registerId, ...form })
    setBusy(false)
    if (created) setCredentials(created as any)
  }
  const openSettings = async (printer: PrinterRow) => {
    setEditing(printer)
    setForm({
      brand: printer.brand,
      name: printer.name,
      model: printer.model ?? '',
      deviceId: printer.deviceId,
      paperWidthMm: printer.paperWidthMm ?? 80,
      autoPrintReceipts: printer.autoPrintReceipts,
      kickDrawer: printer.kickDrawer,
      logoKey: printer.logoKey ?? '',
    })
    setCredentials(null)
    const shown = await call({ action: 'credentials', printerId: printer.$id })
    if (shown) setCredentials(shown as any)
  }
  const save = async () => {
    if (!editing) return
    setBusy(true)
    const { brand: _brand, ...settings } = form
    const saved = await call({ action: 'update', printerId: editing.$id, ...settings })
    setBusy(false)
    if (saved) setEditing(null)
  }
  const regenerate = async () => {
    if (!editing) return
    const next = await call({ action: 'regenerate', printerId: editing.$id })
    if (next) setCredentials(next as any)
  }
  const cancelJob = (job: JobRow) => () => void call({ action: 'cancel', jobId: job.$id })
  const printerName = (id: string) => printers.find((printer) => printer.$id === id)?.name ?? 'Removed printer'

  return (
    <CardDisplay
      header={`Hardware · ${registerName}`}
      help={pluginDocsHelp('posHardware', { anchor: '#receipt-printers' })}
      HeaderProps={{
        action: (
          <Button size="small" onClick={openAdd} disabled={printers.length >= 4}>
            {'Add printer'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">{'Receipt printers'}</Typography>
        {printers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Pair a Star CloudPRNT or Epson Server Direct Print printer to print receipts from this register ' +
              'on any device, with no driver, and to open its cash drawer on cash sales.'}
          </Typography>
        ) : (
          printers.map((printer) => (
            <PrinterRowView key={printer.$id} printer={printer} now={now} call={call} onSettings={openSettings} />
          ))
        )}
        {jobs.length ? (
          <>
            <Divider />
            <Typography variant="subtitle2">{'Recent print jobs'}</Typography>
            {jobs.map((job) => (
              <Stack key={job.$id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {JOB_LABELS[job.kind]}
                  {job.receipt?.orderNumber ? ` #${job.receipt.orderNumber}` : ''}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {` · ${printerName(job.printerId)} · ${seenAgo(job.createdAtMs, now)}`}
                    {job.error ? ` · ${job.error}` : ''}
                  </Typography>
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  color={job.status === 'done' ? 'success' : job.status === 'failed' ? 'error' : 'default'}
                  label={CommerceModel.PRINT_JOB_STATUS_LABELS[job.status]}
                />
                {job.status === 'queued' ? (
                  <Button size="small" onClick={cancelJob(job)}>
                    {'Cancel'}
                  </Button>
                ) : null}
              </Stack>
            ))}
          </>
        ) : null}
      </Stack>

      <Dialog open={adding} onClose={() => setAdding(false)} fullWidth maxWidth="sm">
        <DialogTitle>{credentials ? 'Connect the printer' : `Add a printer to ${registerName}`}</DialogTitle>
        <DialogContent>
          {credentials ? <PollUrlPanel credentials={credentials} /> : <PrinterForm value={form} onChange={setForm} />}
        </DialogContent>
        <DialogActions>
          {credentials ? (
            <Button onClick={() => setAdding(false)}>{'Done'}</Button>
          ) : (
            <>
              <Button onClick={() => setAdding(false)}>{'Cancel'}</Button>
              <Button onClick={create} disabled={busy || !form.name.trim() || !form.deviceId.trim()}>
                {'Add printer'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing?.name ?? 'Printer'}</DialogTitle>
        <DialogContent>
          <PrinterForm value={form} onChange={setForm} brandLocked />
          <Divider sx={{ my: 2 }} />
          {credentials ? <PollUrlPanel credentials={credentials} /> : null}
        </DialogContent>
        <DialogActions>
          <Button color="warning" onClick={regenerate}>
            {'Regenerate URL'}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setEditing(null)}>{'Cancel'}</Button>
          <Button onClick={save} disabled={busy || !form.name.trim()}>
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
RegisterHardwareCard.displayName = 'RegisterHardwareCard'

/** One Hardware card per register on the site. */
export function RegisterHardwareCards(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: registerDocs } = useFirestoreCollection<{ $id: string; name?: string }>(
    () => query(collection(firestore, 'hosts', hostId, 'registers'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const registers = [...(registerDocs ?? [])].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
  if (!registers.length) return null
  return (
    <Stack spacing={3}>
      {registers.map((register) => (
        <RegisterHardwareCard
          key={register.$id}
          hostId={hostId}
          registerId={register.$id}
          registerName={register.name || 'Register'}
        />
      ))}
    </Stack>
  )
}

export default RegisterHardwareCards
