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

import * as Aglyn from '@aglyn/aglyn'
import {
  normalizeScreenSlug,
  resolveNamedTokens,
  screenRoutePathToUrl,
} from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useHostResourceApi,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import createPageFromTemplate from './create-page-from-template'

/**
 * Use a template (AGL-670) — the deliberate second step that installing no
 * longer performs.
 *
 * Page templates create a screen and publish its route, matching what
 * "Start from a template" has always done. Layouts and components have no
 * routing, so they simply appear in their respective lists.
 *
 * Placeholders declared by the template are collected here and substituted
 * with `resolveNamedTokens` — the same `{{name}}` mechanism that renders
 * collection entry templates, rather than a third token system.
 */
export function UseTemplateDialog({
  hostId,
  template,
  onClose,
}: {
  hostId: string
  /** Null closes the dialog. */
  template: Record<string, any> | null
  onClose: () => void
}) {
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const { enqueueSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const kind = (template?.kind ?? 'page') as 'page' | 'component' | 'layout'
  const placeholders = useMemo(
    () => (Array.isArray(template?.placeholders) ? template.placeholders : []),
    [template],
  )

  useEffect(() => {
    if (!template) return
    setName(template.displayName ?? '')
    setSlug(
      template.slug ??
        normalizeScreenSlug(template.displayName) ??
        'page',
    )
    setValues(
      Object.fromEntries(
        (Array.isArray(template.placeholders) ? template.placeholders : []).map(
          (entry: any) => [entry.name, entry.defaultValue ?? ''],
        ),
      ),
    )
  }, [template])

  const handleUse = useCallback(async () => {
    if (!template || !name.trim()) return
    setBusy(true)
    try {
      const nodes = resolveNamedTokens(
        (template.nodes ?? {}) as any,
        placeholders.length ? values : null,
      )

      if (kind === 'component') {
        const { id } = await createHostResource({
          hostId,
          resource: 'reusableComponent',
          data: {
            displayName: name.trim(),
            ...(template.description ? { description: template.description } : {}),
            ...(template.rootId ? { rootId: template.rootId } : {}),
            nodes,
          },
        })
        enqueueSnackbar(`Created the component “${name.trim()}”`, {
          variant: 'success',
          persist: false,
        })
        void id
        return void onClose()
      }

      if (kind === 'layout') {
        const layoutId = Aglyn.createResourceUid()
        const versionId = Aglyn.createResourceUid()
        await createHostResource({
          hostId,
          resource: 'layout',
          id: layoutId,
          data: {
            displayName: name.trim(),
            ...(template.description ? { description: template.description } : {}),
            versionId,
          },
        })
        // The layout's first version rides /api/hosts/versions (AGL-1369):
        // rules deny the client create, and the route allows a resource's
        // FIRST version on every plan. `createdAt`/`updatedAt` are stamped
        // server-side there, so no client Timestamp goes over the wire.
        await createHostVersion({
          hostId,
          kind: 'layout',
          parentId: layoutId,
          id: versionId,
          data: {
            layoutId,
            hostId,
            displayName: 'Initial version',
            nodes,
          },
        })
        enqueueSnackbar(`Created the layout “${name.trim()}”`, {
          variant: 'success',
          persist: false,
        })
        return void onClose()
      }

      // page — read the routing map fresh so the slug check reflects
      // anything published since this dialog opened.
      const hostSnapshot = await getDoc(doc(firestore, 'hosts', hostId))
      const used = new Set<string>(
        Object.values((hostSnapshot.get('screens') ?? {}) as Record<string, string>),
      )
      const created = await createPageFromTemplate(
        firestore,
        createHostResource as any,
        createHostVersion as any,
        {
          hostId,
          displayName: name.trim(),
          // Already substituted above so the component and layout branches
          // share the same resolved nodes.
          nodes: nodes as Record<string, unknown>,
          description: template.description,
          seo: template.seo,
          slug,
          usedSlugs: used,
        },
      )
      enqueueSnackbar(
        created.slug === created.requestedSlug
          ? `Created “${name.trim()}” at ${screenRoutePathToUrl(created.slug)}`
          : `Created “${name.trim()}” at ${screenRoutePathToUrl(created.slug)} — ` +
            `${screenRoutePathToUrl(created.requestedSlug)} was taken`,
        { variant: 'success', persist: false },
      )
      onClose()
    } catch (error) {
      // Quota and permission failures come back with a readable message
      // from the resources route; surfacing it beats a generic failure.
      enqueueSnackbar(
        error instanceof Error ? error.message : 'Could not use the template.',
        { variant: 'error', allowDuplicate: true },
      )
    } finally {
      setBusy(false)
    }
  }, [
    template,
    name,
    slug,
    values,
    placeholders.length,
    kind,
    hostId,
    firestore,
    createHostResource,
    createHostVersion,
    enqueueSnackbar,
    onClose,
  ])

  const kindNoun =
    kind === 'component' ? 'component' : kind === 'layout' ? 'layout' : 'page'

  return (
    <Dialog
      open={!!template}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{`Use this template`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {kind === 'page'
              ? 'Creates a new page from this template and publishes it at ' +
                'the address below. The template stays in your library.'
              : `Creates a new ${kindNoun} from this template. The template ` +
                'stays in your library.'}
          </Typography>
          <TextField
            autoFocus
            size="small"
            label={`${kindNoun[0].toUpperCase()}${kindNoun.slice(1)} name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            fullWidth
          />
          {kind === 'page' ? (
            <TextField
              size="small"
              label="Address"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={busy}
              // Mirrors `resolveTemplateSlug`: an address that sanitizes away
              // falls back to the page name, and `/` IS an address — the site
              // root — rather than punctuation to be stripped (AGL-1575).
              helperText={screenRoutePathToUrl(
                normalizeScreenSlug(slug) ??
                  normalizeScreenSlug(name) ??
                  'page',
              )}
              fullWidth
            />
          ) : null}
          {placeholders.length ? (
            <Stack spacing={1.5}>
              <Typography variant="caption" color="text.secondary">
                {'This template asks for:'}
              </Typography>
              {placeholders.map((entry: any) => (
                <TextField
                  key={entry.name}
                  size="small"
                  label={entry.label ?? entry.name}
                  value={values[entry.name] ?? ''}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      [entry.name]: event.target.value,
                    }))
                  }
                  disabled={busy}
                  fullWidth
                />
              ))}
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          size="small"
          variant="contained"
          color="primary"
          onClick={() => void handleUse()}
          disabled={busy || !name.trim()}
        >
          {busy ? 'Creating…' : `Create ${kindNoun}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

UseTemplateDialog.displayName = 'UseTemplateDialog'

export default UseTemplateDialog
