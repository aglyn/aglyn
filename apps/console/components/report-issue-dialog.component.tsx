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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { usePathname } from 'next/navigation'
import { useMemo, useState } from 'react'
import DocsHelpTip from './docs-help-tip.component'
import { useHostId } from './host-id-provider'
import {
  MAX_SUMMARY,
  REPORT_FIELDS,
  type ReportField,
} from '../app/api/_lib/linear-issues'
import { docsHelp } from '../constants/docs-links'
import useBranding from '../hooks/use-branding'
import useCurrentOrg from '../hooks/use-current-org'
import { useUrlNamesOrg } from '../hooks/use-url-names-org'

/**
 * The kinds, with the wording a customer sorts themselves by.
 *
 * The VALUES come from `REPORT_FIELDS`, which is the same schema the API
 * route validates against — the dialog no longer keeps its own copy of the
 * kind list to drift out of sync with the server's.
 *
 * Named by the RESOLVED brand rather than a literal (AGL-2153). This copy's
 * whole job is to separate "the product" from "your site", and under a
 * white-label workspace the product a customer knows is the operator's, not
 * ours — a notice about "Aglyn" would name something they have never heard
 * of and mis-sort exactly the reports it exists to sort.
 */
const kindLabels = (brand: string): Record<string, string> => ({
  bug: `Something in ${brand} is broken`,
  idea: `An idea or request for ${brand}`,
  question: `A question about using ${brand}`,
})

/**
 * Concrete cases, because the boundary is NOT "platform versus content".
 *
 * we don't need someone submitting tickets when they have
 * an issue with a page that was created by their agency. The failure mode is
 * specific — an agency builds a site, their client signs in, finds their own
 * page wrong, and files it with us. A legalistic disclaimer does not sort
 * that; three real sentences do, and the third one matters most because it
 * looks like a content problem and is ours.
 */
const EXAMPLES: readonly { case: string; verdict: string; ours: boolean }[] = [
  {
    case: '"The heading on my About page is the wrong color."',
    verdict: 'Your site — change it in the editor, or ask whoever builds it.',
    ours: false,
  },
  {
    case: '"Headings render at the wrong size on every site I open."',
    verdict: 'Ours. Please report it.',
    ours: true,
  },
  {
    case: '"My page returns 404 after I renamed it."',
    verdict: 'Ours. Please report it.',
    ours: true,
  },
]

export interface ReportIssueDialogProps {
  open: boolean
  onClose: () => void
}

interface DocsSection {
  title: string
  url: string
  text: string
}

/**
 * "Report an issue" (AGL-2185, AGL-2486) — the console's defect channel,
 * reachable from the account menu on every page.
 *
 * Deliberately NOT a support ticket. Tickets start on Pro and are a
 * conversation with the support team; this is open to every signed-in member,
 * including Free, and files a tracked issue in Linear.
 *
 * ## Scope, said before anything is typed (AGL-2486)
 *
 * The notice is the FIRST thing in the dialog, above the fields, because its
 * whole job is to be read before someone writes three paragraphs — under the
 * form it would be fine print that has already cost them the effort.
 *
 * It cannot name the agency, and it does not try. Nothing on the client
 * resolves "who builds this site": `org.ownerUid` is an opaque uid, the
 * `users/{uid}` doc is readable only by its owner, the members roster is
 * closed to a scoped collaborator, and the repo has no agency/reseller
 * relationship model at all. So the copy says "whoever builds it" and never
 * promises a name. The one honest exception is a white-label workspace that
 * configured `branding.supportUrl` — a real destination someone put there on
 * purpose — which is linked when it exists and silently absent when it does
 * not. `resolveBrandingProfile` returns null rather than substituting Aglyn's
 * own desk, for exactly this reason.
 *
 * ## The audience includes site collaborators
 *
 * The account-menu row is gated by nothing — not role, not plan, not org
 * membership — so a scoped site collaborator sees this dialog, on Free, on
 * org-less routes. That is the population most likely to be an agency's
 * client, and the copy is written to read correctly for someone who may not
 * know who their agency is.
 *
 * ## Fields depend on the kind
 *
 * `REPORT_FIELDS` is imported from the API's own module rather than mirrored
 * here, so what the dialog asks and what the route enforces cannot drift.
 * Nothing asks for a fact the server can observe: route, org, site, role,
 * plan, version, build id, browser, viewport and release flags are all
 * attached automatically and are more reliable than typed answers.
 *
 * On failure the dialog STAYS OPEN with the text intact. Closing on an error
 * would lose what the person wrote, which is both rude and the fastest way to
 * never hear about the bug again.
 */
export function ReportIssueDialog(props: ReportIssueDialogProps) {
  const { open, onClose } = props
  const { data: user } = useUser()
  const { orgId: scopedOrgId } = useCurrentOrg()
  const hostId = useHostId()
  const { branding, whiteLabel } = useBranding()
  /**
   * Whether the URL actually names a workspace (AGL-1130).
   *
   * `useCurrentOrg()` resolves through `useOrgScope().currentOrg`, which
   * deliberately falls back to a remembered selection and then to the user's
   * FIRST org, because org-less pages still need an org to ACT on. That
   * fallback is right for an action and wrong for a claim — and the org
   * stamped onto a bug report is a claim about where the reporter was.
   *
   * I was in the staff
   * console and therefore was not viewing an org but those fields said there
   * was an org attached to it. If we are not viewing an org the org context
   * should be nothing. AGL-2485 is the evidence — it recorded
   * `/admin/media-quarantine` as the route and `Test Org` as the
   * organization, a workspace that page has nothing to do with. A triager
   * reading that goes looking in the wrong tenant's data.
   */
  const urlNamesWorkspace = useUrlNamesOrg()
  const orgId = urlNamesWorkspace ? scopedOrgId : undefined
  const { enqueueSnackbar } = useSnackbar()
  const pathname = usePathname()

  const [kind, setKind] = useState<string>('bug')
  const [summary, setSummary] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [contactConsent, setContactConsent] = useState(true)
  const [showExamples, setShowExamples] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Set when the docs already answer a question; the form is replaced. */
  const [docsAnswer, setDocsAnswer] = useState<DocsSection[] | null>(null)

  const fields: readonly ReportField[] = useMemo(
    () => REPORT_FIELDS[kind as keyof typeof REPORT_FIELDS] ?? [],
    [kind],
  )

  /**
   * Only the CURRENT kind's required fields gate the button — switching kind
   * keeps what was typed, so changing your mind twice does not cost you the
   * answers, but it must not make an unrelated kind's requirement block you.
   */
  const ready = Boolean(
    summary.trim() &&
      fields.every((field) => !field.required || answers[field.id]?.trim()),
  )

  /**
   * The product name this reporter actually sees. `useBranding` answers with
   * the platform profile for every org that is not white-label, so this is
   * the configured brand everywhere without a special case.
   */
  const brand = branding?.productName || PLATFORM_BRAND_NAME
  const KIND_LABELS = useMemo(() => kindLabels(brand), [brand])

  /**
   * A support destination somebody actually configured, or nothing.
   *
   * Gated on `whiteLabel` deliberately: the platform profile's `supportUrl`
   * is AGLYN'S OWN desk, and offering that to someone whose page is wrong
   * sends them to a team that cannot change their site — the same reasoning
   * `resolveBrandingProfile` already applies when it refuses to substitute
   * ours into a blank white-label slot.
   */
  const siteSupportUrl =
    whiteLabel && branding?.supportUrl ? branding.supportUrl : null

  const reset = () => {
    setKind('bug')
    setSummary('')
    setAnswers({})
    setContactConsent(true)
    setShowExamples(false)
    setDocsAnswer(null)
  }

  const close = () => {
    setDocsAnswer(null)
    onClose()
  }

  const submit = async (skipDeflection = false) => {
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
          // Only this kind's fields. The server drops unknown ids anyway;
          // sending another kind's leftovers would just be noise on the wire.
          answers: Object.fromEntries(
            fields
              .map((field) => [field.id, (answers[field.id] ?? '').trim()])
              .filter(([, value]) => value),
          ),
          skipDeflection,
          orgId,
          // Which site the person is working on, when they are on one. Like
          // `orgId` this is a HINT: the server re-checks that this session may
          // actually see the host and drops it otherwise, so naming someone
          // else's site here achieves nothing.
          hostId,
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
      // Answered from the documentation — nothing was filed, and nothing
      // should be. The form is kept intact behind this so "send anyway" is
      // one click rather than retyping.
      if (response.ok && payload?.deflected) {
        setDocsAnswer(payload.sections ?? [])
        return
      }
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
      onClose={() => (busy ? null : close())}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pr: 1 }}
      >
        {docsAnswer ? 'This may already be answered' : 'Report an issue'}
        <DocsHelpTip topic="reportAnIssue" anchor="#what-to-write" />
      </DialogTitle>

      {docsAnswer ? (
        <>
          <DialogContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Typography variant="body2" color="text.secondary">
              {'Straight from the documentation — we have not filed anything ' +
                'yet. If this covers it, you are done.'}
            </Typography>
            {docsAnswer.map((section) => (
              <Box key={section.url}>
                <Link
                  href={section.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="subtitle2"
                >
                  {section.title}
                </Link>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}
                >
                  {section.text}
                </Typography>
              </Box>
            ))}
          </DialogContent>
          <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button onClick={() => setDocsAnswer(null)} disabled={busy}>
              {'Back'}
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={() => submit(true)} disabled={busy}>
              {busy ? 'Sending…' : "This didn't answer it — send anyway"}
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                reset()
                onClose()
              }}
              disabled={busy}
            >
              {'That answers it'}
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
              <AlertTitle sx={{ fontWeight: 600 }}>
                {`This is for problems with ${brand} itself`}
              </AlertTitle>
              <Typography variant="body2">
                {`Tell us when ${brand} misbehaves — the editor, the ` +
                  'console, publishing, domains, billing. If what is wrong ' +
                  'is the content, wording or design of a site built in ' +
                  `${brand}, that lives in the site: change it in the ` +
                  'editor, or ask whoever builds the site for you. We ' +
                  'cannot change someone else’s site for them.'}
              </Typography>
              {siteSupportUrl ? (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <Link
                    href={siteSupportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {'Get help with this site'}
                  </Link>
                </Typography>
              ) : null}
              <Button
                size="small"
                onClick={() => setShowExamples((shown) => !shown)}
                sx={{ mt: 0.5, ml: -1 }}
              >
                {showExamples ? 'Hide examples' : 'Not sure which yours is?'}
              </Button>
              <Collapse in={showExamples}>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {EXAMPLES.map((example) => (
                    <Box key={example.case}>
                      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                        {example.case}
                      </Typography>
                      <Typography
                        variant="caption"
                        color={
                          example.ours ? 'success.main' : 'text.secondary'
                        }
                      >
                        {example.verdict}
                      </Typography>
                    </Box>
                  ))}
                  <Typography variant="caption" color="text.secondary">
                    {'Still unsure? Send it — a report in the wrong place is ' +
                      'better than a problem nobody hears about. '}
                    <Link
                      href={
                        docsHelp('reportAnIssue', {
                          anchor: '#what-to-write',
                        }).href
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {'More about what to write'}
                    </Link>
                  </Typography>
                </Stack>
              </Collapse>
            </Alert>

            <Typography variant="body2" color="text.secondary">
              {'The page you are on, your workspace and site, your role and ' +
                'plan, and your browser and app version are attached ' +
                'automatically — you do not need to describe them.'}
            </Typography>

            <TextField
              select
              label="What kind of report is this?"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              disabled={busy}
            >
              {Object.keys(REPORT_FIELDS).map((value) => (
                <MenuItem key={value} value={value}>
                  {KIND_LABELS[value] ?? value}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Summary"
              required
              placeholder="The media picker forgets the folder I chose"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              disabled={busy}
              slotProps={{ htmlInput: { maxLength: MAX_SUMMARY } }}
            />

            {fields.map((field) =>
              field.choices ? (
                <TextField
                  key={field.id}
                  select
                  required={field.required}
                  label={field.label}
                  value={answers[field.id] ?? ''}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [field.id]: event.target.value,
                    }))
                  }
                  disabled={busy}
                  helperText={field.helper}
                >
                  {field.choices.map((choice) => (
                    <MenuItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  key={field.id}
                  label={field.label}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={answers[field.id] ?? ''}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [field.id]: event.target.value,
                    }))
                  }
                  disabled={busy}
                  multiline
                  minRows={field.minRows ?? 3}
                  slotProps={{ htmlInput: { maxLength: field.maxLength } }}
                  helperText={field.helper}
                />
              ),
            )}

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
            <Button onClick={close} disabled={busy}>
              {'Cancel'}
            </Button>
            <Button
              variant="contained"
              onClick={() => submit(false)}
              disabled={busy || !ready}
            >
              {busy ? 'Sending…' : 'Send report'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
ReportIssueDialog.displayName = 'ReportIssueDialog'
ReportIssueDialog.aglyn = true

export default ReportIssueDialog
