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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { aiInsightSurfaceForPath } from '../model/ai-insight'
import { AiInsightDialog } from './ai-insight-dialog.component'

/**
 * Funnels by AI (AGL-3605), in the two zones the funnels plugin hosts on its
 * card. Both are UI only:
 *
 * - **Create with AI** (`funnelsCreate`) takes a description and hands it to
 *   the card's `propose`, which asks the funnels plugin's own door for a draft
 *   checked against the site — through core's text-generation seam, so it is
 *   metered and gated by this plugin's generator like any other generation.
 * - **Ask AI about this funnel** (`funnelInsight`) opens the insight dialog
 *   with a question about the funnel shown; the insight job reads the
 *   `funnels.*` figures the funnels plugin registers.
 *
 * Both draw at once from the shell's own gates — the `ai.generate`
 * permission, the plan's `aiGenerative` feature and the site's AI switch,
 * all settled before the slot mounts a widget — and ask the server nothing
 * until they are used: a refusal (the release flag, credits, a lockdown) is
 * the door's to say, in the dialog, when the description or question is sent.
 */

/** The props the funnels plugin hands `funnelsCreate`, restated: plugins do not import each other. */
export interface ConsoleFunnelsCreateZoneProps {
  hostId: string
  orgId: string | undefined
  propose: (brief: string) => Promise<string | null>
}

/** The props the funnels plugin hands `funnelInsight`, restated. */
export interface ConsoleFunnelInsightZoneProps {
  hostId: string
  orgId: string | undefined
  funnelName: string
  days: number
}

export const AI_FUNNEL_COPY = {
  create: 'Create with AI',
  title: 'Describe a funnel',
  label: 'Which steps should visitors take?',
  placeholder: 'People who read a blog post, then viewed pricing, then booked a consultation',
  next: `${PLATFORM_BRAND_NAME} AI drafts the steps from your site’s real pages, forms and products. You review the draft before anything is saved.`,
  submit: 'Draft the funnel',
  ask: 'Ask AI about this funnel',
} as const

/** The question "Ask AI about this funnel" opens with. */
export function aiFunnelQuestion(funnelName: string, days: number): string {
  return `In my funnel "${funnelName}" over the last ${days} days, where do visitors drop off most, and what might explain it?`
}

export function AiFunnelCreateButton({ propose }: ConsoleFunnelsCreateZoneProps) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const problem = await propose(brief.trim())
    setBusy(false)
    if (problem) setError(problem)
    else {
      setOpen(false)
      setBrief('')
    }
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MdiIcon path={mdiCreation.path} />}
        onClick={() => setOpen(true)}
      >
        {AI_FUNNEL_COPY.create}
      </Button>
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{AI_FUNNEL_COPY.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={AI_FUNNEL_COPY.label}
              placeholder={AI_FUNNEL_COPY.placeholder}
              value={brief}
              multiline
              minRows={3}
              slotProps={{ htmlInput: { maxLength: 1_000 } }}
              onChange={(event) => setBrief(event.target.value)}
            />
            <Typography variant="body2" color="text.secondary">
              {AI_FUNNEL_COPY.next}
            </Typography>
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" onClick={() => void submit()} disabled={busy || !brief.trim()}>
            {busy ? 'Drafting…' : AI_FUNNEL_COPY.submit}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export function AiFunnelAskButton({ hostId, orgId, funnelName, days }: ConsoleFunnelInsightZoneProps) {
  const { data: user } = useUser()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  if (!orgId) return null
  const orgSlug = String(pathname ?? '').split('/').filter(Boolean)[0] ?? ''
  const host = aiInsightSurfaceForPath(pathname)?.host ?? null

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MdiIcon path={mdiCreation.path} />}
        onClick={() => setOpen(true)}
        sx={{ alignSelf: 'flex-start' }}
      >
        {AI_FUNNEL_COPY.ask}
      </Button>
      <AiInsightDialog
        open={open}
        onClose={() => setOpen(false)}
        orgId={orgId}
        orgSlug={orgSlug}
        hostId={hostId}
        host={host}
        surface="analytics"
        user={user}
        uid={(user as { uid?: string } | null | undefined)?.uid ?? null}
        initialQuestion={aiFunnelQuestion(funnelName, days)}
      />
    </>
  )
}
