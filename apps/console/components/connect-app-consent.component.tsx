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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { planLabelGrantingFeature } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { BackgroundImageComponent } from '@aglyn/shared-ui-jsx/components/background-image.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'

/**
 * The connector consent screen (AGL-4225): which app is asking, where it will
 * take the person back to, which workspace, and what it may do — then Allow
 * or Cancel.
 *
 * Everything shown comes from `/api/oauth/consent`, which checks the request
 * first. The page never navigates anywhere that route did not return, so an
 * address in the query is never followed on its own say-so. Nothing here
 * expires in front of the person: the request is checked when the page opens
 * and again when they press Allow, and the one-time code is minted by that
 * press and delivered by the same navigation.
 *
 * The words are the customer's, not the protocol's: an app, a workspace,
 * "View only".
 */

type AccessLevel = 'view' | 'change'

interface Workspace {
  orgId: string
  name: string
  slug: string
  entitled: boolean
}

interface AccessChoice {
  level: AccessLevel
  areas: Array<{ area: string; abilities: string[] }>
}

interface Description {
  app: { name: string; returnsTo: string; local: boolean }
  workspaces: Workspace[]
  access: AccessChoice[]
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; description: Description }
  | { kind: 'refused'; title: string; body: string }
  | { kind: 'leaving' }

const ACCESS_LABELS: Record<AccessLevel, string> = {
  view: 'View only',
  change: 'View and make changes',
}

/** What the page says when the request itself cannot be used. */
function refusalFor(status: number, payload: { error?: string; reason?: string }): Phase {
  if (payload.reason === 'unknown_client' || payload.reason === 'invalid_redirect_uri' || payload.reason === 'invalid_request') {
    return {
      kind: 'refused',
      title: 'This link can’t connect an app',
      body: 'Start again from the app you were connecting. If it keeps happening, the app may need to be set up again.',
    }
  }
  if (payload.reason === 'impersonation') {
    return {
      kind: 'refused',
      title: 'Only the account holder can connect an app',
      body: 'Sign in as yourself to connect an app to a workspace.',
    }
  }
  return {
    kind: 'refused',
    title: 'Something went wrong',
    body:
      status === 401
        ? 'Your session has ended. Sign in again, then start again from the app you were connecting.'
        : payload.error ?? 'Please try again in a moment.',
  }
}

export interface ConnectAppConsentProps {
  /** How the page leaves. A full navigation; replaceable in a spec. */
  navigate?: (url: string) => void
}

const assignLocation = (url: string) => window.location.assign(url)

export function ConnectAppConsent({ navigate = assignLocation }: ConnectAppConsentProps) {
  const { data: user } = useUser()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [orgId, setOrgId] = useState('')
  const [level, setLevel] = useState<AccessLevel>('view')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const started = useRef(false)

  /** The app's request exactly as it arrived, duplicates and all. */
  const query = typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, '')

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await authorizedFetch(user, '/api/oauth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, query }),
      })
      const payload = await response.json().catch(() => ({}))
      return { response, payload }
    },
    [user, query],
  )

  /** Follow an address the server returned. Never one read from the page. */
  const leave = (redirectTo: string) => {
    setPhase({ kind: 'leaving' })
    navigate(redirectTo)
  }

  useEffect(() => {
    if (!user || started.current) return
    started.current = true
    void (async () => {
      try {
        const { response, payload } = await send({ action: 'describe' })
        if (response.ok && typeof payload.redirectTo === 'string') return leave(payload.redirectTo)
        if (!response.ok) return setPhase(refusalFor(response.status, payload))
        const description = payload as Description
        const first = description.workspaces.find((workspace) => workspace.entitled)
        setOrgId(first?.orgId ?? '')
        setLevel(description.access[0]?.level ?? 'view')
        setPhase({ kind: 'ready', description })
      } catch {
        setPhase(refusalFor(0, {}))
      }
    })()
  }, [user, send])

  const decide = async (action: 'allow' | 'deny') => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      const { response, payload } = await send(
        action === 'allow' ? { action, orgId, access: level } : { action },
      )
      if (response.ok && typeof payload.redirectTo === 'string') return leave(payload.redirectTo)
      if (response.status === 400 && payload.reason) return setPhase(refusalFor(400, payload))
      setProblem(payload.error ?? 'We couldn’t finish connecting. Please try again.')
    } catch {
      setProblem('We couldn’t reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BackgroundImageComponent
      url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 2, md: 3 },
        color: 'text.primary',
      }}
    >
      <Box sx={{ width: 520, maxWidth: 1 }}>
        {phase.kind === 'loading' || phase.kind === 'leaving' ? (
          <Stack spacing={2} sx={{ alignItems: 'center', py: 6 }}>
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary">
              {phase.kind === 'leaving' ? 'Taking you back…' : 'Getting things ready…'}
            </Typography>
          </Stack>
        ) : phase.kind === 'refused' ? (
          <CardDisplay header={phase.title} contentGutterX contentGutterY>
            <Typography variant="body2" color="text.secondary">
              {phase.body}
            </Typography>
          </CardDisplay>
        ) : (
          <ConsentCard
            account={user?.email ?? null}
            description={phase.description}
            orgId={orgId}
            onOrgId={setOrgId}
            level={level}
            onLevel={setLevel}
            busy={busy}
            problem={problem}
            onAllow={() => void decide('allow')}
            onCancel={() => void decide('deny')}
          />
        )}
      </Box>
    </BackgroundImageComponent>
  )
}
ConnectAppConsent.displayName = 'ConnectAppConsent'

interface ConsentCardProps {
  /** The signed-in address doing the approving, so a wrong account is seen. */
  account: string | null
  description: Description
  orgId: string
  onOrgId: (orgId: string) => void
  level: AccessLevel
  onLevel: (level: AccessLevel) => void
  busy: boolean
  problem: string | null
  onAllow: () => void
  onCancel: () => void
}

function ConsentCard(props: ConsentCardProps) {
  const { account, description, orgId, onOrgId, level, onLevel, busy, problem, onAllow, onCancel } = props
  const { app, workspaces, access } = description
  const planLabel = planLabelGrantingFeature('apiAccess') ?? 'Pro'
  const chosen = access.find((choice) => choice.level === level) ?? access[0]
  const canAllow = Boolean(orgId) && Boolean(chosen) && !busy

  return (
    <CardDisplay
      header={`Connect ${app.name}`}
      subheader={
        app.local
          ? `${app.name}, an app on this computer, wants to use one of your ${PLATFORM_BRAND_NAME} workspaces.`
          : `${app.name} wants to use one of your ${PLATFORM_BRAND_NAME} workspaces. When you’re done you’ll go back to ${app.returnsTo}.`
      }
      contentGutterX
      contentGutterY
    >
      <Stack spacing={3}>
        <Stack spacing={1}>
          {account ? (
            <Typography variant="body2">
              {'Signed in as '}
              <strong>{account}</strong>
            </Typography>
          ) : null}
          <Alert severity="warning">
            {`Only continue if you started connecting ${app.name} yourself, just now. If you didn’t, choose Cancel.`}
          </Alert>
        </Stack>
        {workspaces.length === 0 ? (
          <Alert severity="info">
            {'You don’t manage API access in any workspace, so there is nothing to connect yet. ' +
              'Ask a workspace admin to connect it, or to give your role “Manage API keys”.'}
          </Alert>
        ) : (
          <FormControl>
            <FormLabel id="connect-workspace">{'Workspace'}</FormLabel>
            <RadioGroup
              aria-labelledby="connect-workspace"
              value={orgId}
              onChange={(event) => onOrgId(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <Box key={workspace.orgId}>
                  <FormControlLabel
                    value={workspace.orgId}
                    control={<Radio />}
                    label={workspace.name}
                    disabled={!workspace.entitled}
                  />
                  {!workspace.entitled ? (
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ ml: 4, mt: -0.5 }}>
                      {`Connecting apps is included on the ${planLabel} plan. `}
                      {workspace.slug ? (
                        <AppLink href={`${buildRoute(Route.MANAGE_BILLING, { orgSlug: workspace.slug })}#plans`}>
                          {'See plans'}
                        </AppLink>
                      ) : null}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </RadioGroup>
          </FormControl>
        )}

        {access.length > 1 ? (
          <FormControl>
            <FormLabel id="connect-access">{`What ${app.name} can do`}</FormLabel>
            <RadioGroup
              aria-labelledby="connect-access"
              value={level}
              onChange={(event) => onLevel(event.target.value as AccessLevel)}
            >
              {access.map((choice) => (
                <FormControlLabel
                  key={choice.level}
                  value={choice.level}
                  control={<Radio />}
                  label={ACCESS_LABELS[choice.level]}
                />
              ))}
            </RadioGroup>
          </FormControl>
        ) : chosen ? (
          <Typography variant="subtitle2">{`${app.name} will get: ${ACCESS_LABELS[chosen.level]}`}</Typography>
        ) : null}

        {chosen ? (
          <Stack spacing={1.5}>
            {chosen.areas.map((area) => (
              <Box key={area.area}>
                <Typography variant="subtitle2">{area.area}</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {area.abilities.map((ability) => (
                    <Typography key={ability} component="li" variant="body2" color="text.secondary">
                      {ability}
                    </Typography>
                  ))}
                </Box>
              </Box>
            ))}
          </Stack>
        ) : null}

        <Typography variant="caption" color="text.secondary">
          {'You can disconnect it at any time in the workspace’s Settings, under API keys.'}
        </Typography>

        {problem ? <Alert severity="error">{problem}</Alert> : null}

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button color="inherit" onClick={onCancel} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" color="primary" onClick={onAllow} disabled={!canAllow}>
            {busy ? 'Connecting…' : 'Allow'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

export default ConnectAppConsent
