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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import DocsHelpTip from './docs-help-tip.component'
import useCurrentOrg from '../hooks/use-current-org'

/** Mirrors `REPORT_KINDS` in `app/api/_lib/linear-issues.ts`. */
const KINDS = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'idea', label: 'An idea or request' },
  { value: 'question', label: 'A question' },
] as const

const MAX_SUMMARY = 120
const MAX_DESCRIPTION = 5000

export interface ReportIssueDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * "Report an issue" (AGL-2185) — the console's defect channel, reachable from
 * the account menu on every page.
 *
 * Deliberately NOT a support ticket. Tickets start on Pro and are a
 * conversation with the support team; this is open to every signed-in member,
 * including Free, and files a tracked issue in Linear.
 *
 * The dialog collects only what a person can actually answer — what kind of
 * report, a one-line summary, what happened, and whether we may contact them.
 * Everything else a triager needs (org, plan, host, version, build id,
 * browser) is derived server-side from the verified session and the request
 * headers, so the reporter never has to know it and cannot get it wrong. The
 * route is the one piece of context only the client holds, so it is the one
 * thing sent from here.
 *
 * On failure the dialog STAYS OPEN with the text intact. Closing on an error
 * would lose what the person wrote, which is both rude and the fastest way to
 * never hear about the bug again.
 */
export function ReportIssueDialog(props: ReportIssueDialogProps) {
  const { open, onClose } = props
  const { data: user } = useUser()
  const { orgId } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const pathname = usePathname()

  const [kind, setKind] = useState<string>('bug')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [contactConsent, setContactConsent] = useState(true)
  const [busy, setBusy] = useState(false)

  const ready = Boolean(summary.trim() && description.trim())

  const reset = () => {
    setKind('bug')
    setSummary('')
    setDescription('')
    setContactConsent(true)
  }

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> } | undefined
      )?.getIdToken?.()
      const response = await fetch('/api/issue-reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          kind,
          summary: summary.trim(),
          description: description.trim(),
          orgId,
          // The one fact the server cannot observe for itself. It is treated
          // as untrusted there and sanitised before it reaches the issue.
          route: pathname,
          viewportWidth:
            typeof window === 'undefined' ? undefined : window.innerWidth,
          viewportHeight:
            typeof window === 'undefined' ? undefined : window.innerHeight,
          contactConsent,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) {
        // 501 carries a real explanation (this deployment files nowhere);
        // everything else gets the server's message or a plain fallback.
        enqueueSnackbar(
          payload?.error ?? 'We could not send that report. Please try again.',
          { variant: response.status === 429 ? 'warning' : 'error' },
        )
        return
      }
      enqueueSnackbar(
        payload.reference
          ? `Thank you — your report was filed as ${payload.reference}.`
          : 'Thank you — your report was filed.',
        { variant: 'success' },
      )
      reset()
      onClose()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('We could not send that report. Please try again.', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? null : onClose())}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pr: 1 }}
      >
        {'Report an issue'}
        <DocsHelpTip topic="reportAnIssue" anchor="#what-to-write" />
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          {'Tell us what happened and we will track it. The page you are on, ' +
            'your workspace, and your browser and app version are attached ' +
            'automatically — you do not need to describe them.'}
        </Typography>
        <TextField
          select
          label="What kind of report is this?"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          disabled={busy}
        >
          {KINDS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Summary"
          placeholder="The media picker forgets the folder I chose"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          disabled={busy}
          slotProps={{ htmlInput: { maxLength: MAX_SUMMARY } }}
        />
        <TextField
          label="What happened?"
          placeholder={
            'What you did, what you expected, and what happened instead.'
          }
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={busy}
          multiline
          minRows={5}
          slotProps={{ htmlInput: { maxLength: MAX_DESCRIPTION } }}
          helperText={`${description.length} / ${MAX_DESCRIPTION}`}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={contactConsent}
              onChange={(event) => setContactConsent(event.target.checked)}
              disabled={busy}
            />
          }
          label={
            <Typography variant="body2">
              {'You can contact me about this report'}
            </Typography>
          }
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={submit} disabled={busy || !ready}>
          {busy ? 'Sending…' : 'Send report'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
ReportIssueDialog.displayName = 'ReportIssueDialog'
ReportIssueDialog.aglyn = true

export default ReportIssueDialog
