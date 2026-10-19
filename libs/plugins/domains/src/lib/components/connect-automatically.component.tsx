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

import type { ConsoleHostDomainConnectZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import {
  DOMAIN_CONNECT_RETURN_CHANNEL,
  isDomainConnectReturnMessage,
  looksLikeFullDomain,
  type DomainConnectDiscoverResponse,
  type DomainConnectFinishResponse,
  type DomainConnectStartResponse,
} from '../model/domain-connect'

/*
 * "Connect automatically" under the domain typed into the Custom domain card
 * (AGL-3963).
 *
 * Draws NOTHING until the domain's DNS provider is known to apply Aglyn's
 * records — no spinner, no "checking", no apology — so for most domains the
 * card looks exactly as it does without this plugin, and the printed
 * records stay the way to connect.
 *
 * When it can help: one button that opens the provider in a popup, where the
 * owner signs in and approves. This page then asks `domain-connect/finish`
 * every ten seconds for five minutes, and at once when the provider's return
 * page says it is done. The records usually resolve within the first minute;
 * after five, the console sweep finishes the connect on its own.
 *
 * A blocked popup sends this tab to the provider instead, and the session's
 * state rides in `sessionStorage` so the page it comes back to resumes.
 */

const DEBOUNCE_MS = 600
const POLL_MS = 10_000
const POLL_FOR_MS = 5 * 60 * 1000
const RESUME_KEY = (hostId: string) => `aglyn.domainConnect.${hostId}`

interface ActiveSession {
  state: string
  providerName: string
  domain: string
  startedAtMs: number
}

type Phase = 'idle' | 'starting' | 'provider' | 'checking'

function readResume(hostId: string): ActiveSession | null {
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY(hostId))
    const value = raw ? (JSON.parse(raw) as ActiveSession) : null
    return value && typeof value.state === 'string' && typeof value.providerName === 'string' ? value : null
  } catch {
    return null
  }
}

function writeResume(hostId: string, session: ActiveSession | null): void {
  try {
    if (session) window.sessionStorage.setItem(RESUME_KEY(hostId), JSON.stringify(session))
    else window.sessionStorage.removeItem(RESUME_KEY(hostId))
  } catch {
    // Private windows refuse storage; the sweep still finishes the session.
  }
}

/** The plain-language reason a session ended without connecting. */
export function domainConnectFailureMessage(answer: Pick<DomainConnectFinishResponse, 'status' | 'code' | 'providerName'>): string {
  const provider = answer.providerName || 'Your DNS provider'
  if (answer.status === 'cancelled') return `You canceled at ${provider}, so nothing was changed.`
  if (answer.status === 'expired') {
    return 'Your domain did not point here within 48 hours. Try again, or add the records above.'
  }
  switch (answer.code) {
    case 'taken':
      return 'That domain is already connected to another site.'
    case 'held-elsewhere':
      return 'That domain is registered to another account on our hosting platform. Contact support with the domain name.'
    case 'not-admin':
    case 'not-entitled':
    case 'plugin-off':
    case 'locked':
    case 'unknown-site':
      return 'This site can no longer connect a domain automatically. Add the records above instead.'
    default:
      return answer.code?.startsWith('provider:')
        ? `${provider} could not make the change. Try again, or add the records above.`
        : 'Something went wrong connecting your domain. Try again, or add the records above.'
  }
}

export default function ConnectAutomatically(props: ConsoleHostDomainConnectZoneProps) {
  const { hostId, domain, onConnected } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [typed, setTyped] = useState('')
  const [providerName, setProviderName] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const [active, setActiveState] = useState<ActiveSession | null>(null)
  // The session the polling loop reads, which a render-time value would hold stale.
  const activeRef = useRef<ActiveSession | null>(null)
  const setActive = useCallback((session: ActiveSession | null) => {
    activeRef.current = session
    setActiveState(session)
  }, [])
  const pollRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; busy: boolean }>({
    timer: null,
    busy: false,
  })

  // Debounced: a discovery per pause in typing, not per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setTyped(domain.trim().toLowerCase()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [domain])

  useEffect(() => {
    setProblem(null)
    if (!looksLikeFullDomain(typed) || !user) {
      setProviderName(null)
      return
    }
    let current = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/${DOMAINS_API_ROUTES.connectDiscover}?hostId=${encodeURIComponent(hostId)}&domain=${encodeURIComponent(typed)}`,
        )
        const answer = response.ok ? ((await response.json()) as DomainConnectDiscoverResponse) : null
        if (current) setProviderName(answer?.supported ? answer.providerName : null)
      } catch {
        if (current) setProviderName(null)
      }
    })()
    return () => {
      current = false
    }
  }, [typed, hostId, user])

  const stopPolling = useCallback(() => {
    if (pollRef.current.timer) clearTimeout(pollRef.current.timer)
    pollRef.current.timer = null
  }, [])

  const settle = useCallback(
    (answer: DomainConnectFinishResponse) => {
      stopPolling()
      writeResume(hostId, null)
      setActive(null)
      setPhase('idle')
      if (answer.status === 'connected') {
        const pending = answer.code === 'serving-pending' || answer.code === 'attach-pending'
        enqueueSnackbar(
          pending ? `"${answer.domain}" connected — one more step before it serves` : `"${answer.domain}" connected`,
          { variant: pending ? 'warning' : 'success', persist: false },
        )
        onConnected()
        return
      }
      setProblem(domainConnectFailureMessage(answer))
    },
    [enqueueSnackbar, hostId, onConnected, setActive, stopPolling],
  )

  const check = useCallback(
    async (session: ActiveSession) => {
      if (!user || pollRef.current.busy) return
      pollRef.current.busy = true
      try {
        const response = await authorizedFetch(user, `/api/${DOMAINS_API_ROUTES.connectFinish}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, state: session.state }),
        })
        if (response.status === 404) {
          // The session is gone or not this member's: nothing left to watch.
          stopPolling()
          writeResume(hostId, null)
          setActive(null)
          setPhase('idle')
          return
        }
        if (!response.ok) return
        const answer = (await response.json()) as DomainConnectFinishResponse
        if (answer.status === 'started') setPhase('provider')
        else if (answer.status === 'applied' || answer.status === 'waiting') setPhase('checking')
        else settle(answer)
      } catch {
        // A dropped request is retried on the next tick.
      } finally {
        pollRef.current.busy = false
      }
    },
    [hostId, setActive, settle, stopPolling, user],
  )

  const poll = useCallback(
    (session: ActiveSession) => {
      stopPolling()
      const tick = async () => {
        await check(session)
        if (Date.now() - session.startedAtMs >= POLL_FOR_MS) {
          stopPolling()
          if (activeRef.current?.state === session.state) {
            setActive(null)
            setPhase('idle')
            setProblem(
              `We haven’t heard back from ${session.providerName} yet. If you approved the change, ` +
                'your domain connects on its own once it points here.',
            )
            writeResume(hostId, null)
          }
          return
        }
        // Settled while this tick was asking: no next tick.
        if (activeRef.current?.state !== session.state) return
        pollRef.current.timer = setTimeout(tick, POLL_MS)
      }
      pollRef.current.timer = setTimeout(tick, POLL_MS)
    },
    [check, hostId, setActive, stopPolling],
  )

  // Back from the provider in this same tab: pick the session up again.
  useEffect(() => {
    const resumed = readResume(hostId)
    if (!resumed || !user) return
    setActive(resumed)
    setProviderName((name) => name ?? resumed.providerName)
    setPhase('checking')
    void check(resumed)
    poll(resumed)
    // Only on arrival: the session's own polling takes it from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, user])

  // The return page says the provider is done: ask now, not at the next tick.
  useEffect(() => {
    if (!active) return
    const onSignal = (data: unknown) => {
      if (isDomainConnectReturnMessage(data)) void check(active)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) onSignal(event.data)
    }
    window.addEventListener('message', onMessage)
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(DOMAIN_CONNECT_RETURN_CHANNEL)
      channel.onmessage = (event) => onSignal(event.data)
    } catch {
      channel = null
    }
    return () => {
      window.removeEventListener('message', onMessage)
      channel?.close()
    }
  }, [active, check])

  useEffect(() => stopPolling, [stopPolling])

  const handleStart = useCallback(async () => {
    if (!user || !typed) return
    setProblem(null)
    setPhase('starting')
    // Opened inside the click, before any await, or the browser blocks it.
    const popup = window.open('', 'aglyn-domain-connect', 'popup,width=750,height=750')
    try {
      const response = await authorizedFetch(user, `/api/${DOMAINS_API_ROUTES.connectStart}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, domain: typed }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        popup?.close()
        setPhase('idle')
        setProblem(
          (body as { error?: string } | null)?.error ??
            'Something went wrong connecting your domain. Try again, or add the records above.',
        )
        return
      }
      const started = body as DomainConnectStartResponse
      const session: ActiveSession = {
        state: started.state,
        providerName: started.providerName,
        domain: typed,
        startedAtMs: Date.now(),
      }
      setActive(session)
      if (!popup || popup.closed) {
        writeResume(hostId, session)
        window.location.assign(started.url)
        return
      }
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - started.width) / 2))
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - started.height) / 2))
      try {
        popup.resizeTo(started.width, started.height)
        popup.moveTo(left, top)
      } catch {
        // A browser that refuses to size a popup still shows it.
      }
      popup.location.href = started.url
      setPhase('provider')
      poll(session)
    } catch {
      popup?.close()
      setPhase('idle')
      setProblem('Something went wrong connecting your domain. Try again, or add the records above.')
    }
  }, [hostId, poll, setActive, typed, user])

  const name = active?.providerName ?? providerName
  if (!name && !problem) return null

  return (
    <Stack spacing={1} sx={{ maxWidth: 520 }}>
      {name && phase === 'idle' && !active && (
        <>
          <div>
            <Button variant="contained" color="primary" onClick={handleStart}>
              Connect automatically with {name}
            </Button>
          </div>
          <Typography variant="caption" color="text.secondary">
            {name} will ask you to sign in and approve the change. No records to copy.
          </Typography>
        </>
      )}
      {(phase === 'starting' || phase === 'provider' || phase === 'checking') && name && (
        <Stack direction="row" spacing={1} role="status" sx={{ alignItems: 'center' }}>
          <CircularProgress size={16} />
          <Typography variant="body2">
            {phase === 'checking' ? 'Checking your domain…' : `Waiting for ${name}…`}
          </Typography>
        </Stack>
      )}
      {problem && (
        <Alert severity="info" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      )}
    </Stack>
  )
}
