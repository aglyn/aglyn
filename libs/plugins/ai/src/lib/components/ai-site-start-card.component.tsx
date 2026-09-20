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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import type { ConsoleHostFirstRunZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AI_SITE_PAGES,
  aiSiteCreditEstimate,
  type AiSiteSubmissions,
} from '../model/ai-site-job'
import {
  AI_SITE_START_ANSWERS,
  AI_SITE_START_EXAMPLES,
  AI_SITE_START_SUBMISSIONS,
  AI_SITE_START_TYPES,
  aiSiteStartBrief,
  aiSiteStartInputs,
  aiSiteStartRefusal,
  type AiSiteStartAnswers,
} from '../model/ai-site-start'

/**
 * The guided start (AGL-2918), on the `hostFirstRun` zone of the page a newly
 * created site lands on: a few questions, and the site scaffold they become.
 *
 * ── A full screen dialog, and therefore three ways out ───────────────────
 *
 * The questions take the whole screen, which is the only presentation that
 * gets them read — but a surface that takes the screen and cannot be left is
 * a funnel, so leaving is drawn first and works three ways:
 *
 *  - the close control at the start of the app bar,
 *  - "Skip and start blank" beside it, at the end of the same bar,
 *  - Escape, which `Dialog` reports through `onClose`.
 *
 * All three are the zone's own `startBlank` and nothing else: no job, no
 * draft, no record of a site half begun. Dismissing is LEAVING, not a pause
 * that could be returned to — the person keeps the blank site they already
 * have, on the page under the dialog, and the site does not ask again.
 *
 * The bar carrying them is the dialog's own chrome rather than part of its
 * body, so `scroll="paper"` keeps it in place while the questions scroll: the
 * way out cannot be scrolled off, and it is never disabled — least of all
 * while a request is in flight, which is the moment a person most wants it.
 *
 * Nothing is focused ahead of the dialog's own frame, so the first thing a
 * keyboard reaches is the close control rather than the first question.
 *
 * ── It is absent until the route has answered ────────────────────────────
 *
 * The dialog covers the page, so being drawn on a guess is worse here than it
 * is for a card: it would be a takeover every flag-off workspace watches
 * disappear. Nothing renders at all — no `Dialog`, no portal — until the jobs
 * route has admitted this workspace, and a 404, a 403 or an unreachable route
 * is this widget staying absent and the ordinary blank page being all there
 * is. That the widget is mounted is itself the last of a stack of gates: the
 * shell held the plan's `aiGenerative` entitlement, the site's AI switch and
 * the reader's `ai.generate` first. A lockdown is the start door's to say,
 * here, in its own words.
 *
 * ── It asks, it does not build ───────────────────────────────────────────
 *
 * Confirming starts a `site` job, which PLANS first: the pages, their
 * addresses, the navigation, the layout, the contact form and a palette, with
 * an estimated cost beside the button that confirms it. Nothing is built
 * until the person confirms that plan in AI jobs, and everything it then
 * builds is an unpublished draft.
 */

type Verdict = 'checking' | 'ready' | 'hidden'

/** Labels the dialog for a reader, from its own heading. */
const TITLE_ID = 'ai-site-start-title'

export function AiSiteStartCard({
  hostId,
  orgId,
  startBlank,
}: ConsoleHostFirstRunZoneProps) {
  const { data: user } = useUser()
  // Held in a ref so a request reads WHO is signed in, never the identity of
  // the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [verdict, setVerdict] = useState<Verdict>('checking')
  const [answers, setAnswers] = useState<AiSiteStartAnswers>(AI_SITE_START_ANSWERS)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!orgId || !uid) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=1`,
        )
        if (active) {
          setVerdict(response.status === 404 || response.status === 403 ? 'hidden' : 'ready')
        }
      } catch {
        if (active) setVerdict('hidden')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, uid])

  const answer = useCallback(
    (patch: Partial<AiSiteStartAnswers>) =>
      setAnswers((current) => ({ ...current, ...patch })),
    [],
  )

  const refusal = aiSiteStartRefusal(answers)

  const plan = useCallback(async () => {
    if (!orgId || aiSiteStartRefusal(answers)) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId,
          kind: 'site',
          brief: aiSiteStartBrief(answers),
          inputs: aiSiteStartInputs(answers),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(
          locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The site could not be started. Try again.'),
        )
        return
      }
      setStarted(true)
    } catch {
      setNotice('The site could not be started. Try again.')
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, answers])

  if (verdict !== 'ready') return null

  const estimate = aiSiteCreditEstimate(answers.pages, {
    welcomeEmail: answers.welcomeEmail,
  })

  return (
    <Dialog open fullScreen onClose={startBlank} aria-labelledby={TITLE_ID}>
      {/*
        The way out, before anything it is a way out of. On a narrow screen it
        is the HEADING that gives way — the bar's one elastic element, so the
        exit keeps its words at every width rather than collapsing into an
        icon somebody has to recognize.

        Shared app-bar treatment (AGL-704) — see the console's
        secondary-app-bar; enableColorOnDark is required or AppBar substitutes
        its own dark-mode colour.
      */}
      <AppBar position="relative" color="surface" enableColorOnDark>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={startBlank}
            aria-label="Close the guided start"
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
          </IconButton>
          <Typography
            id={TITLE_ID}
            variant="h6"
            component="div"
            noWrap
            sx={{ textOverflow: 'ellipsis', ml: 2, flex: 1 }}
          >
            {'Start this site with AI'}
          </Typography>
          <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
          <Button color="inherit" onClick={startBlank}>
            {started ? 'Close' : 'Skip and start blank'}
          </Button>
        </Toolbar>
      </AppBar>
      <DialogContent>
        {/* A line of questions is read at a column's width, not a screen's. */}
        <Container maxWidth="md" disableGutters sx={{ py: 2 }}>
          <Stack spacing={3}>
            <Typography variant="body2" color="text.secondary">
              {'Answer a few questions and AI plans the whole site — its pages, its ' +
                'navigation, its layout and a contact form. Nothing is built until you ' +
                'confirm the plan, and everything it builds is an unpublished draft.'}
            </Typography>
            {notice && <Alert severity="info">{notice}</Alert>}
            {started ? (
              <Alert severity="success">
                {'Your site is being planned. Open AI jobs in the Assist panel to read the plan ' +
                  'and confirm it — nothing is built, and nothing is published, until you do.'}
              </Alert>
            ) : (
              <>
                <Box>
                  <TextField
                    fullWidth
                    label="What kind of site are you creating?"
                    placeholder="a neighborhood dog groomer that takes bookings"
                    value={answers.siteType}
                    onChange={(event) => answer({ siteType: event.target.value })}
                  />
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 1, rowGap: 1 }}>
                    {AI_SITE_START_TYPES.map((type) => (
                      <Chip
                        key={type}
                        label={type}
                        size="small"
                        variant={answers.siteType === type ? 'filled' : 'outlined'}
                        onClick={() => answer({ siteType: type })}
                      />
                    ))}
                  </Stack>
                </Box>
                <TextField
                  fullWidth
                  label="Who is it for?"
                  placeholder="local dog owners who want a regular groom booked online"
                  value={answers.audience}
                  onChange={(event) => answer({ audience: event.target.value })}
                  helperText="Optional. It narrows who the pages are written for."
                />
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    {'Which of these do you like?'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {'Optional. Picking one steers the shape of the site, not its words.'}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                    {AI_SITE_START_EXAMPLES.map((example) => (
                      <Chip
                        key={example.id}
                        label={`${example.label} — ${example.blurb}`}
                        variant={answers.example === example.id ? 'filled' : 'outlined'}
                        onClick={() =>
                          answer({
                            example: answers.example === example.id ? null : example.id,
                          })
                        }
                      />
                    ))}
                  </Stack>
                </Box>
                {/*
                  The one setting a new site owner has to make, asked where
                  they are already answering: a contact form nobody routed
                  files its messages somewhere the person has not looked.
                */}
                <TextField
                  select
                  fullWidth
                  label="Where do form submissions go?"
                  value={answers.submissions}
                  onChange={(event) =>
                    answer({ submissions: event.target.value as AiSiteSubmissions })
                  }
                  helperText="You can change this on the form itself afterwards."
                >
                  {AI_SITE_START_SUBMISSIONS.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {`${option.label} — ${option.blurb}`}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    select
                    label="Pages"
                    value={answers.pages}
                    onChange={(event) => answer({ pages: Number(event.target.value) })}
                    sx={{ minWidth: 160 }}
                  >
                    {Array.from(
                      { length: AI_SITE_PAGES.max - AI_SITE_PAGES.min + 1 },
                      (_, index) => AI_SITE_PAGES.min + index,
                    ).map((count) => (
                      <MenuItem key={count} value={count}>
                        {count}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="Welcome email"
                    value={answers.welcomeEmail ? 'yes' : 'no'}
                    onChange={(event) => answer({ welcomeEmail: event.target.value === 'yes' })}
                    sx={{ minWidth: 160 }}
                  >
                    <MenuItem value="yes">{'Draft one'}</MenuItem>
                    <MenuItem value="no">{'No'}</MenuItem>
                  </TextField>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {`About ${estimate.toLocaleString('en-US')} credits, estimated. What it really ` +
                    'costs is what each step spends, and you can watch that add up while it runs.'}
                </Typography>
              </>
            )}
          </Stack>
        </Container>
      </DialogContent>
      {!started && (
        /* Wraps, because the reason and the button together are wider than a
           phone: on one line the reason would push the button off the edge. */
        <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', rowGap: 1 }}>
          {refusal && (
            <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }}>
              {refusal}
            </Typography>
          )}
          <Button variant="contained" disabled={busy || Boolean(refusal)} onClick={plan}>
            {busy ? 'Starting…' : 'Plan my site'}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}

export default AiSiteStartCard
