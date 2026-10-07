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

import type { ConsolePublicPageProps } from '@aglyn/aglyn'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import * as CommerceModel from '../../model'
import { PosDisplayBrandMark, PosDisplayBrandScreen } from './pos-display/brand-screen'
import { PosDisplayCartView } from './pos-display/cart-screen'
import { PosDisplayPairingScreen } from './pos-display/pairing-screen'
import {
  displayMoney,
  forgetDisplay,
  pollDisplay,
  type PosDisplayAnswer,
  type PosDisplayBranding,
  type PosDisplayPublicState,
  readStoredToken,
  respondToDisplay,
  storeToken,
} from './pos-display/pos-display-api'
import { PosDisplayReceiptScreen } from './pos-display/receipt-screen'
import { PosDisplayTipScreen } from './pos-display/tip-screen'

/** How often the display asks for news while a sale is on screen. */
export const POS_DISPLAY_ACTIVE_POLL_MS = 1_000
/** And between sales, when nothing on it is changing. */
export const POS_DISPLAY_IDLE_POLL_MS = 3_000
/** The store's name and logo are re-read this often, so an edit reaches the screen. */
const BRANDING_REFRESH_MS = 10 * 60 * 1000

/**
 * The screen a register turns toward its customer (AGL-3608), served at
 * `/kiosk/commerce/pos-display` with no staff session.
 *
 * It holds one secret, the display token from pairing, and reads one thing
 * with it: its register's display state, polled. Everything the customer
 * answers goes back through `respond`, and the server checks each answer
 * against the prompt it claims to answer, so a stale screen cannot answer
 * the next sale's question.
 */
export default function PosDisplayPage(_props: ConsolePublicPageProps) {
  // `undefined` while storage is being read, so the pairing screen never
  // flashes on a display that is already paired.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [branding, setBranding] = useState<PosDisplayBranding | null>(null)
  const [state, setState] = useState<PosDisplayPublicState | null>(null)
  const [offline, setOffline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // The prompt this screen has answered, so "the cashier will finish up"
  // shows the moment the answer lands rather than on the next poll.
  const [sentPromptId, setSentPromptId] = useState<string | null>(null)
  const [thanksOver, setThanksOver] = useState(false)

  const stateRef = useRef(state)
  stateRef.current = state
  const brandingAtRef = useRef(0)

  useEffect(() => {
    setToken(readStoredToken())
  }, [])

  const unpaired = useCallback(() => {
    storeToken(null)
    brandingAtRef.current = 0
    setToken(null)
    setState(null)
    setBranding(null)
    setSentPromptId(null)
  }, [])

  const paired = useCallback((next: string, nextBranding: PosDisplayBranding) => {
    storeToken(next)
    setBranding(nextBranding ?? null)
    brandingAtRef.current = Date.now()
    setToken(next)
  }, [])

  // The poll: every second while a sale is on screen, every three between
  // sales, and not at all while the tab is hidden.
  useEffect(() => {
    if (!token) return undefined
    let active = true
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      if (!active) return
      if (timer) clearTimeout(timer)
      const mode = stateRef.current?.mode ?? 'idle'
      timer = setTimeout(
        () => void tick(),
        mode === 'idle' ? POS_DISPLAY_IDLE_POLL_MS : POS_DISPLAY_ACTIVE_POLL_MS,
      )
    }

    const tick = async () => {
      timer = undefined
      if (!active || inFlight) return
      // Hidden: stop here. Coming back into view polls at once.
      if (typeof document !== 'undefined' && document.hidden) return
      inFlight = true
      const withBranding = Date.now() - brandingAtRef.current > BRANDING_REFRESH_MS
      const result = await pollDisplay(token, withBranding)
      inFlight = false
      if (!active) return
      if (result.ok) {
        setOffline(false)
        const { state: next, branding: nextBranding } = result.value ?? {}
        if (next) {
          stateRef.current = next
          setState(next)
        }
        if (nextBranding) {
          brandingAtRef.current = Date.now()
          setBranding(nextBranding)
        }
      } else if (result.status === 401) {
        unpaired()
        return
      } else {
        setOffline(true)
      }
      schedule()
    }

    const onVisibility = () => {
      if (document.hidden) return
      if (timer) clearTimeout(timer)
      void tick()
    }

    void tick()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [token, unpaired])

  // Keep the screen on while paired. Best effort: a browser without the
  // Wake Lock API, or one that refuses it, just follows its own sleep.
  useEffect(() => {
    if (!token) return undefined
    let active = true
    let lock: { release?: () => Promise<void> } | null = null
    const request = async () => {
      try {
        const wakeLock = (
          navigator as Navigator & {
            wakeLock?: { request: (type: 'screen') => Promise<{ release?: () => Promise<void> }> }
          }
        ).wakeLock
        if (!wakeLock || document.hidden) return
        const next = await wakeLock.request('screen')
        if (active) lock = next
        else await next.release?.()
      } catch {
        // Refused (battery saver, no user gesture yet): nothing to do.
      }
    }
    void request()
    // The browser drops the lock when the tab is hidden; take it back.
    const onVisibility = () => {
      if (!document.hidden) void request()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisibility)
      lock?.release?.().catch(() => undefined)
    }
  }, [token])

  // A new prompt or mode clears whatever this screen said about the last one.
  const promptKey = `${state?.mode ?? 'idle'}:${state?.promptId ?? ''}`
  useEffect(() => {
    setNotice(null)
  }, [promptKey])

  // The thank-you returns to the idle screen on its own, even if the next
  // poll is late; the server reports idle after the same interval.
  const thanksKey = state?.mode === 'thanks' ? `${state.promptId ?? ''}:${state.updatedAtMs}` : ''
  useEffect(() => {
    setThanksOver(false)
    if (!thanksKey) return undefined
    const timer = setTimeout(() => setThanksOver(true), CommerceModel.POS_DISPLAY_THANKS_MS)
    return () => clearTimeout(timer)
  }, [thanksKey])

  const answer = useCallback(
    async (response: PosDisplayAnswer) => {
      if (!token) return
      setBusy(true)
      setNotice(null)
      const result = await respondToDisplay(token, response)
      setBusy(false)
      if (result.ok) {
        setSentPromptId(response.promptId)
        return
      }
      if (result.status === 401) {
        unpaired()
        return
      }
      setNotice(
        result.status === 409
          ? 'That screen has moved on. Check the display.'
          : (result.error ?? 'Something went wrong. Try again.'),
      )
    },
    [token, unpaired],
  )

  if (token === undefined) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    )
  }

  if (!token) return <PosDisplayPairingScreen onPaired={paired} />

  return (
    <Box sx={{ position: 'relative', minHeight: '100dvh' }}>
      {offline ? (
        <Alert severity="warning" sx={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          Reconnecting…
        </Alert>
      ) : null}
      <PosDisplayBody
        key={promptKey}
        state={state}
        branding={branding}
        busy={busy}
        notice={notice}
        answered={Boolean(
          state && (state.answered || (state.promptId && state.promptId === sentPromptId)),
        )}
        thanksOver={thanksOver}
        onAnswer={answer}
      />
      <UnpairControl
        onUnpair={async () => {
          await forgetDisplay(token)
          unpaired()
        }}
      />
    </Box>
  )
}

/**
 * The screen for the current mode. Keyed by mode and prompt where it is
 * used, so moving on unmounts every input the customer typed into.
 */
function PosDisplayBody({
  state,
  branding,
  busy,
  notice,
  answered,
  thanksOver,
  onAnswer,
}: {
  state: PosDisplayPublicState | null
  branding: PosDisplayBranding | null
  busy: boolean
  notice: string | null
  answered: boolean
  thanksOver: boolean
  onAnswer: (answer: PosDisplayAnswer) => void
}) {
  const idle = <PosDisplayBrandScreen branding={branding} message={branding?.message || 'Welcome'} />
  if (!state || state.mode === 'idle') return idle

  if (state.mode === 'thanks') {
    if (thanksOver) return idle
    return <PosDisplayBrandScreen branding={branding} title="Thank you!" />
  }

  if (state.mode === 'processing') {
    const due = state.cart?.dueCents ?? state.cart?.totalCents
    return (
      <PosDisplayBrandScreen
        branding={branding}
        title={state.processing?.message || 'Tap, insert or swipe your card on the reader.'}
        message={due ? `Total ${displayMoney(due, state.currency)}` : undefined}
        busy
      />
    )
  }

  if ((state.mode === 'tip' || state.mode === 'receipt') && answered) {
    return <PosDisplayBrandScreen branding={branding} title="Thanks — the cashier will finish up" />
  }

  const promptId = state.promptId ?? ''
  let body: ReactNode
  if (state.mode === 'tip' && state.tip && promptId) {
    body = (
      <PosDisplayTipScreen
        tip={state.tip}
        promptId={promptId}
        busy={busy}
        currency={state.currency}
        onAnswer={onAnswer}
      />
    )
  } else if (state.mode === 'receipt' && state.receipt && promptId) {
    body = (
      <PosDisplayReceiptScreen
        receipt={state.receipt}
        promptId={promptId}
        busy={busy}
        onAnswer={onAnswer}
      />
    )
  } else if (state.cart) {
    body = <PosDisplayCartView cart={state.cart} currency={state.currency} />
  } else {
    return idle
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={4} sx={{ alignItems: 'center' }}>
        <PosDisplayBrandMark branding={branding} />
        {notice ? (
          <Alert severity="info" sx={{ width: '100%' }}>
            {notice}
          </Alert>
        ) : null}
        {body}
      </Stack>
    </Container>
  )
}

/**
 * Unpairing, tucked into a corner behind a confirmation: the person at the
 * counter is a customer, and one stray tap must not take the screen away.
 */
function UnpairControl({ onUnpair }: { onUnpair: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Button
        size="small"
        color="inherit"
        onClick={() => setOpen(true)}
        sx={(theme) => ({
          position: 'fixed',
          right: theme.spacing(1),
          bottom: theme.spacing(1),
          opacity: 0.4,
        })}
      >
        Unpair this display
      </Button>
      <Dialog open={open} onClose={() => (busy ? undefined : setOpen(false))}>
        <DialogTitle>Unpair this display?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            It stops showing sales from the register. To use it again, enter a new code from the
            register.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onUnpair()
              setBusy(false)
              setOpen(false)
            }}
          >
            Unpair
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
