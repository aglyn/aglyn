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

import type { SeoPageReport } from '@aglyn/aglyn/app-utils/seo-audit'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useCallback, useRef, useState } from 'react'
import { runSeoCheck, seoFindingLabel } from './seo-check-card.component'

export interface SeoPageCheckProps {
  hostId: string
  screenId: string
}

type Answer =
  | { kind: 'page'; page: SeoPageReport }
  | { kind: 'unchecked' }
  | { kind: 'error'; message: string }

/**
 * "Check this page", in a screen's SEO card: the site's SEO check
 * (`seo-check-card.component.tsx`), answered for this one page. Platform UI,
 * for every site owner.
 *
 * It checks the whole site to answer, because two of its findings — a title
 * another page also uses, a page nothing links to — are only visible from the
 * site. What it checks is the page as PUBLISHED, which is what a search
 * engine reads; a page the sitemap does not list is not checked, and says so.
 */
export function SeoPageCheck({ hostId, screenId }: SeoPageCheckProps) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)

  const run = useCallback(async () => {
    if (!userRef.current) return
    setBusy(true)
    const result = await runSeoCheck(userRef.current, hostId)
    setBusy(false)
    if ('error' in result) {
      setAnswer({ kind: 'error', message: result.error })
      return
    }
    const page = result.report.pages.find((entry) => entry.screenId === screenId)
    setAnswer(page ? { kind: 'page', page } : { kind: 'unchecked' })
  }, [hostId, screenId])

  return (
    <Stack spacing={1} aria-label="SEO check for this page">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button size="small" variant="outlined" disabled={busy || !user} onClick={() => void run()}>
          {answer ? 'Check again' : 'Check this page'}
        </Button>
        {busy ? <CircularProgress size={16} aria-label="Checking this page" /> : null}
        {answer?.kind === 'page' ? (
          <Typography variant="caption" color="text.secondary">
            {`Score ${answer.page.score} of 100, as published`}
          </Typography>
        ) : null}
      </Stack>
      {answer?.kind === 'error' ? <Alert severity="warning">{answer.message}</Alert> : null}
      {answer?.kind === 'unchecked' ? (
        <Typography variant="body2" color="text.secondary">
          {'This page is not in the sitemap — it is unpublished, not public, a template or an error page — so the SEO check does not cover it.'}
        </Typography>
      ) : null}
      {answer?.kind === 'page' ? (
        answer.page.findings.length ? (
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {answer.page.findings.map((entry) => (
              <Typography component="li" variant="body2" key={`${entry.code}:${entry.keyword ?? ''}`}>
                <strong>{seoFindingLabel(entry)}</strong>
                {` — ${entry.message}`}
              </Typography>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2">{'Nothing found: this page has what a search result needs.'}</Typography>
        )
      ) : null}
    </Stack>
  )
}
SeoPageCheck.displayName = 'SeoPageCheck'

export default SeoPageCheck
