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

import { lockdownRefusalText, parseLockdownRefusal, PLATFORM_BRAND_NAME } from '@aglyn/aglyn'
import type { ConsolePendingSite } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { mdiWebSync } from '@aglyn/shared-data-mdi'
import { HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch, type MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AI_SITE_IMPORT_DOMAIN_INPUT, AI_SITE_IMPORT_KIND, AI_SITE_IMPORT_WAVE_PAGES } from '../model/ai-site-import'
import type { AiSiteImportClaim } from '../model/ai-site-import-view'
import { aiSiteBuildHref } from './ai-job-links'
import { publishAiJob } from './ai-jobs-store'
import { AiSiteOwnershipProof, postAiSiteOwnership } from './ai-site-ownership-proof.component'

/** Each part of the flow links its own section of the Bring my site guide. */
export const AI_SITE_IMPORT_HELP = {
  address: pluginDocsHelp('aiImport', {
    anchor: '#your-current-website',
    excerpt: 'The address people type to reach your site today. You prove it is yours next, so only a site you own can be brought in.',
  }),
  prove: pluginDocsHelp('aiImport', {
    anchor: '#prove-it-is-yours',
    excerpt: 'Add a DNS record, add a tag to your home page, or get a code at an address at your domain. Any one is enough.',
  }),
  waves: pluginDocsHelp('aiImport', {
    anchor: '#waves',
    excerpt: 'Your main pages come in first, then each collection, such as blog posts, ten pages at a time. You review each wave and start the next yourself.',
  }),
  turnedAway: pluginDocsHelp('aiImport', {
    anchor: '#turned-away',
    excerpt: 'Allow AglynBot in your site’s bot protection or firewall settings, then choose Check again. Reading your site again uses no AI credits.',
  }),
}

type Step = 'address' | 'prove' | 'read'

export interface AiSiteImportStartProps {
  orgId: string
  orgSlug: string | null
  hostId: string | null
  host: string | null
  user: MaybeTokenSource
  /** The site being created by "Create site", when it does not exist yet (AGL-3761). */
  pendingSite?: ConsolePendingSite
  /** Back to how the site starts. */
  onBack: () => void
  /** The dialog closes before the job's page opens. */
  leave?: () => void
}

/**
 * "Bring my site" (AGL-3976): the address of the site the person has now,
 * the proof that it is theirs, and what happens next — then the site is read
 * and its waves planned, nothing built, on the import job's own page.
 *
 * Nothing is created until "Read my site": the site in Create site is made
 * then, empty, and the import job is started on it. The job reads the site
 * and waits for the person to start its first wave, so even this costs no
 * AI credits.
 */
export function AiSiteImportStart({ orgId, orgSlug, hostId, host, user, pendingSite, onBack, leave }: AiSiteImportStartProps) {
  const router = useRouter()
  const userRef = useRef(user)
  userRef.current = user
  const [step, setStep] = useState<Step>('address')
  const [address, setAddress] = useState('')
  const [claim, setClaim] = useState<AiSiteImportClaim | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A site already verified skips the proof step, and Back skips it too.
  const [proved, setProved] = useState(false)

  const claimIt = useCallback(async () => {
    setBusy(true)
    setNotice(null)
    const answer = await postAiSiteOwnership(userRef.current, { orgId, action: 'claim', domain: address })
    setBusy(false)
    if (!answer.claim) {
      setNotice(answer.message ?? 'That address could not be used.')
      return
    }
    setClaim(answer.claim)
    setProved(!answer.claim.current)
    setStep(answer.claim.current ? 'read' : 'prove')
  }, [orgId, address])

  const read = useCallback(async () => {
    if (!claim?.current) return
    setBusy(true)
    setNotice(null)
    try {
      const requestJob = (siteId: string | null, check: boolean) =>
        authorizedFetch(userRef.current, '/api/ai/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            hostId: siteId,
            kind: AI_SITE_IMPORT_KIND,
            brief: `Bring in ${claim.domain}`,
            inputs: { [AI_SITE_IMPORT_DOMAIN_INPUT]: claim.domain },
            ...(check ? { check: true } : {}),
          }),
        })
      const refused = async (response: Response): Promise<Record<string, unknown> | null> => {
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
        if (response.ok) return payload ?? {}
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(locked ? lockdownRefusalText(locked) : String(payload?.['error'] ?? 'Your site could not be read. Try again.'))
        return null
      }
      let site = { hostId, host, orgSlug }
      if (!hostId && pendingSite) {
        // Asked before the site exists, so a refusal creates nothing (AGL-3859).
        if (!pendingSite.created && !(await refused(await requestJob(null, true)))) return
        const made = await pendingSite.create()
        if ('error' in made) {
          setNotice(made.error)
          if (made.address) onBack()
          return
        }
        site = { hostId: made.hostId, host: made.host, orgSlug: made.orgSlug || orgSlug }
      }
      if (!site.hostId) return
      const payload = await refused(await requestJob(site.hostId, false))
      const job = (payload?.['job'] as AiJobSummary | undefined) ?? null
      if (!job) {
        if (payload) setNotice('Your site could not be read. Try again.')
        return
      }
      publishAiJob(job)
      const href = aiSiteBuildHref(site.orgSlug, site.host, job.id)
      if (href) {
        leave?.()
        router.push(href)
      }
    } catch {
      setNotice('Your site could not be read. Try again.')
    } finally {
      setBusy(false)
    }
  }, [claim, orgId, hostId, host, orgSlug, pendingSite, onBack, leave, router])

  const back = () => {
    setNotice(null)
    if (step === 'address') onBack()
    else if (step === 'prove') setStep('address')
    else setStep(proved ? 'prove' : 'address')
  }

  return (
    <Stack spacing={3} component="section" aria-label="Bring my site" data-start-area="import">
      {notice && <Alert severity="info">{notice}</Alert>}
      {step === 'address' && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle1" component="h2">
              {'Your current website'}
            </Typography>
            <HelpTip {...AI_SITE_IMPORT_HELP.address} />
          </Stack>
          <TextField
            label="Website address"
            placeholder="example.com"
            value={address}
            autoFocus
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && address.trim() && !busy) {
                event.preventDefault()
                void claimIt()
              }
            }}
            helperText="The address people type to reach your site today. You prove it is yours next."
          />
        </Stack>
      )}
      {step === 'prove' && claim && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle1" component="h2">
              {'Prove it is yours'}
            </Typography>
            <HelpTip {...AI_SITE_IMPORT_HELP.prove} />
          </Stack>
          <AiSiteOwnershipProof orgId={orgId} user={user} claim={claim} onClaim={setClaim} />
        </Stack>
      )}
      {step === 'read' && claim && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle1" component="h2">
              {`Bring in ${claim.domain}`}
            </Typography>
            <HelpTip {...AI_SITE_IMPORT_HELP.waves} />
          </Stack>
          <Box component="ul" sx={{ m: 0, pl: 3, '& li': { mb: 1 } }}>
            <Typography component="li" variant="body2">
              {`AglynBot reads your whole site, home page first, as many pages as your plan includes: your main pages first, then collections such as blog posts.`}
            </Typography>
            <Typography component="li" variant="body2">
              {`You see what was found, what could not be read and why, and what each wave of up to ${AI_SITE_IMPORT_WAVE_PAGES} pages costs before anything is built. Reading your site uses no AI credits.`}
            </Typography>
            <Typography component="li" variant="body2">
              {'If your home page cannot be read, nothing is planned and no AI credits are used. You are told why, and you check again once it can be.'}
            </Typography>
            <Typography component="li" variant="body2">
              {`${PLATFORM_BRAND_NAME} AI rewrites each page into your new site’s design, with its words, facts and photos. You review each wave and start the next yourself.`}
            </Typography>
            <Typography component="li" variant="body2">
              {'Every page is a draft. Nothing is published until you publish it, and your current site is not changed.'}
            </Typography>
          </Box>
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
        <Button onClick={back} disabled={busy}>
          {'Back'}
        </Button>
        {step === 'address' && (
          <Button variant="contained" disabled={busy || !address.trim()} onClick={() => void claimIt()}>
            {busy ? 'Checking…' : 'Next'}
          </Button>
        )}
        {step === 'prove' && (
          <Button variant="contained" disabled={!claim?.current} onClick={() => setStep('read')}>
            {'Next'}
          </Button>
        )}
        {step === 'read' && (
          <Button
            variant="contained"
            size="large"
            disabled={busy || !claim?.current}
            onClick={() => void read()}
            startIcon={<MdiIcon path={mdiWebSync.path} />}
          >
            {busy ? 'Starting…' : 'Read my site'}
          </Button>
        )}
      </Stack>
    </Stack>
  )
}

export default AiSiteImportStart
