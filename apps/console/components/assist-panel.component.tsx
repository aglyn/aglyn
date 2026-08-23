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

import {
  checkEntitlement,
  lockdownRefusalText,
  parseLockdownRefusal,
} from '@aglyn/aglyn'
import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import {
  mdiChatQuestionOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiOpenInNew,
  mdiSend,
  mdiThumbDownOutline,
  mdiThumbUpOutline,
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Drawer,
  Fab,
  IconButton,
  Link,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { usePathname } from 'next/navigation'
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { DocsHelpTip } from './docs-help-tip.component'
import { HostIdContext } from './host-id-provider'
import useBranding from '../hooks/use-branding'
import useCurrentOrg from '../hooks/use-current-org'
import useOrgScope, { useOrgSlug } from '../hooks/use-org-scope'
import useReleaseFlags, { useReleaseFlag } from '../hooks/use-release-flags'
import { useUrlNamesOrg } from '../hooks/use-secondary-nav'

/**
 * Aglyn Assist (AGL-1860, phase 1 — answer + guide): the floating chat
 * helper mounted on every authenticated console page. Docs-grounded answers
 * with deep links for everyone the release flag admits; Pro+ (`aiAssist`)
 * adds page-context awareness. The panel never answers the entitlement
 * question from a loading default — capability messaging waits for
 * `useCurrentOrg().ready` (the checkQuota(undefined)=Free lesson).
 *
 * ## It also never runs against an org the URL did not name (AGL-1934)
 *
 * `useCurrentOrg()` deliberately keeps a fallback — org-less pages still need
 * an org to ACT on — so on the workspace picker it answers with a real org
 * and a truthy plan: a remembered selection, or simply the user's first. This
 * panel used to gate on nothing but `orgId` being present, which that
 * fallback always satisfies. The result was the whole component running for a
 * workspace nobody opened: the entitlement decided by its plan, the upgrade
 * nudge pitched on its behalf, the session thread filed under its id, and —
 * the reason this ranked High rather than cosmetic — every question POSTed
 * with its `orgId`, so the message was METERED to it. Billing data attributed
 * to the wrong customer.
 *
 * The gate is AGL-1130's `useUrlNamesOrg()`, the same predicate AGL-1916
 * applied to `QuotaWarningsBanner` on the same page, plus the positive
 * contradiction check that goes with it. It is expressed once, as
 * `scopedOrgId`, so that no send path can reach `orgId` around it — and the
 * server refuses an unscoped request independently (`assistScopeRefusal` in
 * `app/api/assist/chat/route.ts`), because a metering boundary the client
 * alone decides is not a boundary.
 */

interface AssistDocLink {
  title: string
  url: string
}

/**
 * A level-2 proposal, exactly as the server resolved it (AGL-1988).
 *
 * Every field here is inert. There is no method, no endpoint and no body,
 * because the server type has none: the assistant proposes, the user
 * confirms, and confirming NAVIGATES. The destination form's own submit
 * button stays the only thing that writes.
 */
interface AssistProposal {
  id: string
  label: string
  outcome: string
  href: string
  values: Array<{ name: string; value: string }>
  prefill: boolean
}

interface AssistMessage {
  role: 'user' | 'assistant'
  text: string
  exchangeId?: string | null
  feedback?: 'up' | 'down'
  docs?: AssistDocLink[]
  proposal?: AssistProposal | null
  /** Set once the user acts on or waves away the card, so it does not linger. */
  proposalResolved?: boolean
}

interface AssistQuotaInfo {
  period: 'day' | 'month'
  used: number
  limit: number
  remaining: number
}

const HISTORY_TURNS_SENT = 12

const storageKey = (orgId: string) => `aglyn-assist:${orgId}`

function loadThread(orgId: string | undefined): AssistMessage[] {
  if (!orgId || typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(storageKey(orgId))
    const parsed = raw ? (JSON.parse(raw) as AssistMessage[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveThread(orgId: string | undefined, messages: AssistMessage[]) {
  if (!orgId || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(storageKey(orgId), JSON.stringify(messages))
  } catch {
    // Quota/full storage never breaks chat.
  }
}

/**
 * Minimal renderer for assistant text: markdown links and bare URLs become
 * links (internal root-relative paths ride AppLink, external open in a new
 * tab); everything else renders as plain text with line breaks. Phase 1 on
 * purpose — no full markdown surface inside the panel.
 */
export function renderAssistText(text: string): JSX.Element {
  const parts: Array<string | { label: string; href: string }> = []
  const pattern = /\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push(text.slice(cursor, index))
    if (match[1] && match[2]) parts.push({ label: match[1], href: match[2] })
    else parts.push({ label: match[0], href: match[0] })
    cursor = index + match[0].length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return (
    <>
      {parts.map((part, i) => {
        if (typeof part === 'string') {
          return <Fragment key={i}>{part}</Fragment>
        }
        if (part.href.startsWith('/')) {
          return (
            <AppLink key={i} componentVariant="naked" href={part.href}>
              {part.label}
            </AppLink>
          )
        }
        return (
          <Link key={i} href={part.href} target="_blank" rel="noreferrer">
            {part.label}
          </Link>
        )
      })}
    </>
  )
}

/**
 * Split an answer into its plain layer and its technical tail (AGL-1988).
 *
 * Aglyn's users run from first-time business owners to working developers,
 * and they get the same message. Two modes would be the obvious build and
 * the wrong one — it asks a beginner to label themselves before they have a
 * question, and asks a developer to opt in to being taken seriously. So the
 * model writes one answer with a technical paragraph at the end, and the
 * panel collapses it: the beginner never has to read past the plain steps,
 * the developer never has to ask for the route or the field name.
 *
 * Degrades to "no tail" when the marker is absent, which is the common case
 * and not a failure — plenty of answers have nothing technical to add.
 */
export function splitAssistDisclosure(text: string): {
  plain: string
  technical: string
} {
  const match = text.match(/(?:^|\n)[ \t]*Under the hood:[ \t]*/)
  if (!match || match.index === undefined) return { plain: text, technical: '' }
  const plain = text.slice(0, match.index).trimEnd()
  const technical = text.slice(match.index + match[0].length).trim()
  // An answer that is ONLY a technical tail is still the answer. Collapsing
  // the whole thing would show the user an empty bubble with a toggle.
  if (!plain || !technical) return { plain: text, technical: '' }
  return { plain, technical }
}

/** The collapsed developer layer. */
function UnderTheHood({ technical }: { technical: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Box sx={{ mt: 0.5 }}>
      <Link
        component="button"
        type="button"
        variant="caption"
        underline="hover"
        onClick={() => setOpen((prior) => !prior)}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
      >
        Under the hood
        <MdiIcon
          path={open ? mdiChevronUp.path : mdiChevronDown.path}
          sx={{ fontSize: 14 }}
        />
      </Link>
      <Collapse in={open} unmountOnExit>
        <Typography
          variant="caption"
          component="div"
          color="text.secondary"
          sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {renderAssistText(technical)}
        </Typography>
      </Collapse>
    </Box>
  )
}

/**
 * The source links under an answer (AGL-2486).
 *
 * `docs` is server-resolved retrieval output and has ridden every `done`
 * event since Assist shipped, but NOTHING rendered it: it set the `grounded`
 * analytics flag and stopped there. So every answer carried its citations to
 * a reader who never saw them, and on the MODEL path that array is the only
 * citation there is — the completion is prose, and nothing obliges it to name
 * the page it was grounded in.
 *
 * ## Why this FILTERS rather than rendering the array straight
 *
 * The DEFLECTED path is the opposite case. `composeDocsAnswer` deliberately
 * puts the citation in the answer TEXT as `[label](url)`, because a link is
 * the one markup this panel speaks (`renderAssistText`) — that is a recorded
 * decision, not an oversight, and its own docstring names this array as the
 * tempting-but-wrong home for the citation *because* nothing renders it.
 * Rendering the array underneath would therefore print every heading a second
 * time on exactly the answers that already cite well. Anything whose url is
 * already linked in the text is dropped, which leaves a deflected answer
 * reading precisely as it does today and gives the model answer the sources
 * it has never shown.
 *
 * ## Why the array is not simply suppressed server-side instead
 *
 * That was the other candidate and it is a trap: `docs.length > 0` is what
 * sets the `grounded` analytics flag, so a docs-QUOTING answer would report
 * itself ungrounded. The most grounded turn the product serves would be
 * counted as a documentation gap, which is precisely backwards for the signal
 * `assist-signal-mining` exists to read.
 */
export function AssistSources({
  text,
  docs,
}: {
  text: string
  docs?: readonly AssistDocLink[]
}) {
  const unseen: AssistDocLink[] = []
  const shown = new Set<string>()
  for (const doc of docs ?? []) {
    // Already a link in the prose, or already listed here. Both are the same
    // failure to the reader: the same page offered twice.
    if (!doc?.url || text.includes(doc.url) || shown.has(doc.url)) continue
    shown.add(doc.url)
    unseen.push(doc)
  }
  if (!unseen.length) return null
  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {unseen.length === 1 ? 'Source' : 'Sources'}
      </Typography>
      <Stack spacing={0.25} sx={{ mt: 0.25 }}>
        {unseen.map((doc) => (
          <Typography key={doc.url} variant="caption" component="div">
            {doc.url.startsWith('/') ? (
              <AppLink componentVariant="naked" href={doc.url}>
                {doc.title}
              </AppLink>
            ) : (
              <Link href={doc.url} target="_blank" rel="noreferrer">
                {doc.title}
              </Link>
            )}
          </Typography>
        ))}
      </Stack>
    </Box>
  )
}

/**
 * The confirm card — the whole of "automate current view", and the whole of
 * its boundary.
 *
 * The assistant proposes; this card is the human confirmation; confirming
 * navigates. There is deliberately no submit path anywhere in this
 * component, and no network call: a chat assistant that writes without
 * consent is a far worse launch story than one that only advises, and the
 * cheapest way to be sure it cannot is for the code that could do it not to
 * exist. `assist-panel-proposal.spec.tsx` greps this file for exactly that.
 *
 * The copy is held to the same standard. While `prefill` is false — no
 * console page reads `assist_*` params yet — the card says it will open the
 * page and lists the values to use. It does not say it filled anything in,
 * because a form that comes up empty after that promise is worse than no
 * card at all.
 */
function ProposalCard({
  proposal,
  onConfirm,
  onDismiss,
}: {
  proposal: AssistProposal
  onConfirm: () => void
  onDismiss: () => void
}) {
  const { branding } = useBranding()
  const brand = branding.productName
  return (
    <Paper
      variant="outlined"
      sx={{ mt: 1, p: 1.5, borderRadius: 2, bgcolor: 'background.paper' }}
    >
      <Typography variant="subtitle2">{proposal.label}</Typography>
      <Typography variant="caption" color="text.secondary" component="div">
        Opens {proposal.outcome}.
      </Typography>
      {proposal.values.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {proposal.prefill ? 'Filled in for you:' : 'Values to use:'}
          </Typography>
          <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
            {proposal.values.map(({ name, value }) => (
              <Typography key={name} component="li" variant="caption">
                {name}: <strong>{value}</strong>
              </Typography>
            ))}
          </Stack>
        </Box>
      )}
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mt: 1 }}
      >
        {`${brand} Assist only opens the page. Nothing is saved until you `}
        {'fill the form in and submit it yourself.'}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <AppLink
          componentVariant="button"
          href={proposal.href}
          variant="contained"
          size="small"
          onClick={onConfirm}
          startIcon={<MdiIcon path={mdiOpenInNew.path} />}
        >
          Take me there
        </AppLink>
        <Button size="small" color="inherit" onClick={onDismiss}>
          No thanks
        </Button>
      </Stack>
    </Paper>
  )
}

export function AssistPanelComponent() {
  const verdict = useReleaseFlag('release_assist')
  const { isStaff } = useReleaseFlags()
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  // The assistant is named after the product, so its name follows the brand
  // (AGL-2319). `useBranding` returns the deployment brand on any route the
  // URL does not scope to an org, which is every non-org console page.
  const { branding } = useBranding()
  const { orgSlug, pathOrgSlug, currentOrg } = useOrgScope()
  // Whether the URL itself scopes this page to a workspace (AGL-1130), and
  // whether the org that answered contradicts the one it names — a shared
  // link to a workspace you are not in wears a URL that appears to justify
  // the fallback. POSITIVE contradiction only (AGL-1916): `slug` is optional
  // on the membership row, and a legacy row without one must not silence the
  // assistant on a route that is perfectly legitimate.
  const namesOrg = useUrlNamesOrg()
  const wrongOrg = Boolean(
    pathOrgSlug && currentOrg?.slug && currentOrg.slug !== pathOrgSlug,
  )
  /**
   * The org this panel may speak for, act as, and be METERED against — or
   * `undefined` where the page named none. Every use of the org below goes
   * through this rather than `orgId`, so a send path cannot be added later
   * that quietly reaches around the gate; the thread key, the two POST
   * bodies and the render gate all read the same value.
   */
  const scopedOrgId = namesOrg && !wrongOrg ? orgId : undefined
  /** Path slug for building `/[orgSlug]/…` links (AGL-621). */
  const billingSlug = useOrgSlug()
  const hostId = useContext(HostIdContext)
  const pathname = usePathname()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<AssistMessage[]>([])
  const [quota, setQuota] = useState<AssistQuotaInfo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Thread is per-org, session-persisted; switching orgs swaps threads.
  // Keyed on the SCOPED org (AGL-1934): gating only the render would still
  // load — and, on the next keystroke, save — a thread under the fallback
  // org's key on every mount of a page that named no workspace.
  useEffect(() => {
    setMessages(loadThread(scopedOrgId))
    setQuota(null)
  }, [scopedOrgId])

  useEffect(() => {
    saveThread(scopedOrgId, messages)
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [scopedOrgId, messages])

  const entitled = orgReady && checkEntitlement(org as never, 'aiAssist')

  const send = useCallback(async () => {
    const question = input.trim()
    if (!question || busy || !scopedOrgId) return
    setBusy(true)
    setInput('')
    const history = messages
      .slice(-HISTORY_TURNS_SENT)
      .map(({ role, text }) => ({ role, text }))
    setMessages((prior) => [
      ...prior,
      { role: 'user', text: question },
      { role: 'assistant', text: '' },
    ])
    const patchAnswer = (patch: (message: AssistMessage) => AssistMessage) => {
      setMessages((prior) => {
        const next = [...prior]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') next[next.length - 1] = patch(last)
        return next
      })
    }
    // A notice must not be swallowed by a partial answer: a refusal or a
    // max_tokens cut arrives AFTER text has streamed, and substituting only
    // when the bubble is empty would leave the user staring at half an
    // answer with nothing saying why it stopped.
    const failAnswer = (notice: string) => {
      patchAnswer((message) => ({
        ...message,
        text: message.text ? `${message.text}\n\n${notice}` : notice,
      }))
    }
    try {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> } | null | undefined
      )?.getIdToken?.()
      const response = await fetch('/api/assist/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId: scopedOrgId,
          question,
          history,
          // Page context rides along; the server drops it for free orgs
          // (level 2 is Pro+). Sending it is not a grant — the capability
          // decision is server-side.
          context: { route: pathname ?? '', hostId: hostId ?? '', orgSlug },
        }),
      })
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null)
        const locked = parseLockdownRefusal(response.status, payload)
        if (locked) {
          failAnswer(lockdownRefusalText(locked))
        } else if (response.status === 501) {
          failAnswer(
            `${branding.productName} Assist is not configured on this deployment.`,
          )
        } else if (response.status === 429 && payload?.reason === 'quota') {
          if (payload.quota) setQuota(payload.quota as AssistQuotaInfo)
          failAnswer(String(payload?.error ?? 'Message limit reached.'))
        } else {
          failAnswer(String(payload?.error ?? 'The assistant request failed — try again.'))
        }
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: Record<string, unknown>
          try {
            event = JSON.parse(line.slice('data: '.length))
          } catch {
            continue
          }
          if (event.type === 'delta' && typeof event.text === 'string') {
            const text = event.text as string
            patchAnswer((message) => ({ ...message, text: message.text + text }))
          } else if (event.type === 'done') {
            const docs = (event.docs as AssistDocLink[] | undefined) ?? []
            // Server-resolved and inert: an id from the closed set attached
            // to the view the question was asked from, plus a destination
            // this client did not choose. Null on every turn that proposed
            // nothing, which is most of them.
            const proposal = (event.proposal as AssistProposal | null) ?? null
            patchAnswer((message) => ({
              ...message,
              exchangeId: (event.exchangeId as string | null) ?? null,
              docs,
              proposal,
            }))
            if (event.quota) setQuota(event.quota as AssistQuotaInfo)
            trackEvent('assistant_message_sent', {
              tier: entitled ? 'entitled' : 'free',
              grounded: docs.length > 0,
            })
            if (proposal) {
              trackEvent('assistant_proposal_shown', { action: proposal.id })
            }
          } else if (event.type === 'error') {
            failAnswer(String(event.error ?? 'The assistant stream failed.'))
          }
        }
      }
    } catch (error) {
      console.error(error)
      failAnswer('The assistant request failed — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    entitled,
    hostId,
    input,
    messages,
    scopedOrgId,
    orgSlug,
    pathname,
    user,
  ])

  /**
   * Retire a card once it has been acted on or waved away. Local state only
   * — there is nothing to tell the server, because the proposal was never
   * anything the server was waiting on.
   */
  const resolveProposal = useCallback((index: number) => {
    setMessages((prior) =>
      prior.map((entry, i) =>
        i === index ? { ...entry, proposalResolved: true } : entry,
      ),
    )
  }, [])

  const sendFeedback = useCallback(
    async (index: number, feedback: 'up' | 'down') => {
      const message = messages[index]
      if (!message?.exchangeId || !scopedOrgId) return
      setMessages((prior) =>
        prior.map((entry, i) => (i === index ? { ...entry, feedback } : entry)),
      )
      trackEvent('assistant_feedback', { feedback })
      try {
        const idToken = await (
          user as { getIdToken?: () => Promise<string> } | null | undefined
        )?.getIdToken?.()
        await fetch('/api/assist/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            orgId: scopedOrgId,
            exchangeId: message.exchangeId,
            feedback,
          }),
        })
      } catch {
        enqueueSnackbar('Feedback could not be recorded', {
          variant: 'warning',
          persist: false,
        })
      }
    },
    [enqueueSnackbar, messages, scopedOrgId, user],
  )

  // A released-off feature does not exist (staff preview excepted) — and
  // without an org IN SCOPE there is nothing to meter or record against
  // (AGL-1934). `scopedOrgId`, never `orgId`: the fallback org is always
  // present, which is exactly why gating on it announced and billed the
  // assistant on the workspace picker. Every hook above has already run, so
  // this early return costs no hook-order hazard.
  if (!verdict.visible || !scopedOrgId) return null

  return (
    <>
      {!open && (
        <Tooltip title={`${branding.productName} Assist`} placement="left">
          <Fab
            color="primary"
            size="medium"
            aria-label={`Open ${branding.productName} Assist`}
            onClick={() => setOpen(true)}
            sx={{
              position: 'fixed',
              // Insets, not constants (AGL-2486). The console chrome leaves
              // the bottom-right corner empty, but the besigner does not:
              // its properties panel is a full-height column on that edge,
              // and a fixed launcher lands on the Styles form and its
              // scrollbar. A surface that owns the corner publishes these
              // variables to move the launcher clear of itself; everywhere
              // else the fallback is the corner it has always used. Read as
              // CSS rather than passed as props so the offset can follow a
              // panel the launcher knows nothing about — one that is
              // resizable and collapsible — without this component growing
              // a dependency on the editor.
              right: 'var(--aglyn-assist-inset-right, 20px)',
              bottom: 'var(--aglyn-assist-inset-bottom, 20px)',
              zIndex: (theme) => theme.zIndex.drawer - 1,
            }}
          >
            {/* Sized at the call site (AGL-2486). `MdiIcon` defaults to
                `fontSize="inherit"`, which is right for the startIcon and
                caption slots most of this file uses it in — but inside a
                Fab the inherited size is the BUTTON typography, 14px, so
                the glyph painted at 14px in a 48px control and read as
                broken. `medium` is the 24px MUI puts in its own FABs. Not
                fixed in `MdiIcon`: that default is depended on across the
                console, including twice in this file. */}
            <MdiIcon path={mdiChatQuestionOutline.path} fontSize="medium" />
          </Fab>
        </Tooltip>
      )}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{
          paper: {
            sx: { width: { xs: '100%', sm: 420 }, display: 'flex' },
          },
        }}
      >
        <Stack sx={{ height: '100%' }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: 1,
              borderColor: 'divider',
              alignItems: 'center',
            }}
          >
            {/* Same reason as the launcher: this one sits beside an `h6`
                title in a plain Stack, so `inherit` gave it the 16px body
                size against a 20px heading. */}
            <MdiIcon path={mdiChatQuestionOutline.path} fontSize="medium" />
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              {`${branding.productName} Assist`}
            </Typography>
            {verdict.staffPreview && (
              <Chip size="small" color="warning" label="Staff preview" />
            )}
            {/* Assist answers from the docs but never says so, and the three
                questions it provokes — what it can and can't do, why it
                stopped answering, what happens to what I typed — are exactly
                the four headings on its docs page (AGL-1943). Nothing in this
                panel's chrome can carry those, and a chat box is the one
                surface where a user is most likely to keep asking rather
                than go and read. */}
            <DocsHelpTip
              topic="aglynAssist"
              anchor="#what-it-can-do"
              sx={{ color: 'text.secondary' }}
            />
            <Tooltip title={`Close ${branding.productName} Assist`}>
              <IconButton
                aria-label={`Close ${branding.productName} Assist`}
                onClick={() => setOpen(false)}
              >
                {/* An IconButton does not set a font-size of its own, so
                    `inherit` reached the same 14px button typography. */}
                <MdiIcon path={mdiClose.path} fontSize="medium" />
              </IconButton>
            </Tooltip>
          </Stack>

          <Box ref={scrollRef} sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
            {!messages.length && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {`Ask anything about using ${branding.productName} — building `}
                {'your site, publishing, domains, commerce, billing. Answers '}
                {'link the docs and the console page to use.'}
                {orgReady && !entitled && !isStaff && (
                  <>
                    {' '}
                    Free workspaces get a limited number of messages a day;
                    Pro adds page-aware guidance.
                  </>
                )}
              </Alert>
            )}
            <Stack spacing={1.5}>
              {messages.map((message, index) => (
                <Box
                  key={index}
                  sx={{
                    alignSelf:
                      message.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '90%',
                    borderRadius: 2,
                    px: 1.5,
                    py: 1,
                    bgcolor:
                      message.role === 'user'
                        ? 'primary.main'
                        : 'action.hover',
                    color:
                      message.role === 'user'
                        ? 'primary.contrastText'
                        : 'text.primary',
                  }}
                >
                  <Typography
                    variant="body2"
                    component="div"
                    sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {message.role === 'assistant' ? (
                      message.text ? (
                        renderAssistText(
                          splitAssistDisclosure(message.text).plain,
                        )
                      ) : (
                        <CircularProgress size={14} />
                      )
                    ) : (
                      message.text
                    )}
                  </Typography>
                  {message.role === 'assistant' &&
                    splitAssistDisclosure(message.text).technical && (
                      <UnderTheHood
                        technical={splitAssistDisclosure(message.text).technical}
                      />
                    )}
                  {message.role === 'assistant' && (
                    <AssistSources text={message.text} docs={message.docs} />
                  )}
                  {message.role === 'assistant' &&
                    message.proposal &&
                    !message.proposalResolved && (
                      <ProposalCard
                        proposal={message.proposal}
                        onConfirm={() => {
                          trackEvent('assistant_proposal_confirmed', {
                            action: message.proposal?.id ?? '',
                          })
                          resolveProposal(index)
                          setOpen(false)
                        }}
                        onDismiss={() => resolveProposal(index)}
                      />
                    )}
                  {message.role === 'assistant' && message.exchangeId && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      {/* The span is load-bearing (AGL-2128): a disabled MUI
                          button fires no pointer events, so a Tooltip on it
                          directly never opens — and "already answered" is
                          precisely the state a reader most needs explained,
                          because the greyed thumbs otherwise look broken. */}
                      <Tooltip
                        title={
                          message.feedback
                            ? 'Thanks — you already rated this answer'
                            : 'Helpful answer'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            aria-label="Helpful answer"
                            color={message.feedback === 'up' ? 'primary' : 'default'}
                            disabled={Boolean(message.feedback)}
                            onClick={() => void sendFeedback(index, 'up')}
                          >
                            <MdiIcon
                              path={mdiThumbUpOutline.path}
                              sx={{ fontSize: 16 }}
                            />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip
                        title={
                          message.feedback
                            ? 'Thanks — you already rated this answer'
                            : 'Unhelpful answer'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            aria-label="Unhelpful answer"
                            color={message.feedback === 'down' ? 'primary' : 'default'}
                            disabled={Boolean(message.feedback)}
                            onClick={() => void sendFeedback(index, 'down')}
                          >
                            <MdiIcon
                              path={mdiThumbDownOutline.path}
                              sx={{ fontSize: 16 }}
                            />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  )}
                </Box>
              ))}
            </Stack>
          </Box>

          <Stack
            spacing={1}
            sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}
          >
            {quota && quota.period === 'day' && (
              <Typography variant="caption" color="text.secondary">
                {quota.remaining} of {quota.limit} free messages left today
                {/* `useOrgSlug()`, not `useOrgScope().orgSlug` — the latter
                    is the SUBDOMAIN slug, which is null on `app.aglyn.com`,
                    so this upgrade link silently vanished on every apex org
                    route: the one place a capped free workspace is told it
                    is capped, with no way to act on it. Safe to fall back to
                    the resolved org's slug here because the render gate
                    above has already established the URL names it. */}
                {billingSlug ? (
                  <>
                    {' — '}
                    <AppLink
                      componentVariant="naked"
                      href={`/${billingSlug}/billing`}
                    >
                      upgrade for more
                    </AppLink>
                  </>
                ) : null}
              </Typography>
            )}
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'flex-end' }}
            >
              <TextField
                fullWidth
                multiline
                maxRows={4}
                size="small"
                placeholder="How do I…"
                value={input}
                disabled={busy}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <Tooltip
                title={busy ? 'Waiting for an answer…' : 'Send message'}
              >
                <span>
                  <IconButton
                    color="primary"
                    aria-label="Send message"
                    disabled={busy || !input.trim()}
                    onClick={() => void send()}
                  >
                    {busy ? (
                      <CircularProgress size={20} />
                    ) : (
                      // 20px to match the CircularProgress it swaps with
                      // on the line above — at the inherited 14px the
                      // button visibly grew its contents while busy.
                      <MdiIcon path={mdiSend.path} sx={{ fontSize: 20 }} />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
        </Stack>
      </Drawer>
    </>
  )
}

export default AssistPanelComponent
