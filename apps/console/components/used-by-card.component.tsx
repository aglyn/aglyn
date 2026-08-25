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
import { useCallback, useEffect, useRef, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import { useHostSubdomain } from './host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'

interface Dependent {
  type:
    | 'screen'
    | 'layout'
    | 'component'
    | 'workflow'
    | 'variable'
    | 'collection'
  id: string
  name: string
  versionId?: string
  /** Screens only: how it references this screen (AGL-703). */
  relation?: 'link' | 'child' | 'template'
}

/**
 * What the scan actually covers, per kind. Stated on the card rather than
 * assumed: "Used by" is read as a deletion-safety answer, and an unstated
 * boundary turns "nothing listed" into a promise the scan never made.
 */
const SCOPE_NOTE: Record<UsedByKind, string> = {
  component:
    'Scanned: the published version of every screen and layout, plus other ' +
    'components — a component can be placed inside another one. Unpublished ' +
    'drafts and library templates are not scanned.',
  layout:
    'Scanned: every screen that renders inside this layout, and every ' +
    'layout nested inside it — deleting this one unwraps the screens ' +
    'under those too. Published or not, everything is scanned.',
  screen:
    'Scanned: link targets on the published version of every screen and ' +
    'layout, on every component, the screens nested under this one, and the ' +
    'collections that render their pages through it. Links typed as plain ' +
    'addresses rather than picked as screens are not scanned — nothing ' +
    'records which screen those meant.',
}

/** The artifacts this card can scan. */
export type UsedByKind = 'component' | 'layout' | 'screen'

/** What a screen dependent's `relation` is called on the row. */
const RELATION_LABEL: Record<'link' | 'child' | 'template', string> = {
  link: 'links here',
  child: 'nested under',
  template: 'renders through',
}

/**
 * "Used by" card for a component, layout, or screen detail page (AGL-703).
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
  kind: UsedByKind
  id: string
  /** How to name the scanned artifact in copy, e.g. 'component'. */
  noun: string
}) {
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { data: user } = useUser()
  /**
   * The signed-in user, held in a REF rather than read from the closure.
   *
   * `user` was in the scan effect's dependency array, and `useUser()` can hand
   * back a fresh object on any re-render — which re-fired the scan on every
   * one of them once the reader had asked. That is the same hundreds-of-reads
   * cost this card was just changed to stop paying, arriving by a different
   * door: not on mount, but on every render after the button.
   *
   * A ref because the token is needed WHEN the scan runs and never decides
   * WHETHER it should — which is exactly the thing a dependency array is for.
   */
  const userRef = useRef(user)
  userRef.current = user
  /**
   * IDLE until the reader asks (AGL-703).
   *
   * The scan reads every screen, every layout, and — for a component — every
   * component definition, decoding published node trees as it goes. On the
   * marketing site's own layout that is 53 dependents found across several
   * hundred document reads, and it was firing on every visit to the detail
   * page whether or not anybody was thinking about deleting anything.
   *
   * So it runs the way the media library's "Find where this is used" runs
   * (AGL-845), and for the same stated reason: *"scanning every published
   * screen, layout, and content entry for this asset's URLs is expensive, so
   * it runs ONLY when the user asks, never on drawer open."* The answer is
   * worth a request; it is not worth one per page view.
   */
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [dependents, setDependents] = useState<Dependent[]>([])
  /**
   * Did the scan read everything it needed to (AGL-703)?
   *
   * The endpoint caps each collection at 200 documents and reads one past the
   * cap so it can say. It used to discard that, so this card printed "nothing
   * uses this — deleting it changes no live page" on the strength of a scan
   * that had stopped looking. Absent reads as INCOMPLETE.
   */
  const [complete, setComplete] = useState(false)
  /**
   * WHICH artifact the reader asked about, and how many times.
   *
   * A counter alone was not enough, and the failure is worth stating because
   * it is invisible: this effect and the reset below both watch `id`, effects
   * run in declaration order, and so switching artifact re-fired the scan
   * with the previous ask still standing — one unrequested scan of the new
   * artifact before the reset could clear the counter. Naming the target
   * inside the ask makes the two agree without depending on their order.
   */
  const target = `${kind}:${id}`
  const [ask, setAsk] = useState<{ target: string; n: number } | null>(null)

  useEffect(() => {
    if (!hostId || !id) return
    // `null` is the un-asked state: mounting must not scan. A stale target is
    // the un-asked state too — see `ask`.
    if (!ask || ask.target !== target) return
    let active = true
    setStatus('loading')
    void (async () => {
      try {
        const idToken = await (userRef.current as any)?.getIdToken?.()
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
        setComplete(payload?.complete === true)
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
    // NOT `user`: see `userRef`. Only an explicit ask may start a scan.
  }, [hostId, kind, id, target, ask])

  /** Every control that starts a scan — first ask, rescan, and retry. */
  const runScan = useCallback(
    () =>
      setAsk((previous) => ({
        target,
        n: previous?.target === target ? previous.n + 1 : 1,
      })),
    [target],
  )

  // Switching artifact throws the previous answer away rather than showing
  // one artifact's dependents under another's name.
  useEffect(() => {
    setStatus('idle')
    setDependents([])
    setComplete(false)
  }, [hostId, kind, id])

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
      if (dependent.type === 'collection') {
        // The collection LIST page: a template binding is changed in the
        // collection's settings, which is where this lands the reader.
        return buildRoute(Route.HOST_CONTENT, { orgSlug, host })
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
          : kind === 'layout'
            ? docsHelp('layouts', { anchor: '#used-by' })
            : // No "Used by" heading on the screens topic to deep-link to —
              // what a screen's dependents ARE is routing, which is the
              // section that explains how a path is built from the tree.
              docsHelp('screens', { anchor: '#screens--routing' })
      }
      contentGutterX
      contentGutterY
    >
      {status === 'idle' ? (
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            {`Find every screen, layout, and component that renders this ` +
              `${noun} before you change or delete it.`}
          </Typography>
          <Button size="small" variant="outlined" onClick={runScan}>
            {'Find where this is used'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {SCOPE_NOTE[kind]}
          </Typography>
        </Stack>
      ) : status === 'loading' ? (
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
          <Button size="small" onClick={runScan}>
            {'Try again'}
          </Button>
        </Stack>
      ) : dependents.length === 0 ? (
        <Stack spacing={1}>
          {/* The unqualified claim is reachable only from a COMPLETE scan.
              A truncated one found nothing and proves nothing, and the two
              must not read alike — that is the whole point of the flag. */}
          {complete ? (
            <Typography variant="body2">
              {`Nothing uses this ${noun} — deleting it changes no live page.`}
            </Typography>
          ) : (
            <Alert severity="warning">
              {`Nothing found, but this site has more content than one pass ` +
                `reads — something may still use this ${noun}.`}
            </Alert>
          )}
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
                <Stack direction="row" spacing={0.5}>
                  {/* WHICH kind of reference, when that changes the answer:
                      a collection template is the only screen dependent that
                      takes a live route down (AGL-703). */}
                  {dependent.relation ? (
                    <Chip
                      size="small"
                      color={
                        dependent.relation === 'template'
                          ? 'warning'
                          : 'default'
                      }
                      variant={
                        dependent.relation === 'template'
                          ? 'filled'
                          : 'outlined'
                      }
                      label={RELATION_LABEL[dependent.relation]}
                    />
                  ) : null}
                  <Chip
                    size="small"
                    variant="outlined"
                    label={dependent.type}
                  />
                </Stack>
              </Stack>
            )
          })}
          <Typography variant="caption" color="text.secondary">
            {SCOPE_NOTE[kind]}
          </Typography>
          <Button
            size="small"
            onClick={runScan}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Rescan'}
          </Button>
        </Stack>
      )}
    </CardDisplay>
  )
}

UsedByCard.displayName = 'UsedByCard'

export default UsedByCard
