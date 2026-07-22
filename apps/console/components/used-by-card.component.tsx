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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import { useHostSubdomain } from './host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'

interface Dependent {
  type: 'screen' | 'layout' | 'component' | 'workflow' | 'variable'
  id: string
  name: string
  versionId?: string
}

/**
 * What the scan actually covers, per kind. Stated on the card rather than
 * assumed: "Used by" is read as a deletion-safety answer, and an unstated
 * boundary turns "nothing listed" into a promise the scan never made.
 */
const SCOPE_NOTE: Record<'component' | 'layout', string> = {
  component:
    'Scanned: the published version of every screen and layout, plus other ' +
    'components — a component can be placed inside another one. Unpublished ' +
    'drafts and library templates are not scanned.',
  layout:
    'Scanned: every screen that renders inside this layout, and every ' +
    'layout nested inside it — deleting this one unwraps the screens ' +
    'under those too. Published or not, everything is scanned.',
}

/**
 * "Used by" card for a component or layout detail page (AGL-703).
 *
 * Deleting a component or a layout used to be a guess. This answers it from
 * the runtime's own reference model — reusable-instance `props.refId` for
 * components, `screen.layoutId` for layouts.
 *
 * A failed scan renders as a FAILURE, never as an empty list. The sibling
 * `fetchWhereUsed` helper deliberately fails open because it only warns
 * before a delete that would proceed anyway; here the card IS the answer, so
 * silently showing "nothing uses this" after a network error would be the
 * card actively inviting the deletion it exists to prevent.
 */
export function UsedByCard({
  hostId,
  kind,
  id,
  noun,
}: {
  hostId: string
  kind: 'component' | 'layout'
  id: string
  /** How to name the scanned artifact in copy, e.g. 'component'. */
  noun: string
}) {
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { data: user } = useUser()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dependents, setDependents] = useState<Dependent[]>([])
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!hostId || !id) return
    let active = true
    setStatus('loading')
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/hosts/where-used', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, kind, id }),
        })
        if (!response.ok) throw new Error(`Scan failed (${response.status})`)
        const payload = await response.json()
        if (!active) return
        setDependents((payload?.dependents ?? []) as Dependent[])
        setStatus('ready')
      } catch (error) {
        console.error(error)
        if (!active) return
        setStatus('error')
      }
    })()
    return () => {
      active = false
    }
  }, [hostId, kind, id, user, attempt])

  const hrefFor = useCallback(
    (dependent: Dependent) => {
      if (dependent.type === 'screen' && dependent.versionId) {
        return buildRoute(Route.SCREEN_DETAILS, {
          orgSlug,
          host,
          screenId: dependent.id,
          versionId: dependent.versionId,
        })
      }
      if (dependent.type === 'layout') {
        return buildRoute(Route.LAYOUT_DETAILS, {
          orgSlug,
          host,
          layoutId: dependent.id,
        })
      }
      if (dependent.type === 'component') {
        return buildRoute(Route.COMPONENT_DETAILS, {
          orgSlug,
          host,
          componentId: dependent.id,
        })
      }
      // A screen with no published version has nowhere to link to; the row
      // still has to appear, because it still uses this.
      return null
    },
    [orgSlug, host],
  )

  return (
    <CardDisplay
      header={'Used by'}
      // Deep-links to the "Used by" section of whichever page documents this
      // artifact's reference model — the scope note below is the short form
      // of what that section spells out.
      help={
        kind === 'component'
          ? docsHelp('components', { anchor: '#used-by' })
          : docsHelp('screens', { anchor: '#used-by' })
      }
      contentGutterX
      contentGutterY
    >
      {status === 'loading' ? (
        <Typography variant="body2" color="text.secondary">
          {`Checking what uses this ${noun}…`}
        </Typography>
      ) : status === 'error' ? (
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Alert severity="warning" sx={{ width: '100%' }}>
            {`Could not check what uses this ${noun}. This is not the same ` +
              'as nothing using it — treat deletion as unsafe until the ' +
              'check succeeds.'}
          </Alert>
          <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
            {'Try again'}
          </Button>
        </Stack>
      ) : dependents.length === 0 ? (
        <Stack spacing={1}>
          <Typography variant="body2">
            {`Nothing uses this ${noun} — deleting it changes no live page.`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {SCOPE_NOTE[kind]}
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {`Used in ${dependents.length} place${
              dependents.length === 1 ? '' : 's'
            } — deleting this ${noun} affects each of them.`}
          </Typography>
          {dependents.map((dependent) => {
            const href = hrefFor(dependent)
            return (
              <Stack
                key={`${dependent.type}-${dependent.id}`}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                {href ? (
                  <AppLink href={href}>{dependent.name}</AppLink>
                ) : (
                  <Typography variant="body2" noWrap>
                    {dependent.name}
                  </Typography>
                )}
                <Chip size="small" variant="outlined" label={dependent.type} />
              </Stack>
            )
          })}
          <Typography variant="caption" color="text.secondary">
            {SCOPE_NOTE[kind]}
          </Typography>
        </Stack>
      )}
    </CardDisplay>
  )
}

UsedByCard.displayName = 'UsedByCard'

export default UsedByCard
