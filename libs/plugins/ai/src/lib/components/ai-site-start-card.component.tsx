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
import { mdiCreation, mdiPageLayoutHeaderFooter, mdiWebSync } from '@aglyn/shared-data-mdi'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import BlockedControl from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
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
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { alpha, useTheme, type Theme } from '@mui/material/styles'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import {
  AI_JOB_AUTO_CONFIRM_INPUT,
  AI_SITE_FREE_PAGES,
  aiFreeCreditsNoneLeftText,
  aiFreeCreditsResetLabel,
  aiFreeSiteCreditRange,
  aiFreeSitePrompt,
  aiSiteCreditRange,
  type AiFreeCreditsLeft,
  aiSitePagesBand,
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
  aiSiteStartAnswersFromClientBuild,
  aiSiteStartBrief,
  aiSiteStartClientBrief,
  aiSiteStartClientInputs,
  aiSiteStartClientNote,
  aiSiteStartExtrasGiven,
  aiSiteStartInputs,
  aiSiteStartRefusal,
  type AiSiteStartAnswers,
} from '../model/ai-site-start'
import { aiSiteInspirationLimit } from '../model/ai-site-inspiration'
import {
  aiSiteStartFieldErrors,
  aiSiteStartFirstInvalidStep,
  aiSiteStartNextStep,
  aiSiteStartPreviousStep,
  aiSiteStartStepErrors,
  aiSiteStartStepIndex,
  AI_SITE_START_STEPS,
  AI_SITE_START_STEP_FIELDS,
  type AiSiteStartField,
  type AiSiteStartStep,
} from '../model/ai-site-start-steps'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { aiSiteKindOfInputs } from '../model/ai-site-kinds'
import { aiSiteStartClickOf, useAiSiteStartTracking } from './ai-site-start-tracking'
import {
  AudienceStep,
  DetailsStep,
  KindStep,
  MoreDetails,
  ReviewStep,
  StartProgress,
  StepHelp,
  StyleStep,
} from './ai-site-start-steps.component'
import { AiJobFollow } from './ai-job-follow.component'
import { AiModelSelector } from './ai-model-selector.component'
import { useAiModelChoice } from './use-ai-model-choice'
import { aiCreditsBillingHref, aiSiteBuildHref } from './ai-job-links'
import { publishAiJob } from './ai-jobs-store'
import { clearAiSiteStartAnswers, readAiSiteStartAnswers } from '../model/ai-site-start-handoff'
import { AiSiteImportStart } from './ai-site-import-start.component'
import { aiSiteImportOfferOf, type AiSiteImportAvailability } from '../model/ai-site-import-view'

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
 * starter every other new site is born with. The AI card moves on to the
 * questions, one decision a step (AGL-3898; see {@link AiSiteStartCard}).
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
 * ── Or before the site exists (AGL-3761) ─────────────────────────────────
 *
 * "Create site" draws this straight away, with the zone's `pendingSite` and
 * no site. Step 1 then asks the site's name and address (the shell's own
 * fields) above the two cards, and the site is created only by a choice that
 * needs one: the starter card or Skip (`startBlank`, which creates it with the
 * starter), or Plan my site, which creates it and then starts the job on it.
 * The close control and Escape create nothing there: they are `leave`. If the
 * site was created and its job could not start, the site is a real one, and
 * every way out gives it the starter as above, so none is left empty.
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

/** Labels the dialog for a reader, from its own heading. */
const TITLE_ID = 'ai-site-start-title'

/**
 * The takeover's surface, for its paper, its bar and its footer alike: the
 * console page's own background (AGL-3596). The paper sits at elevation 0,
 * which is what keeps MUI's dark-mode elevation overlay off it.
 */
export const AI_SITE_START_SURFACE_SX = { bgcolor: 'background.default' } as const

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
  blocked = null,
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
  /**
   * Why the card cannot be chosen here, when the workspace can change that
   * (AGL-3976): drawn disabled with the reason, never hidden.
   */
  blocked?: string | null
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
      <BlockedControl blocked={Boolean(blocked)} reason={blocked ?? ''} fullWidth>
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
      </BlockedControl>
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

/**
 * The questions are one decision a step (AGL-3898): what kind of site it is
 * (typed, or a card), who it is for, the style (cards that show each one,
 * "Pick for me" first and picked), the details, and a review that plans the
 * site (`ai-site-start-steps.component.tsx`). Back and Next keep every
 * answer; Enter in a text answer is Next; each step's heading takes the focus
 * when it is drawn; a step that cannot go forward says why beside the field
 * and puts the cursor in it. The answers are the same object the single form
 * held, and only the review turns them into the job, through the same
 * `aiSiteStartBrief` and `aiSiteStartInputs`. Each step is reported as a
 * funnel, with where people struggle (`ai-site-start-tracking.ts`).
 */
export function AiSiteStartCard({
  hostId,
  orgId,
  orgSlug,
  host,
  startBlank,
  leave,
  pendingSite,
  clientBuild,
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
  // "Start again" on a start whose empty site was removed (AGL-3936) opens
  // Create site with that start's answers: read once, and only here, where
  // the site does not exist yet. It opens on the first question, where the
  // site's name and address are asked, with every answer after it filled in.
  const [handedOff] = useState(() => (pendingSite && !initialAnswers ? readAiSiteStartAnswers() : null))
  // A site staff are building for a client (AGL-3958): the intake answered
  // the questions already, so the start opens on the review with them, and
  // stays on this screen once it has started. Read once, like a reopened start.
  const [clientAnswers] = useState(() =>
    clientBuild && !initialAnswers ? aiSiteStartAnswersFromClientBuild(clientBuild.intake) : null,
  )
  const [clientIntake] = useState(() => clientBuild?.intake ?? null)
  const clientBuildRef = useRef(clientBuild)
  clientBuildRef.current = clientBuild
  // Read once: a start reopened on its answers stays one while it is open.
  const reopened = useRef(initialAnswers !== null || handedOff !== null || clientAnswers !== null)
  // A start reopened on its answers opens on the review, every answer there to change.
  const [step, setStep] = useState<AiSiteStartStep>(initialAnswers || clientAnswers ? 'review' : 'choose')
  const [answers, setAnswers] = useState<AiSiteStartAnswers>(
    initialAnswers ?? clientAnswers ?? handedOff ?? AI_SITE_START_ANSWERS,
  )
  // The steps whose reasons not to go forward are shown: the ones Next was refused on.
  const [checked, setChecked] = useState<ReadonlySet<AiSiteStartStep>>(() => new Set())
  // A step opened from the review's Edit goes back to the review on Next.
  const [returnTo, setReturnTo] = useState<AiSiteStartStep | null>(null)
  // Each step's heading takes the focus when the step changes, never on the first draw.
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const drawnStep = useRef<AiSiteStartStep | null>(null)
  const fieldRefs = useRef<Partial<Record<AiSiteStartField, HTMLInputElement | null>>>({})
  const theme = useTheme()
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
  const [busy, setBusy] = useState(false)
  // The starter card's own busy state while `startBlank` runs (AGL-3594).
  const [startingStarter, setStartingStarter] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** The site job "Plan my site" started, as the create door answered with it. */
  const [started, setStarted] = useState<AiJobSummary | null>(null)
  // The Free taste's page band (AGL-3594), read off the verdict request.
  const [freeTaste, setFreeTaste] = useState(false)
  // Whether the Style step asks for the sites the person likes (AGL-3975),
  // read off the same verdict request: `release_ai_site_inspiration`.
  const [siteInspiration, setSiteInspiration] = useState(false)
  // What the Free workspace has left this month (AGL-3660), as the same read
  // the create door refuses on: the less of its own band and its owner's
  // allowance across their Free workspaces. `null` when the route said none.
  const [freeCredits, setFreeCredits] = useState<AiFreeCreditsLeft | null>(null)
  // "Leave without your answers?" (AGL-3660): a dismissal with a brief typed.
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  // The dialog's own root, to tell its Escape from a nested popup's.
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // Drawn by "Create site" before the site exists (AGL-3761): the shell's
  // name and address are asked on step 1, and the site is created only by
  // the starter, Skip, or Plan my site. Read through a ref by the verdict
  // below, which must not re-run when the shell re-renders it.
  const pendingRef = useRef(pendingSite)
  pendingRef.current = pendingSite
  const creating = Boolean(pendingSite) && !pendingSite?.created
  // The funnel (AGL-3898): each step drawn, left and abandoned, and where people struggle.
  const tracker = useAiSiteStartTracking(step, verdict === 'ready')
  // "Bring my site" (AGL-3976): asked of its own door, absent while its flag
  // is off, drawn disabled with the reason where the workspace can change it.
  const [importAvailability, setImportAvailability] = useState<AiSiteImportAvailability>({ state: 'checking' })
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!orgId || !uid) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          // `siteImport=1`: whether "Bring my site" is offered here (AGL-3976), on the same read.
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=1&siteImport=1`,
        )
        const payload = response.ok ? await response.json().catch(() => null) : null
        if (active) {
          setSiteInspiration(payload?.siteInspiration === true)
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
          const shown = response.status !== 404 && response.status !== 403
          setImportAvailability(aiSiteImportOfferOf(payload?.siteImport))
          setVerdict(shown ? 'ready' : 'hidden')
          // "Create site" shows its own dialog when this one will not draw.
          pendingRef.current?.ready(shown)
          clientBuildRef.current?.ready?.(shown)
        }
      } catch {
        if (active) {
          setVerdict('hidden')
          pendingRef.current?.ready(false)
          clientBuildRef.current?.ready?.(false)
        }
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
  // A store's first products and a blog's first posts are part of the start (AGL-3676, AGL-3798).
  const siteKind = aiSiteKindOfInputs(aiSiteStartInputs(answers))?.id ?? null
  const prompt = freeTaste ? (aiFreeSitePrompt(freeCredits, answers.pages, { siteKind }) ?? serverPrompt) : null
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
    if (!freeTaste && step === 'review' && rememberedModel) loadModels()
  }, [freeTaste, step, rememberedModel, loadModels])
  const pickedModel = freeTaste ? null : modelChoice.model

  const plan = useCallback(async (options: { creditsConfirmed?: boolean; pages?: number } = {}) => {
    const asked = options.pages ? { ...answers, pages: options.pages } : answers
    if (!orgId || aiSiteStartRefusal(asked, { freeTaste }) || noneLeft) return
    // Past what is left, only an explicit go-ahead starts it.
    if (freeTaste && !options.creditsConfirmed && aiFreeSitePrompt(freeCredits, asked.pages, { siteKind })) return
    if (options.pages) answer({ pages: options.pages })
    setBusy(true)
    setNotice(null)
    setServerPrompt(null)
    try {
      const requestJob = (siteId: string | null, check: boolean) =>
        authorizedFetch(userRef.current, '/api/ai/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            hostId: siteId,
            kind: 'site',
            // A client build's intake rides along (AGL-3958): the name and
            // towns as the inputs the questions leave empty (the towns only
            // while no address is given, AGL-3995), and how to reach the
            // business, its hours and the owner's words in the brief.
            brief: [aiSiteStartBrief(asked), clientIntake ? aiSiteStartClientBrief(clientIntake) : '']
              .filter(Boolean)
              .join(' '),
            // The guided start confirms its own plan (AGL-3594): the build
            // follows the plan with no approval to make.
            // The sites they like go only while the start asks for them (AGL-3975).
            inputs: {
              ...aiSiteStartInputs(siteInspiration ? asked : { ...asked, inspiration: [] }),
              ...(clientIntake ? aiSiteStartClientInputs(clientIntake, asked) : {}),
              [AI_JOB_AUTO_CONFIRM_INPUT]: true,
            },
            ...(pickedModel ? { model: pickedModel } : {}),
            ...(options.creditsConfirmed ? { creditsConfirmed: true } : {}),
            ...(check ? { check: true } : {}),
          }),
        })
      // A refusal said in the dialog, or the Free go-ahead it asks for.
      const refused = async (response: Response): Promise<unknown> => {
        const payload = await response.json().catch(() => null)
        if (response.ok) return payload ?? {}
        if (response.status === 409 && payload?.code === AI_CREDITS_CONFIRM_CODE && payload?.credits) {
          setServerPrompt(payload.credits as AiCreditsPrompt)
          return null
        }
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(
          locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The site could not be started. Try again.'),
        )
        return null
      }
      // The site, created now when it does not exist yet (AGL-3761): this is
      // the moment the person asked for it. The start is checked first
      // (AGL-3859), so one the jobs route would refuse, or would ask the Free
      // go-ahead for, is answered before any site exists. A refusal about the
      // name or address goes back to step 1, where they are typed.
      let site = { hostId, host, orgSlug }
      if (!hostId && pendingSite) {
        if (!pendingSite.created && !(await refused(await requestJob(null, true)))) return
        const made = await pendingSite.create()
        if ('error' in made) {
          setNotice(made.error)
          if (made.address) setStep('choose')
          return
        }
        site = { hostId: made.hostId, host: made.host, orgSlug: made.orgSlug || orgSlug }
      }
      if (!site.hostId) return
      const payload = (await refused(await requestJob(site.hostId, false))) as { job?: AiJobSummary } | null
      if (!payload) return
      const created = (payload?.job as AiJobSummary | undefined) ?? null
      if (!created) {
        setNotice('The site could not be started. Try again.')
        return
      }
      // The indicator and the launcher count it from the moment it exists.
      publishAiJob(created)
      // A removed start's answers have been used (AGL-3936).
      clearAiSiteStartAnswers()
      // Which optional details the site was asked for with (AGL-3979), by id only.
      tracker.detailsGiven(
        aiSiteStartExtrasGiven(asked).map((field) => ({
          field,
          step: AI_SITE_START_STEPS.find((at) => AI_SITE_START_STEP_FIELDS[at].includes(field)) ?? 'details',
        })),
      )
      // The funnel's last step: the site is started, and nothing after is leaving it.
      tracker.complete()
      tracker.finish()
      // A client build follows its job here, on the build's own screen, which
      // goes on to send the owner the preview (AGL-3958).
      if (clientIntake) {
        clientBuildRef.current?.onStarted?.({ id: created.id })
        setStarted(created)
        return
      }
      // Where the next step is (AGL-3594): the site's "Building your site"
      // page for this job. The zone closes without the starter first, so the
      // setup page does not ask again behind it.
      const href = aiSiteBuildHref(site.orgSlug, site.host, created.id)
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
  }, [orgId, hostId, answers, answer, freeTaste, freeCredits, noneLeft, orgSlug, host, leave, router, pickedModel, pendingSite, siteKind, tracker, clientIntake, siteInspiration])

  // The zone's `startBlank`. Before the site exists it creates it with the
  // starter, and answers `false` when it could not — most often a name or
  // address to fix, which step 1 shows.
  const runStartBlank = useCallback(() => {
    const result = startBlank()
    if (result && typeof result.then === 'function') {
      void result.then((done) => {
        if (done) return
        setStartingStarter(false)
        setStep('choose')
      })
    }
  }, [startBlank])

  const chooseStarter = useCallback(() => {
    if (pendingSite && !pendingSite.created && !pendingSite.check()) return
    setStartingStarter(true)
    trackEvent('site_start_choice', { choice: 'starter' })
    // The starter is a way to start, not a way to leave: no abandonment after it.
    tracker.finish()
    runStartBlank()
  }, [pendingSite, runStartBlank, tracker])

  const chooseImport = useCallback(() => {
    if (importAvailability.state !== 'ready') return
    if (pendingSite && !pendingSite.created && !pendingSite.check()) return
    trackEvent('site_start_choice', { choice: 'import' })
    tracker.complete()
    setImporting(true)
  }, [importAvailability.state, pendingSite, tracker])

  const chooseAi = useCallback(() => {
    if (pendingSite && !pendingSite.created && !pendingSite.check()) return
    trackEvent('site_start_choice', { choice: 'ai' })
    tracker.complete()
    setStep('kind')
  }, [pendingSite, tracker])

  // The heading of each step takes the focus as the step is drawn, so a
  // keyboard and a screen reader start where the new question does.
  useEffect(() => {
    if (verdict !== 'ready') return
    if (drawnStep.current !== null && drawnStep.current !== step) headingRef.current?.focus()
    drawnStep.current = step
  }, [step, verdict])

  /** Forward from a question step, when its answers may go forward. */
  const next = useCallback(() => {
    if (step === 'choose' || step === 'review') return
    const errors = aiSiteStartStepErrors(step, answers, { freeTaste })
    if (errors.length) {
      setChecked((current) => new Set(current).add(step))
      for (const error of errors) tracker.fieldError(error.field, error.code)
      fieldRefs.current[errors[0].field]?.focus()
      return
    }
    tracker.complete()
    const target = returnTo ?? aiSiteStartNextStep(step)
    setReturnTo(null)
    // A review reached with an answer that cannot go forward opens on that answer instead.
    if (target === 'review') {
      const invalid = aiSiteStartFirstInvalidStep(answers, { freeTaste })
      if (invalid && invalid !== 'review') {
        setChecked((current) => new Set(current).add(invalid))
        setStep(invalid)
        return
      }
    }
    if (target) setStep(target)
  }, [step, answers, freeTaste, returnTo, tracker])

  /** Back one step, keeping every answer. */
  const back = useCallback(() => {
    const target = aiSiteStartPreviousStep(step)
    if (!target) return
    tracker.back()
    setReturnTo(null)
    setStep(target)
  }, [step, tracker])

  /** From the review, to the step that asks an answer, and back to the review on Next. */
  const edit = useCallback(
    (target: AiSiteStartStep) => {
      tracker.back()
      setReturnTo('review')
      setStep(target)
    },
    [tracker],
  )

  /** From the progress, back to a step already answered: from the review it is Edit. */
  const goBackTo = (target: AiSiteStartStep) => {
    if (aiSiteStartStepIndex(target) >= aiSiteStartStepIndex(step)) return
    if (step === 'review') {
      edit(target)
      return
    }
    tracker.back()
    setReturnTo(null)
    setStep(target)
  }

  if (verdict !== 'ready') return null

  // Before a job is started Skip is the blank site, which writes the starter
  // (AGL-3594); after, it only closes — the job builds the site.
  const exit = started ? (leave ?? runStartBlank) : runStartBlank
  // Skip, as the header draws it: before a site is started it is leaving the questions.
  const skip = () => {
    if (!started) tracker.abandon('skip')
    exit()
  }
  // Escape and the close control. Before "Create site" has made the site
  // (AGL-3761) there is nothing to give a starter to, so they only close,
  // and nothing is created; otherwise they are the same way out as Skip.
  const dismissTo = creating && !started ? (leave ?? runStartBlank) : exit
  // Anything the person typed or picked, which a dismissal must not discard
  // silently (AGL-3660). After a job starts there is nothing left to lose.
  const drafted =
    !started &&
    Boolean(
      answers.siteType.trim() ||
        answers.audience.trim() ||
        answers.kind !== null ||
        aiSiteStartExtrasGiven(answers).length > 0 ||
        (creating && pendingSite?.dirty),
    )
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
    else closeTo()
  }
  // The dismissal itself, once nothing typed is in the way of it.
  const closeTo = () => {
    if (!started) tracker.abandon('close')
    dismissTo()
  }
  const leaveDraft = () => {
    setConfirmingLeave(false)
    closeTo()
  }

  // The chosen model's cost against Auto's, as the model list states it.
  const modelMultiplier =
    (pickedModel && modelChoice.options?.options.find((option) => option.id === pickedModel)?.multiplier) || 1
  // What the start is likely to cost and at most (AGL-3722): "About 137
  // credits (up to 283)", the measured figures scaled by the chosen model.
  const scaled = (range: AiCreditRange): AiCreditRange => ({
    likely: Math.round(range.likely * modelMultiplier),
    p90: Math.round(range.p90 * modelMultiplier),
    ceiling: Math.round(range.ceiling * modelMultiplier),
  })
  const estimate = freeTaste
    ? aiFreeSiteCreditRange(answers.pages, { siteKind })
    : scaled(aiSiteCreditRange(answers.pages, { welcomeEmail: answers.welcomeEmail, siteKind }))
  // A Free start quotes what is LEFT (AGL-3660), shared across the owner's
  // Free workspaces — never the month's whole allowance as if none were spent.
  const estimateText = freeTaste
    ? freeCredits
      ? `${aiCreditRangeText(estimate)}. You have ${freeCredits.left.toLocaleString('en-US')} of your ${freeCredits.total.toLocaleString('en-US')} free AI credits left this month, until ${aiFreeCreditsResetLabel(freeCredits.resetsOn)}`
      : `${aiCreditRangeText(estimate)}, of the ${FREE_AI_TASTE_CREDITS_PER_MONTH} AI credits you get free each month`
    : `${aiCreditRangeText(estimate)}, estimated`

  // The card is drawn wherever the workspace could use it, disabled where it cannot yet.
  const showsImport = importAvailability.state === 'ready' || importAvailability.state === 'blocked'
  const choosing = step === 'choose' && !started && !importing
  const reviewing = step === 'review' && !started && !importing
  const asking = step !== 'choose' && !started && !importing
  // Each answer's reason not to go forward, shown on a step once Next was refused there.
  const fieldErrors = aiSiteStartFieldErrors(answers, { freeTaste })
  const shownErrors = Object.fromEntries(
    AI_SITE_START_STEP_FIELDS[step]
      .filter((field) => checked.has(step) && fieldErrors[field])
      .map((field) => [field, fieldErrors[field]]),
  )
  const stepProps = {
    answers,
    answer,
    tracker,
    errors: shownErrors,
    fieldRef: (field: AiSiteStartField) => (node: HTMLInputElement | null) => {
      fieldRefs.current[field] = node
    },
  }
  const HEADINGS: Record<AiSiteStartStep, { title: string; lede: string }> = {
    choose: {
      title: 'How do you want to start?',
      lede: creating ? 'Name your site, then choose how it starts. You can change everything later.' : 'You can change everything later.',
    },
    kind: {
      title: 'What are you building?',
      lede: `Say it in a few words, or pick the closest. ${PLATFORM_BRAND_NAME} AI plans and writes your pages from it.`,
    },
    audience: { title: 'Who is it for?', lede: 'The pages and the contact form are written for them.' },
    style: {
      title: 'Choose a style',
      lede: 'Each picture is an example home page in that style. Yours is written for your business, with its own colors and fonts within the style you pick.',
    },
    details: {
      title: 'A few details',
      lede: 'How customers reach you, where messages go, how many pages, and what else to draft. All can be changed later.',
    },
    review: {
      title: 'Review your site',
      lede: started
        ? `${PLATFORM_BRAND_NAME} AI is on it.`
        : `${PLATFORM_BRAND_NAME} AI plans and writes your pages from these answers, then publishes your site.`,
    },
  }
  const heading = importing
    ? {
        title: 'Bring my site',
        lede: `Bring the website you have now into ${PLATFORM_BRAND_NAME}: its pages, words and photos. First, prove it is yours.`,
      }
    : HEADINGS[step]
  // Enter in a text answer is Next. A select, a card or a button keeps its own Enter.
  const onStepKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || !asking || reviewing) return
    const target = event.target as HTMLElement
    if (target.tagName !== 'INPUT' || (target as HTMLInputElement).type === 'hidden') return
    event.preventDefault()
    next()
  }

  return (
    <Dialog
      open
      fullScreen
      ref={dialogRef}
      onClose={dismiss}
      aria-labelledby={TITLE_ID}
      // Where people get lost (AGL-3898): any input puts off the idle signal,
      // and every click is read for rage and dead clicks.
      onClickCapture={(event: MouseEvent<HTMLElement>) => tracker.click(aiSiteStartClickOf(event))}
      onKeyDownCapture={() => tracker.activity()}
      onInputCapture={() => tracker.activity()}
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
        data-start-area="header"
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
          <Button color="inherit" onClick={skip} aria-label={started ? 'Close' : 'Skip and start blank'}>
            {started ? 'Close' : 'Skip'}
          </Button>
        </Toolbar>
      </AppBar>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }} onKeyDown={onStepKeyDown}>
        {/* The step timeline spans the whole dialog, above the step's own
            narrower column (AGL-4014): MUI's Stepper as it comes. */}
        {importing ? null : (
          <Box sx={{ pt: { xs: 3, sm: 4 } }}>
            <StartProgress step={step} compact={compact} onStep={started ? undefined : goBackTo} />
          </Box>
        )}
        <Container
          maxWidth={choosing || step === 'kind' || step === 'style' ? 'md' : 'sm'}
          disableGutters
          sx={{ py: { xs: 3, sm: 5 } }}
        >
          <Stack spacing={4}>
            <Stack spacing={1} sx={{ textAlign: choosing ? 'center' : 'left' }} data-start-area="heading">
              <Typography
                ref={headingRef}
                tabIndex={-1}
                variant="h4"
                component="h1"
                sx={{ '&:focus': { outline: 'none' }, '&:focus-visible': { outline: 'none' } }}
              >
                {heading.title}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {choosing ? (
                  <HelpTip sx={{ float: 'right' }} {...START_HELP.choose} />
                ) : importing ? null : (
                  <StepHelp step={step} />
                )}
                {heading.lede}
              </Typography>
            </Stack>
            {notice && (
              <Alert severity="info" data-start-area="notice">
                {notice}
              </Alert>
            )}
            {asking && noneLeft && freeCredits && (
              <Alert
                severity="warning"
                data-start-area="notice"
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
            {choosing && creating && pendingSite ? (
              <Stack spacing={2} component="section" aria-label="Your site">
                <SectionLabel>{'Your site'}</SectionLabel>
                {pendingSite.fields}
                {/* Start in preview (AGL-4086). Off for the starter and for
                    Start with AI; Bring my site asks again, defaulting on. */}
                {pendingSite.previewControl?.('ai')}
              </Stack>
            ) : null}
            {importing && orgId ? (
              <AiSiteImportStart
                orgId={orgId}
                orgSlug={orgSlug}
                hostId={hostId}
                host={host}
                user={user}
                pendingSite={pendingSite}
                onBack={() => setImporting(false)}
                leave={leave}
              />
            ) : choosing ? (
              <Stack spacing={2}>
                <Box
                  data-start-area="choose-cards"
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: showsImport ? { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } : { xs: '1fr', sm: '1fr 1fr' },
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
                  {showsImport && (
                    <ChoiceCard
                      accent="secondary"
                      icon={mdiWebSync.path}
                      iconId="web-sync"
                      title="Bring my site"
                      description={`Bring the website you have now into ${PLATFORM_BRAND_NAME}: its pages, words and photos, rewritten in your new design.`}
                      blocked={importAvailability.state === 'blocked' ? importAvailability.message : null}
                      onChoose={chooseImport}
                    >
                      {importAvailability.state === 'blocked' && importAvailability.reason === 'plan' ? (
                        <Chip size="small" variant="outlined" label="Paid plans" />
                      ) : null}
                    </ChoiceCard>
                  )}
                </Box>
                {importAvailability.state === 'blocked' ? (
                  <PrerequisiteNotice
                    {...(importAvailability.reason === 'plan' && orgSlug
                      ? { href: aiCreditsBillingHref(orgSlug), actionLabel: 'Upgrade' }
                      : {})}
                  >
                    {importAvailability.message}
                  </PrerequisiteNotice>
                ) : null}
              </Stack>
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
              <Box component="section">
                {step === 'kind' && <KindStep {...stepProps} />}
                {step === 'audience' && <AudienceStep {...stepProps} />}
                {step === 'style' && (
                  <StyleStep
                    {...stepProps}
                    inspiration={
                      siteInspiration
                        ? { limit: aiSiteInspirationLimit(freeTaste), upgradeHref: orgSlug ? aiCreditsBillingHref(orgSlug) : null }
                        : null
                    }
                  />
                )}
                {step === 'details' && <DetailsStep {...stepProps} freeTaste={freeTaste} band={band} />}
                {/* Each question step's optional extras, collapsed, after its own answers (AGL-3979). */}
                {step !== 'review' && (
                  <Box sx={{ mt: 3 }}>
                    <MoreDetails key={step} step={step} {...stepProps} />
                  </Box>
                )}
                {step === 'review' && (
                  <ReviewStep answers={answers} freeTaste={freeTaste} onEdit={edit} inspiration={siteInspiration}>
                    {clientIntake && (
                      <Alert severity="info" variant="outlined" data-start-area="client-intake">
                        {aiSiteStartClientNote(clientIntake)}
                      </Alert>
                    )}
                    {!noneLeft && prompt && (
                      <AiCreditsPromptNotice
                        prompt={prompt}
                        noun="site"
                        orgSlug={orgSlug}
                        busy={busy}
                        onBuildWhatFits={() => void plan({ creditsConfirmed: true })}
                        onSmaller={() => void plan({ creditsConfirmed: true, pages: 1 })}
                      />
                    )}
                  </ReviewStep>
                )}
              </Box>
            )}
          </Stack>
        </Container>
      </DialogContent>
      {asking && (
        /* The footer stays put while the questions scroll. It wraps, because
           the estimate, the reason and the buttons are wider than a phone. */
        <DialogActions
          data-start-area="footer"
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
          {reviewing && (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mr: 'auto', minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary">
                {`${estimateText}.`}
              </Typography>
              <HelpTip {...START_HELP.estimate} ariaLabel="How the estimate works" />
            </Stack>
          )}
          {reviewing && refusal && (
            <Typography variant="body2" color="text.secondary">
              {refusal}
            </Typography>
          )}
          {reviewing && !freeTaste && <AiModelSelector choice={modelChoice} disabled={busy} />}
          <Button onClick={back} sx={reviewing ? undefined : { mr: 'auto' }}>
            {'Back'}
          </Button>
          {reviewing ? (
            <Button
              variant="contained"
              size="large"
              disabled={busy || Boolean(refusal) || Boolean(prompt) || noneLeft}
              onClick={() => void plan()}
              startIcon={<MdiIcon path={mdiCreation.path} />}
            >
              {busy ? 'Starting…' : 'Plan my site'}
            </Button>
          ) : (
            <Button variant="contained" size="large" onClick={next}>
              {returnTo === 'review' ? 'Back to review' : 'Next'}
            </Button>
          )}
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
            {creating
              ? 'What you typed is not saved, and no site is created.'
              : 'What you typed is not saved. Leaving starts your site from the starter site instead.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={leaveDraft}>
            {creating ? 'Leave' : 'Leave and start blank'}
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
