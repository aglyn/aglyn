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

import { CopyField } from '@aglyn/shared-ui-jsx/components/copy-field.component'
import { authorizedFetch, type MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import type { AiSiteImportClaim } from '../model/ai-site-import-view'

/** The ownership door, as the console calls it (AGL-3974). */
export const AI_SITE_IMPORT_OWNERSHIP_PATH = '/api/ai/site-import/ownership'

type Method = 'dns' | 'meta' | 'email'

/** One answer of the ownership door: the claim it left, and the sentence for the person. */
export interface AiSiteOwnershipAnswer {
  claim: AiSiteImportClaim | null
  message: string | null
  ok: boolean
}

/** Posts one action to the ownership door. Never throws. */
export async function postAiSiteOwnership(
  user: MaybeTokenSource,
  body: Record<string, unknown>,
): Promise<AiSiteOwnershipAnswer> {
  try {
    const response = await authorizedFetch(user, AI_SITE_IMPORT_OWNERSHIP_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const result = payload?.['result'] as { claim?: AiSiteImportClaim; message?: string } | undefined
    const claim = (result?.claim ?? (payload?.['claim'] as AiSiteImportClaim | undefined)) ?? null
    return {
      claim,
      message: result?.message ?? (response.ok ? null : String(payload?.['error'] ?? 'That did not work. Try again.')),
      ok: response.ok,
    }
  } catch {
    return { claim: null, message: 'That did not work. Check your connection and try again.', ok: false }
  }
}

const PROVEN_WORDS: Record<Method, string> = {
  dns: 'a DNS record',
  meta: 'a tag on your home page',
  email: 'a code sent to an address at your domain',
}

export interface AiSiteOwnershipProofProps {
  orgId: string
  user: MaybeTokenSource
  claim: AiSiteImportClaim
  onClaim: (claim: AiSiteImportClaim) => void
}

/**
 * Proving the site is yours (AGL-3974, AGL-3976): any ONE of three ways, each
 * a card with what to do where and a button that checks it now. The status
 * at the top says whether the site is verified, by which way and when, or
 * that it is not yet. Nothing is read from the site until it is.
 */
export function AiSiteOwnershipProof({ orgId, user, claim, onClaim }: AiSiteOwnershipProofProps) {
  const [busy, setBusy] = useState<Method | 'send' | null>(null)
  const [messages, setMessages] = useState<Partial<Record<Method, { text: string; ok: boolean }>>>({})
  const [mailbox, setMailbox] = useState('')
  const [code, setCode] = useState('')
  const domain = claim.domain
  const recordName = claim.dns.host.endsWith(`.${domain}`) ? claim.dns.host.slice(0, -(domain.length + 1)) : claim.dns.host

  const act = useCallback(
    async (method: Method, busyKey: Method | 'send', body: Record<string, unknown>) => {
      setBusy(busyKey)
      const answer = await postAiSiteOwnership(user, { orgId, domain, ...body })
      if (answer.claim) onClaim(answer.claim)
      setMessages((current) => ({
        ...current,
        ...(answer.message ? { [method]: { text: answer.message, ok: Boolean(answer.claim?.current) } } : {}),
      }))
      setBusy(null)
      return answer
    },
    [user, orgId, domain, onClaim],
  )

  const verified = claim.current
  const provenOn = claim.provenAt ? new Date(claim.provenAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null
  const lapsed = claim.status === 'proven' && !claim.current

  const note = (method: Method) =>
    messages[method] ? (
      <Alert severity={messages[method]?.ok ? 'success' : 'info'} sx={{ mt: 1 }}>
        {messages[method]?.text}
      </Alert>
    ) : null

  return (
    <Stack spacing={2} data-start-area="ownership">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="subtitle1" component="h2">
          {domain}
        </Typography>
        {verified ? (
          <Chip size="small" color="success" label="Verified" />
        ) : (
          <Chip size="small" variant="outlined" label={lapsed ? 'Verify again' : 'Not verified yet'} />
        )}
      </Stack>
      {verified && claim.provenMethod ? (
        <Alert severity="success">
          {`Verified by ${PROVEN_WORDS[claim.provenMethod]}${provenOn ? ` on ${provenOn}` : ''}. A proof is good for 30 days.`}
        </Alert>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {lapsed
            ? 'Your last proof is more than 30 days old. Prove the site is yours again, any one way below.'
            : 'Prove the site is yours, any one way below. Nothing is read from your site until you do, so only a site you own can be brought in.'}
        </Typography>
      )}
      {!verified && (
        <Stack spacing={2}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" component="h3">
                  {'Add a DNS record'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {'Where your domain is registered or its DNS is managed, add a TXT record with this name and value. It can take a few minutes to an hour to appear.'}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' }, gap: 1.5 }}>
                  <CopyField label="Name" value={recordName} helperText={`Some providers want the full name: ${claim.dns.host}`} />
                  <CopyField label="Value" value={claim.dns.value} helperText="Record type: TXT" />
                </Box>
                <Box>
                  <Button variant="outlined" disabled={busy !== null} onClick={() => void act('dns', 'dns', { action: 'check', method: 'dns' })}>
                    {busy === 'dns' ? 'Checking…' : 'Check the DNS record'}
                  </Button>
                </Box>
                {note('dns')}
              </Stack>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" component="h3">
                  {'Add a tag to your home page'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {'In the builder your site is made with now, open the setting for code in your home page’s header (often called Custom code or Header code), paste this tag there, and publish the site.'}
                </Typography>
                <CopyField label="Tag" value={claim.meta.tag} />
                <Box>
                  <Button variant="outlined" disabled={busy !== null} onClick={() => void act('meta', 'meta', { action: 'check', method: 'meta' })}>
                    {busy === 'meta' ? 'Checking…' : 'Check my home page'}
                  </Button>
                </Box>
                {note('meta')}
              </Stack>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" component="h3">
                  {'Get a code by email'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {`We email a six-digit code to an address at ${domain}. It is good for 15 minutes.`}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
                  <TextField
                    label="Email address"
                    size="small"
                    value={mailbox}
                    onChange={(event) => setMailbox(event.target.value.replace(/@.*$/, ''))}
                    slotProps={{ input: { endAdornment: <InputAdornment position="end">{`@${domain}`}</InputAdornment> } }}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="outlined"
                    disabled={busy !== null || !mailbox.trim()}
                    onClick={() => void act('email', 'send', { action: 'send-code', email: `${mailbox.trim()}@${domain}` })}
                  >
                    {busy === 'send' ? 'Sending…' : claim.email.pendingAddress ? 'Send a new code' : 'Send a code'}
                  </Button>
                </Stack>
                {claim.email.pendingAddress ? (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
                    <TextField
                      label={`Code sent to ${claim.email.pendingAddress}`}
                      size="small"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code' } }}
                      sx={{ flex: 1 }}
                    />
                    <Button
                      variant="contained"
                      disabled={busy !== null || code.length !== 6}
                      onClick={() => void act('email', 'email', { action: 'confirm-code', code })}
                    >
                      {busy === 'email' ? 'Checking…' : 'Confirm the code'}
                    </Button>
                  </Stack>
                ) : null}
                {note('email')}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      )}
    </Stack>
  )
}

export default AiSiteOwnershipProof
