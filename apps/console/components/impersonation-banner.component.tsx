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

import { Alert, Button } from '@mui/material'
import { signOut } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { useAuth, useUser } from '@aglyn/tenant-feature-instance'

/**
 * Impersonation banner (AGL-246): pinned warning whenever the session was
 * minted by the staff impersonate endpoint (claims.impersonatedBy). The
 * exit signs out — the staff member signs back into their own account.
 */
export function ImpersonationBanner() {
  const { data: user } = useUser()
  const auth = useAuth()
  const [impersonatedBy, setImpersonatedBy] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (user as any)
      ?.getIdTokenResult?.()
      .then((result: any) => {
        if (active) {
          setImpersonatedBy(
            (result?.claims?.impersonatedByEmail as string) ??
              (result?.claims?.impersonatedBy as string) ??
              null,
          )
        }
      })
      .catch(() => {
        if (active) setImpersonatedBy(null)
      })
    return () => {
      active = false
    }
  }, [user])

  if (!impersonatedBy) return null

  return (
    <Alert
      severity="warning"
      sx={{ borderRadius: 0, position: 'sticky', top: 0, zIndex: 1400 }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => {
            // Named-app auth instance (useAuth) — bare getAuth() resolves the
            // '[DEFAULT]' app, which this app never registers.
            void signOut(auth).then(() => window.location.assign('/signin'))
          }}
        >
          {'Exit impersonation'}
        </Button>
      }
    >
      {`You are impersonating ${
        (user as any)?.email ?? 'this account'
      } (staff: ${impersonatedBy}). Actions are audited.`}
    </Alert>
  )
}
ImpersonationBanner.displayName = 'ImpersonationBanner'

export default ImpersonationBanner
