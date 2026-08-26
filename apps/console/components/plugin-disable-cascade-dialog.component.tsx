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
  PLUGIN_CASCADE_IS_DECLARED_ONLY,
  PUBLISHED_SITE_IMPACT,
  type PublishedSiteImpact,
} from '@aglyn/aglyn'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'

export interface CascadeEntry {
  id: string
  label: string
}

export interface PluginDisableCascadeDialogProps {
  open: boolean
  /** The plugin the user actually switched off. */
  pluginId: string
  pluginLabel: string
  /** Everything that must go off with it — already closed transitively. */
  cascade: readonly CascadeEntry[]
  /**
   * `org` disables for every site in the workspace; `site` for one. The org
   * path cascades further because a site can never enable what the workspace
   * has switched off.
   */
  scope: 'org' | 'site'
  /**
   * The one host being narrowed, for `site` scope. Supplied only there: it is
   * what lets the dialog state a COUNT instead of a category.
   */
  hostId?: string
  onCancel: () => void
  onConfirm: () => void
}

/** What one cascaded plugin does to a site that is already published. */
function consequenceOf(impact: PublishedSiteImpact | undefined): string {
  if (impact === 'elements')
    return 'Elements already placed on published pages stop rendering.'
  if (impact === 'routes')
    return 'Pages it serves stop being served on published sites.'
  return 'Leaves navigation and the editor. Published pages are unaffected.'
}

interface ImpactCount {
  placements: number
  affectedScreens: number
  truncated: boolean
}

/**
 * What else goes off, before it goes off (AGL-2486).
 *
 *
 * Naming the dependents is the easy half. The half that decides whether this
 * dialog is worth reading is the CONSEQUENCE, and there are two of them:
 * a plugin that registers site components has its already-placed elements stop
 * rendering on live pages (AGL-1014), while one that registers none merely
 * stops being offered. "3 elements on 2 published pages will stop rendering"
 * is a different decision from "these blocks will no longer be offered", so
 * this deliberately does not use one sentence for both.
 *
 * Where a real count is reachable it is shown instead of the category: for a
 * single site, `/api/hosts/plugin-impact` counts placements on the published
 * version of every screen, layout and component. At org scope the same disable
 * lands on every site in the workspace, and the dialog says that rather than
 * quoting a number it has not measured.
 *
 * The count is a FLOOR, never a ceiling — the scan caps per collection and
 * reports `truncated`, and drafts are not scanned at all. It is rendered with
 * "at least" whenever the scan says so, because a confirmation that rounds a
 * lower bound into a total is a confirmation people are right to stop reading.
 */
export function PluginDisableCascadeDialog(
  props: PluginDisableCascadeDialogProps,
) {
  const { open, pluginId, pluginLabel, cascade, scope, hostId, onCancel, onConfirm } =
    props
  const { data: user } = useUser()
  const [counts, setCounts] = useState<Record<string, ImpactCount>>({})
  const [loading, setLoading] = useState(false)

  const cascadeKey = cascade.map((entry) => entry.id).join(',')

  /**
   * `user` is read through a ref, and the effect below depends on a STRING.
   *
   * Not a style preference — the obvious spelling of this hangs the browser.
   * `useUser()` hands back a fresh object every render, so a `useCallback`
   * that lists it re-identifies on every render; an effect depending on that
   * callback re-fires, `setLoading` re-renders, and the loop never settles.
   * It cost a twenty-minute test run that looked like slow infrastructure
   * rather than the infinite render it was.
   */
  const userRef = useRef(user)
  userRef.current = user

  /** Everything the scan depends on, as one primitive. */
  const impactKey = open ? `${pluginId}|${cascadeKey}|${hostId ?? ''}` : ''

  useEffect(() => {
    if (!impactKey) {
      setCounts({})
      setLoading(false)
      return
    }
    // Only a single site can be counted, and only for the plugins whose
    // elements are what break. Everything else is a category, not a number.
    // The plugin being disabled is counted alongside its dependents: it is
    // usually the element-heavy one — Commerce is — so costing only the
    // cascade would stay silent about the largest consequence on the screen.
    const [primaryId, cascadeIds, host] = [
      impactKey.split('|')[0],
      impactKey.split('|')[1],
      impactKey.split('|')[2],
    ]
    const countable = [primaryId, ...cascadeIds.split(',')].filter(
      (id) => id && PUBLISHED_SITE_IMPACT[id] === 'elements',
    )
    if (!host || !countable.length) {
      setCounts({})
      return
    }
    let active = true
    setLoading(true)
    void (async () => {
      try {
        const idToken = await (
          userRef.current as { getIdToken?: () => Promise<string> }
        )?.getIdToken?.()
        const results = await Promise.all(
          countable.map(async (id) => {
            const response = await fetch('/api/hosts/plugin-impact', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
              },
              body: JSON.stringify({ pluginId: id, hostIds: [host] }),
            })
            if (!response.ok) return null
            return [id, (await response.json()) as ImpactCount] as const
          }),
        )
        if (!active) return
        setCounts(
          Object.fromEntries(
            results.filter(Boolean) as (readonly [string, ImpactCount])[],
          ),
        )
      } catch {
        // A failed scan must not block the decision, and must not invent a
        // number either — the category sentence stands on its own.
        if (active) setCounts({})
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [impactKey])

  const sentenceFor = (entry: CascadeEntry): string => {
    const impact = PUBLISHED_SITE_IMPACT[entry.id]
    const count = counts[entry.id]
    if (impact !== 'elements' || !count) return consequenceOf(impact)
    if (!count.placements)
      return 'Nothing is placed on this site’s published pages, so nothing stops rendering.'
    const qualifier = count.truncated ? 'At least ' : ''
    const elements = `${count.placements} element${count.placements === 1 ? '' : 's'}`
    const pages = `${count.affectedScreens} published page${count.affectedScreens === 1 ? '' : 's'}`
    return `${qualifier}${elements} on ${pages} will stop rendering.`
  }

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>
        {`Disabling ${pluginLabel} also disables ${cascade.length} other plugin${cascade.length === 1 ? '' : 's'}`}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2">
            {scope === 'org'
              ? `These plugins depend on ${pluginLabel} and cannot run without it. Continuing switches them off for every site in this workspace.`
              : `These plugins depend on ${pluginLabel} and cannot run without it. Continuing switches them off for this site.`}
          </Typography>
          <List dense disablePadding>
            {/*
              The plugin being switched off is listed FIRST, with its own
              consequence. It is normally the element-heavy one, so a dialog
              that costed only the cascade would be silent about the largest
              thing on the screen — and "and 3 elements on 2 published pages
              of your own stop rendering" is the sentence that changes minds.
            */}
            <ListItem disableGutters>
              <ListItemText
                primary={`${pluginLabel} (the one you switched off)`}
                secondary={sentenceFor({ id: pluginId, label: pluginLabel })}
              />
            </ListItem>
            {cascade.map((entry) => (
              <ListItem key={entry.id} disableGutters>
                <ListItemText
                  primary={`${entry.label} — depends on ${pluginLabel}`}
                  secondary={sentenceFor(entry)}
                />
              </ListItem>
            ))}
          </List>
          {loading ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">
                {'Checking what is placed on this site’s published pages…'}
              </Typography>
            </Stack>
          ) : null}
          {scope === 'org' ? (
            <Typography variant="caption" color="text.secondary">
              {'This applies to every site in the workspace. A site cannot ' +
                'turn back on what the workspace has switched off.'}
            </Typography>
          ) : null}
          <Alert severity="warning" variant="outlined">
            {'Turning ' +
              pluginLabel +
              ' back on later does NOT switch these back on — you will need to ' +
              're-enable each one yourself.'}
          </Alert>
          <Typography variant="caption" color="text.secondary">
            {PLUGIN_CASCADE_IS_DECLARED_ONLY}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{'Cancel'}</Button>
        <Button color="warning" variant="contained" onClick={onConfirm}>
          {'Continue and disable those too'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
PluginDisableCascadeDialog.displayName = 'PluginDisableCascadeDialog'

export default PluginDisableCascadeDialog
