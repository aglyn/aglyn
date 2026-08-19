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

import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { useCallback, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

/** One row of `GET /api/auth/staff-self-check`'s `identities`. */
interface IdentityRow {
  tenantId: string | null
  staff: boolean
  staffRole: string | null
  current: boolean
}

interface SelfCheck {
  uid: string
  email: string | null
  tenantId: string | null
  staff: boolean
  staffRole: string | null
  identities: IdentityRow[]
  hint: string | null
}

/**
 * "Where can this address sign in?" — the console surface for
 * `GET /api/auth/staff-self-check` (AGL-2119).
 *
 * THE GAP. AGL-1993 built the route and stopped there: its only reference in
 * the whole repo is `apps/docs/docs/staff-console/overview.md`, telling a
 * human to curl it with a hand-copied ID token. It is the one endpoint whose
 * entire purpose is to be read by a confused person, delivered as a curl.
 *
 * WHY IT LIVES HERE AND NOT ON A STAFF PAGE. `StaffGuard` answers a
 * non-staff session with a bare 404 on purpose (AGL-847) — a stranger must
 * not learn the staff console exists — and the people who need this are
 * precisely the ones getting that 404, so a staff page cannot host it. Nor
 * can the 404 itself, which every stranger who guesses `/admin` would see.
 *
 * So it is framed as what it actually is for everybody: the pools holding
 * your email address. That is real, non-privileged information an SSO user
 * has an ordinary reason to want — "why does my password not work here" is
 * the same question as "which record am I signed in as" — and it leaks
 * nothing, because the route reports ONLY on the caller's own identity and
 * never says "you are almost staff". The staff line renders only for a
 * record that already carries the claim, which only a staff person can see.
 *
 * NOT rendered until asked. The call hits every GCIP tenant pool, so it is a
 * button rather than a mount-time fetch.
 */
export function AccountIdentitiesCard() {
  const { data: user } = useUser()
  const [result, setResult] = useState<SelfCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      if (!user) throw new Error('Not signed in')
      // Force-refreshed: a stale token is the exact condition this diagnoses
      // — a claim granted minutes ago is not in the cached token, and
      // answering from it would report the very absence being investigated.
      // `useUser`, never a bare `getAuth()`: this app is a NAMED Firebase
      // app, and the bare call resolves the default one.
      const idToken = await user.getIdToken(true)
      const response = await fetch('/api/auth/staff-self-check', {
        headers: { authorization: `Bearer ${idToken}` },
      })
      if (!response.ok) throw new Error(`Check failed (${response.status})`)
      setResult((await response.json()) as SelfCheck)
    } catch (caught: any) {
      setError(caught?.message ?? 'Could not check this address')
    } finally {
      setBusy(false)
    }
  }, [user])

  return (
    <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="subtitle2">{'Sign-in records'}</Typography>
      <Typography variant="body2" color="text.secondary">
        {'One email address can exist as more than one sign-in — a password ' +
          'account and a single sign-on account, for example. If a sign-in ' +
          'works but the account looks wrong, this shows which records ' +
          'exist for your address and which one you are using now.'}
      </Typography>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => void run()}>
        {busy ? 'Checking…' : 'Check my sign-in records'}
      </Button>
      {error ? (
        <Alert severity="warning" sx={{ alignSelf: 'stretch' }}>
          {error}
        </Alert>
      ) : null}
      {result ? (
        <Stack spacing={1} sx={{ alignSelf: 'stretch' }}>
          {result.identities.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'Only the record you are signed in as.'}
            </Typography>
          ) : (
            result.identities.map((row) => (
              <Stack
                key={`${row.tenantId ?? 'project'}`}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {row.tenantId
                    ? 'Single sign-on (your organization)'
                    : 'Email and password'}
                </Typography>
                {row.current ? (
                  <Chip size="small" color="primary" label="Signed in now" />
                ) : null}
                {/* Renders only for a record that already carries the claim,
                    so a customer never sees this line at all. */}
                {row.staff ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Aglyn staff · ${row.staffRole}`}
                  />
                ) : null}
              </Stack>
            ))
          )}
          {result.hint ? (
            <Alert severity="info">{result.hint}</Alert>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  )
}

export default AccountIdentitiesCard
