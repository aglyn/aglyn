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

import { generateSubdomain, SUBDOMAIN_PATTERN } from '@aglyn/aglyn'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Chip,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** How long typing must pause before the address is checked. */
export const SITE_ADDRESS_CHECK_DELAY_MS = 400

/** What the availability check last said about the typed address. */
type Availability =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'taken'; message: string; suggestions: string[] }

export interface SiteAddress {
  /** The name as typed, trimmed. */
  name: string
  subdomain: string
  /** A name, an address of the right shape, and none known to be taken. */
  usable: boolean
  /** Something has been typed. */
  dirty: boolean
  /** Whether the name and address can be used, showing why not when they cannot. */
  check: () => boolean
  /** The server refused the address: say so, with what it offered instead. */
  refuse: (message: string, suggestions?: readonly string[]) => void
  /** The fields, side by side where the screen is wide enough. */
  fields: ReactNode
  /** The same fields, one above the other, for a narrow surface. */
  stackedFields: ReactNode
}

/**
 * A new site's name and address (AGL-3761), shared by every way a site is
 * created: the plain dialog, and the start a plugin draws before the site
 * exists.
 *
 * The address follows the name until it is edited by hand (AGL-147), and is
 * checked as it is typed against `POST /api/hosts/validate-name` — the same
 * shape, reserved-name and uniqueness rules the create applies — so a taken
 * address is said, with available ones to pick, before anything is created.
 * The check is advisory: an outage says nothing, and the create re-checks
 * everything in its own transaction.
 */
export function useSiteAddress(options: { autoFocus?: boolean } = {}): SiteAddress {
  const { autoFocus = false } = options
  const { data: user } = useUser()
  // Held in a ref so a request reads who is signed in, never the identity of
  // the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const [name, setName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  // Once the address is edited by hand, it stops following the name.
  const [subdomainTouched, setSubdomainTouched] = useState(false)
  const [availability, setAvailability] = useState<Availability>({ status: 'idle' })
  // Errors are shown once the person tried to go on, or typed into the field.
  const [showErrors, setShowErrors] = useState(false)
  const validShape = SUBDOMAIN_PATTERN.test(subdomain)
  const trimmed = name.trim()

  useEffect(() => {
    if (!validShape) return void setAvailability({ status: 'idle' })
    let active = true
    setAvailability({ status: 'checking' })
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await authorizedFetch(userRef.current, '/api/hosts/validate-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subdomain }),
          })
          const payload = response.ok ? await response.json().catch(() => null) : null
          if (!active) return
          if (!payload) return void setAvailability({ status: 'idle' })
          if (payload.subdomainTaken === true || payload.subdomainBlocked === true) {
            setAvailability({
              status: 'taken',
              message:
                payload.subdomainTaken === true
                  ? 'That address is taken'
                  : 'That address is not available',
              suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
            })
            return
          }
          setAvailability({ status: 'available' })
        } catch {
          if (active) setAvailability({ status: 'idle' })
        }
      })()
    }, SITE_ADDRESS_CHECK_DELAY_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [subdomain, validShape])

  const taken = availability.status === 'taken'
  const usable = Boolean(trimmed) && validShape && !taken

  const check = useCallback(() => {
    setShowErrors(true)
    return usable
  }, [usable])

  const refuse = useCallback((message: string, suggestions: readonly string[] = []) => {
    setShowErrors(true)
    setAvailability({ status: 'taken', message, suggestions: [...suggestions] })
  }, [])

  const nameError = showErrors && !trimmed
  const shapeError = Boolean(subdomain) && !validShape
  const addressError = shapeError || taken || (showErrors && !subdomain)
  const addressHelp = shapeError
    ? '3–30 chars: lowercase letters, digits, dashes'
    : taken
      ? availability.message
      : showErrors && !subdomain
        ? 'Choose an address for your site'
        : availability.status === 'checking'
          ? 'Checking the address…'
          : availability.status === 'available'
            ? `${subdomain}.${TENANT_APEX} is available`
            : ' '

  const render = useCallback(
    (stacked: boolean) => (
      <Stack spacing={1}>
        <Stack direction={stacked ? 'column' : { xs: 'column', sm: 'row' }} spacing={stacked ? 0 : 2}>
          <TextField
            fullWidth
            label="Site name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (!subdomainTouched) setSubdomain(generateSubdomain(event.target.value))
            }}
            error={nameError}
            helperText={nameError ? 'Name your site' : ' '}
            size="small"
            autoFocus={autoFocus}
          />
          <TextField
            fullWidth
            label="Subdomain"
            value={subdomain}
            onChange={(event) => {
              setSubdomainTouched(true)
              setSubdomain(event.target.value.toLowerCase())
            }}
            error={addressError}
            helperText={addressHelp}
            slotProps={{
              input: {
                endAdornment: <InputAdornment position="end">{`.${TENANT_APEX}`}</InputAdornment>,
              },
            }}
            size="small"
          />
        </Stack>
        {availability.status === 'taken' && availability.suggestions.length ? (
          <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {'Available:'}
            </Typography>
            {availability.suggestions.map((candidate) => (
              <Chip
                key={candidate}
                size="small"
                label={candidate}
                onClick={() => {
                  setSubdomainTouched(true)
                  setSubdomain(candidate)
                }}
              />
            ))}
          </Stack>
        ) : null}
      </Stack>
    ),
    [name, subdomain, subdomainTouched, nameError, addressError, addressHelp, availability, autoFocus],
  )
  const fields = useMemo(() => render(false), [render])
  const stackedFields = useMemo(() => render(true), [render])

  return {
    name: trimmed,
    subdomain,
    usable,
    dirty: Boolean(name || subdomain),
    check,
    refuse,
    fields,
    stackedFields,
  }
}
