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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import type { HostTransferPlan } from '@aglyn/aglyn/app-utils/host-transfer'
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'

interface OrgOption {
  id: string
  name: string
  slug: string | null
}

/** The shortest reason the route accepts; it is recorded on the audit row. */
const MIN_REASON = 8
/** An organization id pasted whole, looked up by id rather than by name. */
const LOOKS_LIKE_ID = /^[A-Za-z0-9_-]{15,}$/

const optionsFrom = (payload: any): OrgOption[] =>
  (payload?.orgs ?? []).map((org: any) => ({
    id: String(org.$id),
    name: String(org.name ?? org.$id),
    slug: org.slug ?? null,
  }))

/**
 * Pick an organization by the start of a word of its name, or by its id —
 * both answered by `/api/admin/orgs`, so the search reaches every
 * organization rather than a page already loaded.
 */
function StaffOrgPicker(props: {
  value: OrgOption | null
  onChange: (value: OrgOption | null) => void
  excludeId?: string | null
}) {
  const { value, onChange, excludeId } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [input, setInput] = useState('')
  const [options, setOptions] = useState<OrgOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const typed = input.trim()
    if (!typed) {
      setOptions([])
      return undefined
    }
    let active = true
    const timer = setTimeout(() => {
      setLoading(true)
      const byName = authorizedFetch(
        userRef.current,
        `/api/admin/orgs?pageSize=10&search=${encodeURIComponent(typed)}`,
      ).then((response) => (response.ok ? response.json() : null))
      const byId = LOOKS_LIKE_ID.test(typed)
        ? authorizedFetch(
            userRef.current,
            `/api/admin/orgs?pageSize=1&filters=${encodeURIComponent(
              JSON.stringify([{ field: '$id', op: 'equals', value: typed }]),
            )}`,
          ).then((response) => (response.ok ? response.json() : null))
        : Promise.resolve(null)
      void Promise.all([byId, byName])
        .then(([idPayload, namePayload]) => {
          if (!active) return
          const seen = new Set<string>()
          setOptions(
            [...optionsFrom(idPayload), ...optionsFrom(namePayload)].filter(
              (option) => option.id !== excludeId && !seen.has(option.id) && seen.add(option.id),
            ),
          )
        })
        .catch(() => undefined)
        .finally(() => active && setLoading(false))
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [input, excludeId])

  return (
    <Autocomplete
      size="small"
      value={value}
      onChange={(_event, next) => onChange(next)}
      inputValue={input}
      onInputChange={(_event, next) => setInput(next)}
      options={options}
      loading={loading}
      // The route already matched; the list must not narrow it again.
      filterOptions={(all) => all}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      getOptionLabel={(option) => option.name}
      renderOption={(optionProps, option) => (
        <li {...optionProps} key={option.id}>
          <Stack>
            <Typography variant="body2">{option.name}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {option.slug ?? option.id}
            </Typography>
          </Stack>
        </li>
      )}
      noOptionsText={input.trim() ? 'No organization matches' : 'Type a name or paste an org ID'}
      renderInput={(params) => (
        <TextField {...params} label="Move this site to organization" sx={{ flex: 1 }} />
      )}
      sx={{ flex: 1 }}
    />
  )
}

/**
 * Move a site to another organization (AGL-3381), for super staff.
 *
 * Two steps, because the move is not undoable by a button: Review reads the
 * plan (`GET /api/admin/site-transfer`) — what moves, what stays with the
 * old organization, what refuses — and the dialog shows all of it. The
 * transfer itself re-plans on the server, so the confirmation cannot run a
 * decision the state has since outgrown.
 */
export function StaffSiteTransfer(props: {
  hostId: string
  currentOrgId?: string | null
  onTransferred?: () => void
}) {
  const { hostId, currentOrgId, onTransferred } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [destination, setDestination] = useState<OrgOption | null>(null)
  const [plan, setPlan] = useState<HostTransferPlan | null>(null)
  const [override, setOverride] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const review = async (overrideSiteLimit = override) => {
    if (!destination) return
    setBusy(true)
    try {
      const response = await authorizedFetch(
        user,
        `/api/admin/site-transfer?hostId=${encodeURIComponent(hostId)}&toOrgId=${encodeURIComponent(
          destination.id,
        )}${overrideSiteLimit ? '&overrideSiteLimit=1' : ''}`,
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Could not plan the transfer')
      setPlan(payload.plan)
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'Could not plan the transfer', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const transfer = async () => {
    if (!destination || !plan || plan.holds.length) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/admin/site-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          toOrgId: destination.id,
          overrideSiteLimit: override,
          reason: reason.trim(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 409 && payload?.plan) {
        setPlan(payload.plan)
        throw new Error(payload.error ?? 'The transfer was refused')
      }
      if (!response.ok) throw new Error(payload?.error ?? 'The transfer failed')
      enqueueSnackbar(`The site now belongs to ${destination.name}`, { variant: 'success' })
      setPlan(null)
      setDestination(null)
      setReason('')
      setOverride(false)
      onTransferred?.()
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'The transfer failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const limitHeld = Boolean(plan?.holds.some((hold) => hold.code === 'site-limit'))
  const reasonShort = reason.trim().length < MIN_REASON

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <StaffOrgPicker value={destination} onChange={setDestination} excludeId={currentOrgId} />
        <Button
          size="small"
          color="error"
          disabled={busy || !destination}
          onClick={() => void review()}
          sx={{ mt: 0.5 }}
        >
          {'Review'}
        </Button>
      </Stack>
      <Dialog open={Boolean(plan)} onClose={() => (busy ? undefined : setPlan(null))} maxWidth="sm" fullWidth>
        <DialogTitle>{'Move this site?'}</DialogTitle>
        <DialogContent>
          {plan ? (
            <Stack spacing={2}>
              <Typography variant="body2">
                {`${plan.siteName ?? plan.hostId} moves from ${plan.fromOrgName ?? plan.fromOrgId ?? 'no organization'} ` +
                  `to ${plan.toOrgName ?? plan.toOrgId}. Its pages, forms, members and orders go with it; ` +
                  'its access list becomes the new organization’s roster.'}
              </Typography>
              {plan.holds.map((hold) => (
                <Alert key={hold.code} severity="error">
                  {hold.message}
                </Alert>
              ))}
              {plan.warnings.map((warning) => (
                <Alert key={warning} severity="warning">
                  {warning}
                </Alert>
              ))}
              {limitHeld || override ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={override}
                      onChange={(event) => {
                        setOverride(event.target.checked)
                        void review(event.target.checked)
                      }}
                    />
                  }
                  label="Place it past the destination's site limit"
                />
              ) : null}
              <TextField
                size="small"
                label="Why (recorded on the audit row)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                multiline
                minRows={2}
                disabled={Boolean(plan.holds.length)}
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setPlan(null)}>
            {'Cancel'}
          </Button>
          <Button
            color="error"
            disabled={busy || !plan || Boolean(plan.holds.length) || reasonShort}
            onClick={() => void transfer()}
          >
            {busy ? 'Moving…' : 'Move site'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default StaffSiteTransfer
