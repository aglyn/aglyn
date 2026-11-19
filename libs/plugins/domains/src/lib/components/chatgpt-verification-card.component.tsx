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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import type { ConsoleHostVerificationZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import { findChatgptClaimRecord, siteDomainForChatgpt } from '../model/chatgpt-verification'
import { ChatgptVerificationDialog } from './chatgpt-verification-dialog.component'
import { useDomainsFetch, type DnsAnswer } from './domains-api'

/*
 * VERIFY WITH CHATGPT, on the site's SEO setup under Search engine
 * verification: the site's verifications in one place.
 *
 * A business owner claims their business in ChatGPT by proving they control
 * its domain with one TXT record. When the site's domain keeps its DNS here,
 * the card's dialog takes the value ChatGPT shows and adds the record. For a
 * domain kept anywhere else — or one this member may not manage — it says
 * which record to add there. A site on its free address is told to connect a
 * domain first, since it has no DNS of its own.
 */

const HELP = pluginDocsHelp('chatgptVerification', { anchor: '#chatgpt' })

const INTRO =
  'ChatGPT lists businesses, and the owner can claim theirs to keep its details right. Claiming yours takes proof that you control your site’s domain.'

export default function ChatgptVerificationCard(props: ConsoleHostVerificationZoneProps) {
  const { orgId, orgSlug, host, connectedDomain } = props
  const request = useDomainsFetch()
  const domain = siteDomainForChatgpt(connectedDomain)
  /** `null` until asked; a domain not held here, or not this member's to manage, reads as kept elsewhere. */
  const [answer, setAnswer] = useState<DnsAnswer | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (!orgId || !domain) return
    try {
      setAnswer(await request<DnsAnswer>(DOMAINS_API_ROUTES.dns, { query: { orgId, domain } }))
    } catch {
      setAnswer(null)
    }
  }, [request, orgId, domain])

  useEffect(() => {
    void load()
  }, [load])

  if (!domain) {
    return (
      <CardDisplay header="Verify with ChatGPT" help={HELP} contentGutterX contentGutterY>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {INTRO}
          </Typography>
          <PrerequisiteNotice
            href={host ? `/${encodeURIComponent(orgSlug)}/hosts/${encodeURIComponent(host)}/admin/domain` : undefined}
            actionLabel="Connect a domain"
          >
            {'This site is on its free address, which has no domain of its own to verify. Connect a domain first.'}
          </PrerequisiteNotice>
        </Stack>
      </CardDisplay>
    )
  }

  const ours = Boolean(answer?.ours)
  const existing = ours && answer ? findChatgptClaimRecord(answer.records) : null
  return (
    <CardDisplay header="Verify with ChatGPT" help={HELP} contentGutterX contentGutterY>
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="body2" color="text.secondary">
          {INTRO}
        </Typography>
        {existing ? (
          <Alert severity="success" sx={{ alignSelf: 'stretch' }}>
            {`${domain} has a ChatGPT verification record. If ChatGPT gives you a new value, add it here to replace it.`}
          </Alert>
        ) : null}
        <Button variant="outlined" onClick={() => setOpen(true)}>
          {`Verify ${domain}`}
        </Button>
      </Stack>
      {orgId ? (
        <ChatgptVerificationDialog
          open={open}
          orgId={orgId}
          domain={domain}
          ours={ours}
          existing={existing}
          onClose={() => setOpen(false)}
          onSaved={() => void load()}
        />
      ) : null}
    </CardDisplay>
  )
}
