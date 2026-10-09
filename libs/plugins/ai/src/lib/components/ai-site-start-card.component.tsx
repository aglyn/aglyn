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
  mdiAccount,
  mdiBookOpenPageVariant,
  mdiBriefcaseOutline,
  mdiCalendarHeart,
  mdiCamera,
  mdiClockOutline,
  mdiContentCut,
  mdiCreation,
  mdiDumbbell,
  mdiHandHeart,
  mdiHeartPulse,
  mdiHomeCity,
  mdiMusic,
  mdiPaletteOutline,
  mdiRocketLaunch,
  mdiScaleBalance,
  mdiSchool,
  mdiShopping,
  mdiSilverwareForkKnife,
  mdiViewGridOutline,
  mdiWrench,
  mdiYoga,
  mdiPageLayoutHeaderFooter,
} from '@aglyn/shared-data-mdi'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import { OptionCardGrid } from '@aglyn/shared-ui-jsx/components/option-card-grid.component'
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
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import { alpha, type Theme } from '@mui/material/styles'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import {
  AI_JOB_AUTO_CONFIRM_INPUT,
  AI_SITE_FREE_PAGES,
  AI_SITE_FREE_PAGES_NOTE,
  AI_SITE_SUBMISSION_CHOICES,
  aiFreeCreditsNoneLeftText,
  aiFreeCreditsResetLabel,
  aiFreeSiteCreditRange,
  aiFreeSitePrompt,
  aiSiteCreditRange,
  type AiFreeCreditsLeft,
  aiSitePagesBand,
  type AiSiteSubmissions,
} from '../model/ai-site-job'
import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import {
  AI_CREDITS_CONFIRM_CODE,
  aiCreditRangeText,
  type AiCreditRange,
  type AiCreditsPrompt,
} from '../model/ai-credit-estimate'
import { AiCreditsPromptNotice } from './ai-credits-prompt.component'
import {
  AI_SITE_START_ANSWERS,
  AI_SITE_START_TYPES,
  aiSiteStartBrief,
  aiSiteStartKind,
  aiSiteStartInputs,
  aiSiteStartRefusal,
  type AiSiteStartAnswers,
} from '../model/ai-site-start'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'

/** The icon each kind of site's card shows. */
const AI_SITE_KIND_ICONS: Record<string, string> = {
  business: mdiBriefcaseOutline.path,
  trades: mdiWrench.path,
  professional: mdiScaleBalance.path,
  wellness: mdiHeartPulse.path,
  restaurant: mdiSilverwareForkKnife.path,
  store: mdiShopping.path,
  portfolio: mdiViewGridOutline.path,
  studio: mdiPaletteOutline.path,
  photography: mdiCamera.path,
  blog: mdiBookOpenPageVariant.path,
  events: mdiCalendarHeart.path,
  fitness: mdiDumbbell.path,
  yoga: mdiYoga.path,
  beauty: mdiContentCut.path,
  realestate: mdiHomeCity.path,
  education: mdiSchool.path,
  nonprofit: mdiHandHeart.path,
  music: mdiMusic.path,
  personal: mdiAccount.path,
  landing: mdiRocketLaunch.path,
  'coming-soon': mdiClockOutline.path,
}
import { AiJobFollow } from './ai-job-follow.component'
import { AiModelSelector } from './ai-model-selector.component'
import { useAiModelChoice } from './use-ai-model-choice'
import { aiCreditsBillingHref, aiSiteBuildHref } from './ai-job-links'
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
 * Escape and the close control are DISMISSALS, though, and Skip is a choice
 * (AGL-3660, 2026-10-08). Once anything is typed or picked, a dismissal asks
 * "Leave without your answers?" first, focused on Keep editing, so a stray
 * Escape — the second press after closing the model menu was the one in
 * production — can never trade a brief for the starter. Escape that reached
 * the dialog from a portal it does not contain (a menu, a select's list) is
 * that popup's, and the dialog ignores it.
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
 * ── It builds and publishes for you ──────────────────────────────────────
 *
 * "Plan my site" starts a `site` job, which PLANS first: the pages, their
 * addresses, the navigation, the layout, the contact form and a palette. The
 * guided start confirms its own plan (AGL-3594), so the build follows with no
 * approval to make, and the site is published, indexable, when it is done.
 * The person edits or unpublishes it afterwards.
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

/**
 * The takeover's surface, for its paper, its bar and its footer alike: the
 * console page's own background (AGL-3596). The paper sits at elevation 0,
 * which is what keeps MUI's dark-mode elevation overlay off it.
 */
export const AI_SITE_START_SURFACE_SX = { bgcolor: 'background.default' } as const

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
/**
 * Each part of the guided start links its own section of the Start with AI
 * guide (AGL-3660), so a `?` says what that one group of answers changes.
 */
const START_HELP = {
  choose: pluginDocsHelp('aiStart', {
    anchor: '#how-do-you-want-to-start',
    excerpt:
      'The starter site gives you a ready-made home page to edit. Start with AI asks a few questions, then plans, writes and publishes your pages.',
  }),
  business: pluginDocsHelp('aiStart', {
    anchor: '#your-business',
    excerpt:
      'What kind of site it is picks its style and pages; who it is for is who every page and the contact form are written for.',
  }),
  style: pluginDocsHelp('aiSiteLooks', {
    anchor: '#choose-a-style',
    excerpt:
      'The style decides the look — theme, colors, fonts, buttons — and which pages the site usually has. Every site gets its own variation.',
  }),
  details: pluginDocsHelp('aiStart', {
    anchor: '#details',
    excerpt:
      'Where contact form messages go, how many pages to write, and on paid plans whether to draft a welcome email. All can be changed later.',
  }),
  estimate: pluginDocsHelp('aiCredits', {
    anchor: '#before-a-job-starts',
    excerpt:
      'About what a start like this costs, measured on real builds, and the most it can cost. What it really costs is what each step spends, and you can watch that add up while it runs.',
  }),
}

function SectionLabel({ children, help }: { children: ReactNode; help?: ReturnType<typeof pluginDocsHelp> }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Typography variant="overline" color="text.secondary" component="h2" sx={{ display: 'block' }}>
        {children}
      </Typography>
      {help ? <HelpTip {...help} /> : null}
    </Stack>
  )
}

/**
 * The guided start, as the `hostFirstRun` zone draws it, or reopened on a
 * failed start's own answers (AGL-3596): `initialAnswers` opens it on the
 * questions, filled in, for the person to adjust and start a fresh job.
 */
export type AiSiteStartCardProps = ConsoleHostFirstRunZoneProps & {
  initialAnswers?: AiSiteStartAnswers | null
}

export function AiSiteStartCard({
  hostId,
  orgId,
  orgSlug,
  host,
  startBlank,
  leave,
  initialAnswers = null,
}: AiSiteStartCardProps) {
  const { data: user } = useUser()
  const router = useRouter()
  // Held in a ref so a request reads WHO is signed in, never the identity of
  // the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [verdict, setVerdict] = useState<Verdict>('checking')
  // Read once: a start reopened on its answers stays one while it is open.
  const reopened = useRef(initialAnswers !== null)
  const [step, setStep] = useState<Step>(initialAnswers ? 'describe' : 'choose')
  const [answers, setAnswers] = useState<AiSiteStartAnswers>(initialAnswers ?? AI_SITE_START_ANSWERS)
  const [busy, setBusy] = useState(false)
  // The starter card's own busy state while `startBlank` runs (AGL-3594).
  const [startingStarter, setStartingStarter] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** The site job "Plan my site" started, as the create door answered with it. */
  const [started, setStarted] = useState<AiJobSummary | null>(null)
  // The Free taste's page band (AGL-3594), read off the verdict request.
  const [freeTaste, setFreeTaste] = useState(false)
  // What the Free workspace has left this month (AGL-3660), as the same read
  // the create door refuses on: the less of its own band and its owner's
  // allowance across their Free workspaces. `null` when the route said none.
  const [freeCredits, setFreeCredits] = useState<AiFreeCreditsLeft | null>(null)
  // "Leave without your answers?" (AGL-3660): a dismissal with a brief typed.
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  // The dialog's own root, to tell its Escape from a nested popup's.
  const dialogRef = useRef<HTMLDivElement | null>(null)

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
            const credits = payload?.freeCredits as AiFreeCreditsLeft | undefined
            if (credits && Number.isFinite(credits.left)) setFreeCredits(credits)
            // A reopened start keeps the pages it asked for, within the band.
            setAnswers((current) => ({
              ...current,
              pages: reopened.current ? Math.min(current.pages, AI_SITE_FREE_PAGES.max) : AI_SITE_FREE_PAGES.max,
              welcomeEmail: false,
            }))
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

  // A Free start past what is left asks first (AGL-3722): it is admitted on
  // its measured p90, and one past what is left starts only on "Build what
  // fits" (pausing with Resume where the credits run out), or smaller as the
  // home page alone. The create door asks the same, so a stale dialog meets
  // the prompt there too (`serverPrompt`). Nothing at all left is a dead
  // stop until the credits renew or the workspace upgrades.
  const [serverPrompt, setServerPrompt] = useState<AiCreditsPrompt | null>(null)
  // The door's prompt was for the pages it was asked with.
  useEffect(() => setServerPrompt(null), [answers.pages])
  const prompt = freeTaste ? (aiFreeSitePrompt(freeCredits, answers.pages) ?? serverPrompt) : null
  const noneLeft = freeTaste && freeCredits !== null && freeCredits.left <= 0
  const refusal = aiSiteStartRefusal(answers, { freeTaste })
  const band = aiSitePagesBand(freeTaste)
  // On a paid plan the person picks the model that builds the site (AGL-3660),
  // Auto by default, from the models their plan allows; every step of the job
  // runs on it. A Free workspace builds on the default and is offered none.
  const modelChoice = useAiModelChoice({ orgId, hostId, surface: 'jobs', kind: 'job.page' })
  // A pick remembered from before needs its cost to estimate by; Auto does not,
  // and the list is otherwise read when the picker opens.
  const { load: loadModels, model: rememberedModel } = modelChoice
  useEffect(() => {
    if (!freeTaste && step === 'describe' && rememberedModel) loadModels()
  }, [freeTaste, step, rememberedModel, loadModels])
  const pickedModel = freeTaste ? null : modelChoice.model

  const plan = useCallback(async (options: { creditsConfirmed?: boolean; pages?: number } = {}) => {
    const asked = options.pages ? { ...answers, pages: options.pages } : answers
    if (!orgId || aiSiteStartRefusal(asked, { freeTaste }) || noneLeft) return
    // Past what is left, only an explicit go-ahead starts it.
    if (freeTaste && !options.creditsConfirmed && aiFreeSitePrompt(freeCredits, asked.pages)) return
    if (options.pages) answer({ pages: options.pages })
    setBusy(true)
    setNotice(null)
    setServerPrompt(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId,
          kind: 'site',
          brief: aiSiteStartBrief(asked),
          // The guided start confirms its own plan (AGL-3594): the build
          // follows the plan with no approval to make.
          inputs: { ...aiSiteStartInputs(asked), [AI_JOB_AUTO_CONFIRM_INPUT]: true },
          ...(pickedModel ? { model: pickedModel } : {}),
          ...(options.creditsConfirmed ? { creditsConfirmed: true } : {}),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status === 409 && payload?.code === AI_CREDITS_CONFIRM_CODE && payload?.credits) {
          setServerPrompt(payload.credits as AiCreditsPrompt)
          return
        }
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
  }, [orgId, hostId, answers, answer, freeTaste, freeCredits, noneLeft, orgSlug, host, leave, router, pickedModel])

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
  // Anything the person typed or picked, which a dismissal must not discard
  // silently (AGL-3660). After a job starts there is nothing left to lose.
  const drafted =
    !started &&
    Boolean(answers.siteType.trim() || answers.audience.trim() || answers.kind !== null)
  // Escape and the close control: a dismissal, never a choice. Escape that
  // bubbled here through React from a portal outside this dialog's own DOM is
  // a nested menu's, already handled there, and is not this dialog's to act on.
  const dismiss = (event?: SyntheticEvent | object, reason?: string) => {
    if (reason === 'escapeKeyDown') {
      const target = (event as SyntheticEvent | undefined)?.target
      const root = dialogRef.current
      if (root && target instanceof Node && !root.contains(target)) return
    }
    if (drafted) setConfirmingLeave(true)
    else exit()
  }
  const leaveDraft = () => {
    setConfirmingLeave(false)
    exit()
  }

  // The chosen model's cost against Auto's, as the model list states it.
  const modelMultiplier =
    (pickedModel && modelChoice.options?.options.find((option) => option.id === pickedModel)?.multiplier) || 1
  // What the start is likely to cost and at most (AGL-3722): "About 137
  // credits (up to 282)", the measured figures scaled by the chosen model.
  const scaled = (range: AiCreditRange): AiCreditRange => ({
    likely: Math.round(range.likely * modelMultiplier),
    p90: Math.round(range.p90 * modelMultiplier),
    ceiling: Math.round(range.ceiling * modelMultiplier),
  })
  const estimate = freeTaste
    ? aiFreeSiteCreditRange(answers.pages)
    : scaled(aiSiteCreditRange(answers.pages, { welcomeEmail: answers.welcomeEmail }))
  // A Free start quotes what is LEFT (AGL-3660), shared across the owner's
  // Free workspaces — never the month's whole allowance as if none were spent.
  const estimateText = freeTaste
    ? freeCredits
      ? `${aiCreditRangeText(estimate)}. You have ${freeCredits.left.toLocaleString('en-US')} of your ${freeCredits.total.toLocaleString('en-US')} free AI credits left this month, until ${aiFreeCreditsResetLabel(freeCredits.resetsOn)}`
      : `${aiCreditRangeText(estimate)}, of the ${FREE_AI_TASTE_CREDITS_PER_MONTH} AI credits you get free each month`
    : `${aiCreditRangeText(estimate)}, estimated`

  const choosing = step === 'choose' && !started

  return (
    <Dialog
      open
      fullScreen
      ref={dialogRef}
      onClose={dismiss}
      aria-labelledby={TITLE_ID}
      // The console's own page surface, in both modes. A Dialog's paper sits
      // at elevation 24 by default, and in dark mode MUI lightens an elevated
      // paper with a white overlay, which turned the whole takeover a
      // washed-out gray; the overlay is for floating surfaces, and this one
      // fills the screen, so its paper is flat.
      slotProps={{ paper: { elevation: 0, sx: AI_SITE_START_SURFACE_SX } }}
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
        sx={{ ...AI_SITE_START_SURFACE_SX, borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => dismiss()}
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
                {choosing ? <HelpTip sx={{ float: 'right' }} {...START_HELP.choose} /> : null}
                {choosing
                  ? 'You can change everything later.'
                  : `A few answers and ${PLATFORM_BRAND_NAME} AI plans and writes your pages, then publishes your site.`}
              </Typography>
            </Stack>
            {notice && <Alert severity="info">{notice}</Alert>}
            {step === 'describe' && !started && noneLeft && freeCredits && (
              <Alert
                severity="warning"
                action={
                  orgSlug ? (
                    <Button color="inherit" size="small" href={aiCreditsBillingHref(orgSlug)}>
                      {'Upgrade'}
                    </Button>
                  ) : undefined
                }
              >
                {aiFreeCreditsNoneLeftText(freeCredits.resetsOn)}
              </Alert>
            )}
            {step === 'describe' && !started && !noneLeft && prompt && (
              <AiCreditsPromptNotice
                prompt={prompt}
                noun="site"
                orgSlug={orgSlug}
                busy={busy}
                onBuildWhatFits={() => void plan({ creditsConfirmed: true })}
                onSmaller={() => void plan({ creditsConfirmed: true, pages: 1 })}
              />
            )}
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
                    'Your site is being planned. It is then built and published for you, with ' +
                    'nothing to approve. You can edit or unpublish it afterwards.'
                  }
                  // Full screen: AI jobs opens in the panel this dialog covers.
                  onOpenJobs={exit}
                />
              </Card>
            ) : (
              <>
                <Stack spacing={2} component="section" aria-label="Your business">
                  <SectionLabel help={START_HELP.business}>{'Your business'}</SectionLabel>
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
                <Stack spacing={2} component="section" aria-label="Style">
                  <SectionLabel help={START_HELP.style}>{'Style'}</SectionLabel>
                  <Typography variant="body2" color="text.secondary">
                    {answers.kind
                      ? 'This decides how your site looks and which pages it usually has.'
                      : 'Picked from your answer above. Choose another to change how your site looks and which pages it usually has.'}
                  </Typography>
                  <OptionCardGrid
                    label="Style of site"
                    options={AI_SITE_KINDS.map((kind) => ({
                      id: kind.id,
                      title: kind.label,
                      description: kind.blurb,
                      icon: AI_SITE_KIND_ICONS[kind.id],
                    }))}
                    value={aiSiteStartKind(answers).id}
                    onChange={(kind) => answer({ kind })}
                  />
                </Stack>
                <Stack spacing={2} component="section" aria-label="Details">
                  <SectionLabel help={START_HELP.details}>{'Details'}</SectionLabel>
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
            ...AI_SITE_START_SURFACE_SX,
          }}
        >
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mr: 'auto', minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {`${estimateText}.`}
            </Typography>
            <HelpTip {...START_HELP.estimate} ariaLabel="How the estimate works" />
          </Stack>
          {refusal && (
            <Typography variant="body2" color="text.secondary">
              {refusal}
            </Typography>
          )}
          {!freeTaste && <AiModelSelector choice={modelChoice} disabled={busy} />}
          <Button onClick={() => setStep('choose')}>{'Back'}</Button>
          <Button
            variant="contained"
            size="large"
            disabled={busy || Boolean(refusal) || Boolean(prompt) || noneLeft}
            onClick={() => void plan()}
            startIcon={<MdiIcon path={mdiCreation.path} />}
          >
            {busy ? 'Starting…' : 'Plan my site'}
          </Button>
        </DialogActions>
      )}
      <Dialog
        open={confirmingLeave}
        onClose={() => setConfirmingLeave(false)}
        aria-labelledby={`${TITLE_ID}-leave`}
        aria-describedby={`${TITLE_ID}-leave-text`}
        maxWidth="xs"
      >
        <DialogTitle id={`${TITLE_ID}-leave`}>{'Leave without your answers?'}</DialogTitle>
        <DialogContent>
          <DialogContentText id={`${TITLE_ID}-leave-text`}>
            {'What you typed is not saved. Leaving starts your site from the starter site instead.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={leaveDraft}>
            {'Leave and start blank'}
          </Button>
          <Button variant="contained" autoFocus onClick={() => setConfirmingLeave(false)}>
            {'Keep editing'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}

export default AiSiteStartCard
