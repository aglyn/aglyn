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

import { Alert, Button, Link, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { useUser } from '@aglyn/tenant-feature-instance'
import { LEGAL_DOCUMENT_VERSION } from '../constants/legal-documents'
import { LEGAL_URLS } from '../constants/shared'
import { postLegalAcceptance } from '../utils/legal-consent'

/**
 * Re-acceptance when the Terms move (AGL-2316).
 *
 * `legal-acceptance.ts` has always argued that one document per version makes
 * re-acceptance additive "when the Terms change". It never could: nothing
 * compared an accepted version against the published one, so the mechanism
 * had no trigger and six version bumps (`v1`…`v6`) went by without a single
 * user being asked again. This is the trigger.
 *
 * WHY A BANNER AND NOT A WALL. Blocking the console until someone clicks
 * agree is a stronger consent story and a worse one to be wrong about: the
 * version is read from a deploy-time constant, so a bad publish, a rollback,
 * or one stale instance would lock every customer out of a paid product over
 * a copy change. A banner that cannot be dismissed until it is answered puts
 * the ask in front of every page and costs nothing when the comparison is
 * wrong. Escalating it to a gate is a product decision with a real blast
 * radius and is not one to make silently.
 *
 * WHY IT ALSO FIRES FOR AN ACCOUNT WITH NO RECORD AT ALL. Accounts predating
 * clickwrap capture, and SSO/invite doors that never passed a consent
 * checkbox, hold no acceptance — which is indistinguishable, in a dispute,
 * from never having agreed. The copy is different for that case because the
 * fact is different, but the ask is the same one.
 *
 * The POST is the EXISTING writer: it stamps the server's version and the
 * server's clock, and it is idempotent per version, so a double click, a
 * retry, or two tabs cannot produce a second record or move the §18.5
 * timestamp.
 */

interface LegalStatus {
  currentVersion: string
  reacceptanceRequired: boolean
  reacceptanceReason: 'none' | 'never-accepted' | 'version-superseded'
  latestAcceptedVersion: string | null
}

function LegalLinks() {
  return (
    <>
      <Link
        href={LEGAL_URLS.TERMS}
        target="_blank"
        rel="noopener noreferrer"
        underline="always"
      >
        {'Terms of Service'}
      </Link>
      {' and '}
      <Link
        href={LEGAL_URLS.PRIVACY}
        target="_blank"
        rel="noopener noreferrer"
        underline="always"
      >
        {'Privacy Policy'}
      </Link>
    </>
  )
}

export function LegalReacceptanceBanner() {
  const { data: user } = useUser()
  const [status, setStatus] = useState<LegalStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    let cancelled = false
    const anyUser = user as any
    if (!anyUser?.getIdToken) return undefined
    void (async () => {
      try {
        const idToken = await anyUser.getIdToken()
        const response = await fetch('/api/auth/legal-acceptance', {
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!response.ok) return
        const payload = (await response.json()) as LegalStatus
        if (!cancelled) setStatus(payload)
      } catch {
        // Fails SILENT. A status read that could not run must not nag a
        // customer who has already accepted — the staff surface is where an
        // unreadable record is made visible, and it says so there.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const accept = useCallback(async () => {
    setBusy(true)
    try {
      const ok = await postLegalAcceptance(
        user as any,
        // The version THIS page rendered. The server stamps its own constant
        // regardless and 409s a mismatch, so a deploy between the read and
        // the click surfaces as "review them again" rather than as a record
        // of agreeing to text nobody was shown.
        LEGAL_DOCUMENT_VERSION,
        'reaccept-console',
      )
      if (ok) setAccepted(true)
    } finally {
      setBusy(false)
    }
  }, [user])

  if (accepted) return null
  if (!status?.reacceptanceRequired) return null

  const superseded = status.reacceptanceReason === 'version-superseded'

  return (
    <Alert
      severity="info"
      action={
        <Button size="small" disabled={busy} onClick={() => void accept()}>
          {busy ? 'Recording…' : 'I agree'}
        </Button>
      }
    >
      <Stack spacing={0.5}>
        <Typography variant="body2">
          {superseded
            ? `${PLATFORM_BRAND_NAME}’s `
            : `Please confirm you agree to ${PLATFORM_BRAND_NAME}’s `}
          <LegalLinks />
          {superseded
            ? ` have been updated. Please review and confirm you agree to continue.`
            : '.'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {superseded
            ? `You last agreed to version ${
                status.latestAcceptedVersion ?? '—'
              }; the current version is ${status.currentVersion}.`
            : 'We have no record of your acceptance on this account.'}
        </Typography>
      </Stack>
    </Alert>
  )
}

LegalReacceptanceBanner.displayName = 'LegalReacceptanceBanner'

export default LegalReacceptanceBanner
