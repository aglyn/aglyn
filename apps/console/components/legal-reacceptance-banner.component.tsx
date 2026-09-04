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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE WORDING IS THE FEATURE
 *
 * Somebody who agreed yesterday, and whose documents were updated overnight,
 * may be asked to agree again — but must never be told they have not agreed
 * before. That reading is both wrong and insulting, and it is the one the
 * default phrasing produces.
 *
 * ⚠️ RE-ACCEPTANCE ON A VERSION CHANGE STAYS. Two alternatives have been
 * proposed and withdrawn before shipping: suppressing it entirely ("accept
 * once, never ask again"), and keeping the machinery behind a default-off
 * flag. Do not re-derive either from the arguments for them: ToS
 * §5.3's continued-use theory does make re-acceptance contractually optional,
 * and the decision is nevertheless to keep asking. The problem was never the
 * asking.
 *
 * The problem is a shared voice across two different situations. The common
 * one — `version-superseded`, a person who agreed and whose documents moved
 * under them — reads, in the other branch's words, as though the platform
 * held no record of them at all. To someone who clicked agree yesterday that
 * is both wrong and insulting.
 *
 * So the two branches read as the different situations they are:
 *
 *   `version-superseded`   LEADS WITH THE ACKNOWLEDGEMENT, and names the DAY
 *                          they agreed, because a date is what a person
 *                          recognises. "You last agreed to v1, current is v2"
 *                          is engineer-facing noise — the version id is not
 *                          rendered here at all.
 *
 *   `never-accepted`       Says we have no record ON THIS ACCOUNT, framed as
 *                          the records gap it usually is (an account older
 *                          than clickwrap capture, or an SSO/invite door that
 *                          never showed a consent control) — OUR gap, not an
 *                          accusation that they failed to do something.
 *
 * ⚠️ `acceptedAt` IS NULLABLE and `strictNullChecks` is OFF repo-wide, so a
 * date sentence that does not branch renders "on undefined" or, worse,
 * `new Date(null)` — 1 January 1970. `formatAcceptedOn` returns null instead
 * and the copy drops to a dateless acknowledgement that is still an
 * acknowledgement. Both branches are covered in the spec.
 */

interface LegalStatus {
  currentVersion: string
  reacceptanceRequired: boolean
  reacceptanceReason: 'none' | 'never-accepted' | 'version-superseded'
  latestAcceptedVersion: string | null
  /** ISO of the last acceptance; null when unknown or never. */
  latestAcceptedAt: string | null
  /** Which pinned documents moved. Null means UNKNOWN — say nothing. */
  changedDocumentKeys: string[] | null
}

/** What a person calls the document, keyed by the manifest's stable key. */
const DOCUMENT_LABELS: Record<string, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
}

/**
 * The DAY they agreed, in the reader's locale, or null.
 *
 * Null for an absent timestamp AND for an unparseable one. With
 * `strictNullChecks` off, `new Date(null)` is the epoch and `new Date(undefined)`
 * is Invalid Date — one prints a confident lie and the other prints
 * "Invalid Date" to a customer, so neither may reach the DOM.
 */
function formatAcceptedOn(iso: string | null | undefined): string | null {
  if (!iso) return null
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** "the Terms of Service", "the Terms of Service and the Privacy Policy". */
function joinDocumentLabels(keys: string[]): string {
  const labels = keys.map((key) => DOCUMENT_LABELS[key] ?? key)
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} and the ${labels[labels.length - 1]}`
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
        const response = await authorizedFetch(
          anyUser,
          '/api/auth/legal-acceptance',
        )
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
  const acceptedOn = formatAcceptedOn(status.latestAcceptedAt)
  // Only when the comparison actually ran AND found something. Null is
  // "unknown" and an empty array would mean the documents are byte-identical,
  // which is not a state this banner should be rendering in — either way,
  // claim nothing.
  const changed =
    status.changedDocumentKeys && status.changedDocumentKeys.length > 0
      ? joinDocumentLabels(status.changedDocumentKeys)
      : null

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
        {superseded ? (
          <>
            {/* The acknowledgement comes FIRST and in its own sentence, so
                the person reads "you already did this" before they read that
                anything is being asked of them. */}
            <Typography variant="body2">
              {acceptedOn
                ? `Thanks for agreeing to ${PLATFORM_BRAND_NAME}’s `
                : `You’ve already agreed to ${PLATFORM_BRAND_NAME}’s `}
              <LegalLinks />
              {acceptedOn
                ? ` on ${acceptedOn}. We’ve updated them since, so please take another look and confirm you’re happy to continue.`
                : `. We’ve updated them since, so please take another look and confirm you’re happy to continue.`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {changed
                ? `What changed: the ${changed}. Your earlier agreement stays on record — this adds to it.`
                : 'Your earlier agreement stays on record — this adds to it.'}
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="body2">
              {'We don’t have a record of your acceptance of '}
              {`${PLATFORM_BRAND_NAME}’s `}
              <LegalLinks />
              {' on this account. Please take a look and confirm to continue.'}
            </Typography>
            {/* Framed as OUR gap, because it usually is one. */}
            <Typography variant="caption" color="text.secondary">
              {
                'This is usually because the account was created before we started keeping these records, or through single sign-on or an invite that never showed one.'
              }
            </Typography>
          </>
        )}
      </Stack>
    </Alert>
  )
}

LegalReacceptanceBanner.displayName = 'LegalReacceptanceBanner'

export default LegalReacceptanceBanner
