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
import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import type { ConsoleHostFirstRunZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import {
  mdiCheckCircle,
  mdiCreation,
  mdiInformationOutline,
  mdiPageLayoutHeaderFooter,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha, type Theme } from '@mui/material/styles'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  AI_JOB_AUTO_CONFIRM_INPUT,
  AI_SITE_FREE_PAGES,
  AI_SITE_FREE_PAGES_NOTE,
  AI_SITE_SUBMISSION_CHOICES,
  aiFreeSiteCreditEstimate,
  aiSiteCreditEstimate,
  aiSitePagesBand,
  type AiSiteSubmissions,
} from '../model/ai-site-job'
import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import {
  AI_SITE_START_ANSWERS,
  AI_SITE_START_EXAMPLES,
  AI_SITE_START_TYPES,
  aiSiteStartBrief,
  aiSiteStartInputs,
  aiSiteStartRefusal,
  type AiSiteStartAnswers,
} from '../model/ai-site-start'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AiJobFollow } from './ai-job-follow.component'
import { aiSiteBuildHref } from './ai-job-links'
import { publishAiJob } from './ai-jobs-store'

/**
 * The guided start (AGL-2918), on the `hostFirstRun` zone of the page a newly
 * created site lands on: a choice, a few questions, and the site scaffold they
 * become.
 *
 * ── Two steps (AGL-3594) ─────────────────────────────────────────────────
 *
 * Step 1 asks how to start, as two equal cards: the starter site — a
 * ready-made home page with a header and footer — or AI. The starter card is
 * the zone's `startBlank`, which gives a site born for the guided start the
 * starter every other new site is born with. The AI card moves to step 2, the
 * questions, which have a Back to step 1.
 *
 * ── A full screen dialog, and therefore three ways out ───────────────────
 *
 * The questions take the whole screen, which is the only presentation that
 * gets them read — but a surface that takes the screen and cannot be left is
 * a funnel, so leaving is drawn first and works three ways on both steps:
 *
 *  - the close control at the start of the header,
 *  - "Skip" at the end of it, named "Skip and start blank",
 *  - Escape, which `Dialog` reports through `onClose`.
 *
 * Before a job is started all three are the zone's own `startBlank`: the
 * starter site, and no job, no draft, no record of a site half begun. After,
 * they close through `leave`, and the job builds the site.
 *
 * The header is the dialog's own chrome rather than part of its body, so the
 * way out cannot be scrolled off, and it is never disabled — least of all
 * while a request is in flight, which is the moment a person most wants it.
 * Nothing is focused ahead of the dialog's own frame, so the first thing a
 * keyboard reaches is the close control.
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
 * "Plan my site" starts a `site` job, which PLANS first: the pages, their
 * addresses, the navigation, the layout, the contact form and a palette, with
 * an estimated cost beside the button that confirms it. Nothing is built
 * until the person confirms that plan, and everything it then builds is an
 * unpublished draft.
 *
 * ── It stays with the job (AGL-3593) ─────────────────────────────────────
 *
 * Once the job exists the dialog follows it live — planning, the plan with
 * its Confirm, building, then the draft pages to open — so a person never has
 * to leave it to get their site built. "Open AI jobs" follows the job in the
 * Assist panel instead; it leaves the guided start the way every other exit
 * does, because the dialog covers the panel it opens.
 */

type Verdict = 'checking' | 'ready' | 'hidden'

type Step = 'choose' | 'describe'

/** Labels the dialog for a reader, from its own heading. */
const TITLE_ID = 'ai-site-start-title'

/** The two steps, as the indicator under the header names them. */
const STEP_LABELS = ['Choose', 'Describe'] as const

/** The soft round badge an icon sits in, in its accent's tint. */
function IconBadge({ accent, children }: { accent: 'primary' | 'secondary'; children: ReactNode }) {
  return (
    <Box
      aria-hidden
      sx={(theme: Theme) => ({
        width: theme.spacing(9),
        height: theme.spacing(9),
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: alpha(theme.palette[accent].main, theme.palette.mode === 'dark' ? 0.24 : 0.12),
        color: `${accent}.main`,
        fontSize: theme.spacing(5.5),
      })}
    >
      {children}
    </Box>
  )
}

/**
 * One way to start, as a card the whole of which is the button. Its accessible
 * name is its title; its description describes it.
 */
function ChoiceCard({
  accent,
  icon,
  iconId,
  title,
  description,
  busy = false,
  onChoose,
  children,
}: {
  accent: 'primary' | 'secondary'
  icon: string
  /** Names the icon for a reader of the markup; the icon itself is decorative. */
  iconId: string
  title: string
  description: string
  busy?: boolean
  onChoose: () => void
  children?: ReactNode
}) {
  const id = useId()
  return (
    <Card
      variant="outlined"
      sx={(theme: Theme) => ({
        borderRadius: 2,
        height: '100%',
        transition: theme.transitions.create(['border-color', 'box-shadow', 'transform'], {
          duration: theme.transitions.duration.shorter,
        }),
        '&:hover, &:focus-within': {
          borderColor: `${accent}.main`,
          boxShadow: theme.shadows[4],
          transform: `translateY(-${theme.spacing(0.25)})`,
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover, &:focus-within': { transform: 'none' },
        },
      })}
    >
      <CardActionArea
        onClick={onChoose}
        disabled={busy}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        aria-busy={busy || undefined}
        sx={{ height: '100%', p: { xs: 3, sm: 4 } }}
      >
        <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
          <IconBadge accent={accent}>
            {busy ? (
              <CircularProgress size="1em" color={accent} aria-label={`${title}…`} />
            ) : (
              <MdiIcon path={icon} data-icon={iconId} aria-hidden />
            )}
          </IconBadge>
          <Typography id={`${id}-title`} variant="h6" component="h2">
            {title}
          </Typography>
          <Typography id={`${id}-description`} variant="body2" color="text.secondary">
            {description}
          </Typography>
          {children}
        </Stack>
      </CardActionArea>
    </Card>
  )
}

/** A small label above a group of questions. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" color="text.secondary" component="h2" sx={{ display: 'block' }}>
      {children}
    </Typography>
  )
}

export function AiSiteStartCard({
  hostId,
  orgId,
  orgSlug,
  host,
  startBlank,
  leave,
}: ConsoleHostFirstRunZoneProps) {
  const { data: user } = useUser()
  const router = useRouter()
  // Held in a ref so a request reads WHO is signed in, never the identity of
  // the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [verdict, setVerdict] = useState<Verdict>('checking')
  const [step, setStep] = useState<Step>('choose')
  const [answers, setAnswers] = useState<AiSiteStartAnswers>(AI_SITE_START_ANSWERS)
  const [busy, setBusy] = useState(false)
  // The starter card's own busy state while `startBlank` runs (AGL-3594).
  const [startingStarter, setStartingStarter] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** The site job "Plan my site" started, as the create door answered with it. */
  const [started, setStarted] = useState<AiJobSummary | null>(null)
  // The Free taste's page band (AGL-3594), read off the verdict request.
  const [freeTaste, setFreeTaste] = useState(false)

  useEffect(() => {
    if (!orgId || !uid) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=1`,
        )
        const payload = response.ok ? await response.json().catch(() => null) : null
        if (active) {
          if (payload?.freeTaste === true) {
            setFreeTaste(true)
            setAnswers((current) => ({ ...current, pages: AI_SITE_FREE_PAGES.max, welcomeEmail: false }))
          }
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

  const refusal = aiSiteStartRefusal(answers, { freeTaste })
  const band = aiSitePagesBand(freeTaste)

  const plan = useCallback(async () => {
    if (!orgId || aiSiteStartRefusal(answers, { freeTaste })) return
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
          // The guided start confirms its own plan (AGL-3594): the build
          // follows the plan with no approval to make.
          inputs: { ...aiSiteStartInputs(answers), [AI_JOB_AUTO_CONFIRM_INPUT]: true },
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
      const created = (payload?.job as AiJobSummary | undefined) ?? null
      if (!created) {
        setNotice('The site could not be started. Try again.')
        return
      }
      // The indicator and the launcher count it from the moment it exists.
      publishAiJob(created)
      // Where the next step is (AGL-3594): the site's "Building your site"
      // page for this job. The zone closes without the starter first, so the
      // setup page does not ask again behind it.
      const href = aiSiteBuildHref(orgSlug, host, created.id)
      if (href) {
        ;(leave ?? (() => undefined))()
        router.push(href)
        return
      }
      setStarted(created)
    } catch {
      setNotice('The site could not be started. Try again.')
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, answers, freeTaste, orgSlug, host, leave, router])

  const chooseStarter = useCallback(() => {
    setStartingStarter(true)
    trackEvent('site_start_choice', { choice: 'starter' })
    startBlank()
  }, [startBlank])

  const chooseAi = useCallback(() => {
    trackEvent('site_start_choice', { choice: 'ai' })
    setStep('describe')
  }, [])

  if (verdict !== 'ready') return null

  // Before a job is started every way out is the blank site, which writes the
  // starter (AGL-3594); after, it only closes — the job builds the site.
  const exit = started ? (leave ?? startBlank) : startBlank

  const estimate = freeTaste
    ? aiFreeSiteCreditEstimate(answers.pages)
    : aiSiteCreditEstimate(answers.pages, {
        welcomeEmail: answers.welcomeEmail,
      })
  const estimateText = freeTaste
    ? `Up to about ${estimate.toLocaleString('en-US')} of the ${FREE_AI_TASTE_CREDITS_PER_MONTH} AI credits your Free workspace has each month`
    : `About ${estimate.toLocaleString('en-US')} credits, estimated`

  const choosing = step === 'choose' && !started

  return (
    <Dialog
      open
      fullScreen
      onClose={exit}
      aria-labelledby={TITLE_ID}
      slotProps={{ paper: { sx: { bgcolor: 'background.paper' } } }}
    >
      {/*
        The way out, before anything it is a way out of: a slim header on the
        paper surface. On a narrow screen it is the TITLE that gives way, so
        the exits keep their words at every width.
      */}
      <AppBar
        position="relative"
        color="inherit"
        elevation={0}
        enableColorOnDark
        sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <IconButton
            edge="start"
            color="inherit"
            onClick={exit}
            aria-label="Close the guided start"
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
          </IconButton>
          <Typography
            id={TITLE_ID}
            variant="subtitle1"
            component="div"
            noWrap
            sx={{ textOverflow: 'ellipsis', flex: 1 }}
          >
            {'Start your site'}
          </Typography>
          <Button color="inherit" onClick={exit} aria-label={started ? 'Close' : 'Skip and start blank'}>
            {started ? 'Close' : 'Skip'}
          </Button>
        </Toolbar>
      </AppBar>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Container maxWidth={choosing ? 'md' : 'sm'} disableGutters sx={{ py: { xs: 3, sm: 5 } }}>
          <Stack spacing={4}>
            <Stepper
              activeStep={choosing ? 0 : 1}
              aria-label={choosing ? 'Step 1 of 2' : 'Step 2 of 2'}
              sx={{ maxWidth: (theme: Theme) => theme.spacing(40), width: '100%', mx: 'auto' }}
            >
              {STEP_LABELS.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
            <Stack spacing={1} sx={{ textAlign: choosing ? 'center' : 'left' }}>
              <Typography variant="h4" component="h1">
                {choosing ? 'How do you want to start?' : 'Tell us about your site'}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {choosing
                  ? 'You can change everything later.'
                  : `A few answers and ${PLATFORM_BRAND_NAME} AI plans your pages. Nothing is published until you say so.`}
              </Typography>
            </Stack>
            {notice && <Alert severity="info">{notice}</Alert>}
            {choosing ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 3,
                }}
              >
                <ChoiceCard
                  accent="secondary"
                  icon={mdiPageLayoutHeaderFooter.path}
                  iconId="page-layout-header-footer"
                  title="Start from the starter site"
                  description="A ready-made home page with a header, footer and contact form you can edit."
                  busy={startingStarter}
                  onChoose={chooseStarter}
                />
                <ChoiceCard
                  accent="primary"
                  icon={mdiCreation.path}
                  iconId="creation"
                  title="Start with AI"
                  description={`Answer a few questions and ${PLATFORM_BRAND_NAME} AI plans your pages.`}
                  onChoose={chooseAi}
                >
                  <Chip size="small" color="primary" label="Recommended" />
                  {freeTaste && (
                    <Typography variant="caption" color="text.secondary">
                      {`Up to ${AI_SITE_FREE_PAGES.max} pages on the Free plan`}
                    </Typography>
                  )}
                </ChoiceCard>
              </Box>
            ) : started && orgId ? (
              <Card variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 } }}>
                <AiJobFollow
                  job={started}
                  orgId={orgId}
                  orgSlug={orgSlug}
                  user={user}
                  intro={
                    'Your site is being planned. Review the plan here or in AI jobs, and confirm ' +
                    'it to build — nothing is built, and nothing is published, until you do.'
                  }
                  // Full screen: AI jobs opens in the panel this dialog covers.
                  onOpenJobs={exit}
                />
              </Card>
            ) : (
              <>
                <Stack spacing={2} component="section" aria-label="Your business">
                  <SectionLabel>{'Your business'}</SectionLabel>
                  <TextField
                    fullWidth
                    required
                    label="What kind of site are you creating?"
                    placeholder="a neighborhood dog groomer that takes bookings"
                    value={answers.siteType}
                    onChange={(event) => answer({ siteType: event.target.value })}
                    helperText="A few words is enough, or pick one below."
                  />
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {AI_SITE_START_TYPES.map((type) => (
                      <Chip
                        key={type}
                        label={type}
                        size="small"
                        color={answers.siteType === type ? 'primary' : 'default'}
                        variant={answers.siteType === type ? 'filled' : 'outlined'}
                        onClick={() => answer({ siteType: type })}
                      />
                    ))}
                  </Box>
                  <TextField
                    fullWidth
                    label="Who is it for?"
                    placeholder="local dog owners who want a regular groom booked online"
                    value={answers.audience}
                    onChange={(event) => answer({ audience: event.target.value })}
                    helperText="Optional. It narrows who the pages are written for."
                  />
                </Stack>
                <Stack spacing={2} component="section" aria-label="Look & layout">
                  <SectionLabel>{'Look & layout'}</SectionLabel>
                  <Typography variant="body2" color="text.secondary">
                    {'Optional. Picking one steers the shape of the site, not its words.'}
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                      gap: 2,
                    }}
                  >
                    {AI_SITE_START_EXAMPLES.map((example) => {
                      const selected = answers.example === example.id
                      return (
                        <Card
                          key={example.id}
                          variant="outlined"
                          sx={(theme: Theme) => ({
                            borderRadius: 2,
                            borderColor: selected ? 'primary.main' : 'divider',
                            bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                          })}
                        >
                          <CardActionArea
                            aria-pressed={selected}
                            aria-label={`${example.label} — ${example.blurb}`}
                            onClick={() => answer({ example: selected ? null : example.id })}
                            sx={{ p: 2, height: '100%' }}
                          >
                            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="subtitle2">{example.label}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {example.blurb}
                                </Typography>
                              </Box>
                              {selected && (
                                <Box sx={{ color: 'primary.main', display: 'flex' }} aria-hidden>
                                  <MdiIcon path={mdiCheckCircle.path} />
                                </Box>
                              )}
                            </Stack>
                          </CardActionArea>
                        </Card>
                      )
                    })}
                  </Box>
                </Stack>
                <Stack spacing={2} component="section" aria-label="Details">
                  <SectionLabel>{'Details'}</SectionLabel>
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
                    {AI_SITE_SUBMISSION_CHOICES.map((option) => (
                      <MenuItem key={option.id} value={option.id}>
                        {`${option.label} — ${option.blurb}`}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      select
                      fullWidth
                      label="Pages"
                      value={answers.pages}
                      onChange={(event) => answer({ pages: Number(event.target.value) })}
                      helperText={freeTaste ? AI_SITE_FREE_PAGES_NOTE : undefined}
                    >
                      {Array.from(
                        { length: band.max - band.min + 1 },
                        (_, index) => band.min + index,
                      ).map((count) => (
                        <MenuItem key={count} value={count}>
                          {count}
                        </MenuItem>
                      ))}
                    </TextField>
                    {!freeTaste && (
                      <TextField
                        select
                        fullWidth
                        label="Welcome email"
                        value={answers.welcomeEmail ? 'yes' : 'no'}
                        onChange={(event) => answer({ welcomeEmail: event.target.value === 'yes' })}
                      >
                        <MenuItem value="yes">{'Draft one'}</MenuItem>
                        <MenuItem value="no">{'No'}</MenuItem>
                      </TextField>
                    )}
                  </Stack>
                </Stack>
              </>
            )}
          </Stack>
        </Container>
      </DialogContent>
      {step === 'describe' && !started && (
        /* The footer stays put while the questions scroll. It wraps, because
           the estimate, the reason and the buttons are wider than a phone. */
        <DialogActions
          sx={{
            px: { xs: 2, sm: 3 },
            py: 2,
            flexWrap: 'wrap',
            rowGap: 1,
            columnGap: 2,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mr: 'auto', minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {`${estimateText}.`}
            </Typography>
            <Tooltip title="What it really costs is what each step spends, and you can watch that add up while it runs.">
              <Box
                component="span"
                tabIndex={0}
                aria-label="How the estimate works"
                sx={{ display: 'inline-flex', color: 'text.secondary' }}
              >
                <MdiIcon path={mdiInformationOutline.path} fontSize="small" />
              </Box>
            </Tooltip>
          </Stack>
          {refusal && (
            <Typography variant="body2" color="text.secondary">
              {refusal}
            </Typography>
          )}
          <Button onClick={() => setStep('choose')}>{'Back'}</Button>
          <Button
            variant="contained"
            size="large"
            disabled={busy || Boolean(refusal)}
            onClick={plan}
            startIcon={<MdiIcon path={mdiCreation.path} />}
          >
            {busy ? 'Starting…' : 'Plan my site'}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}

export default AiSiteStartCard
