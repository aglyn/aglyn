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

import type { TemplateKind } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHostResourceApi } from '@aglyn/tenant-feature-instance'
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
import { useCallback, useEffect, useState } from 'react'
import { detectTemplatePlaceholders } from '@aglyn/aglyn'

export interface SaveAsTemplateSource {
  kind: TemplateKind
  /** Seeds the name field; the user can rename before saving. */
  displayName?: string
  /**
   * Resolves the node map at confirm time rather than up front — a screen's
   * nodes live in a separate version doc, and fetching one per row just to
   * render a menu would be wasteful.
   */
  loadNodes: () => Promise<{
    nodes: Record<string, unknown>
    rootId?: string
    slug?: string
    seo?: Record<string, unknown>
  } | null>
}

/**
 * "Save as template" (AGL-668).
 *
 * Writes through `/api/hosts/resources`, which enforces `templatesPerHost`
 * and stamps `source: {type:'authored'}` itself — the client is deliberately
 * not trusted to describe where a template came from, since the library
 * presents that as provenance.
 */
export function SaveAsTemplateDialog({
  hostId,
  source,
  onClose,
}: {
  hostId: string
  /** Null closes the dialog; a value opens it for that item. */
  source: SaveAsTemplateSource | null
  onClose: () => void
}) {
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (source) {
      setName(source.displayName ?? '')
      setDescription('')
    }
  }, [source])

  const handleSave = useCallback(async () => {
    if (!source || !name.trim()) return
    setSaving(true)
    try {
      const captured = await source.loadNodes()
      if (!captured?.nodes || !Object.keys(captured.nodes).length) {
        // A screen that has never been published has no version doc, so
        // there is genuinely nothing to capture — say so rather than
        // saving an empty template that fails silently on use.
        enqueueSnackbar(
          'Nothing to save yet — publish this first, then save it as a template.',
          { variant: 'warning' },
        )
        return
      }
      // Declared from what the content already contains, so using the
      // template prompts for them (AGL-670). Nothing is rewritten — the
      // tokens were authored in the page itself.
      const placeholders = detectTemplatePlaceholders(captured.nodes).map((token) => ({
        name: token,
      }))
      await createHostResource({
        hostId,
        resource: 'template',
        data: {
          kind: source.kind,
          displayName: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(placeholders.length ? { placeholders } : {}),
          nodes: captured.nodes,
          ...(captured.rootId ? { rootId: captured.rootId } : {}),
          ...(captured.slug ? { slug: captured.slug } : {}),
          ...(captured.seo ? { seo: captured.seo } : {}),
        },
      })
      enqueueSnackbar(
        placeholders.length
          ? `Saved “${name.trim()}” with ${placeholders.length} ` +
            `placeholder${placeholders.length === 1 ? '' : 's'} to fill in ` +
            'when it is used.'
          : `Saved “${name.trim()}” to your templates.`,
        { variant: 'success' },
      )
      onClose()
    } catch (error) {
      // The route returns a readable message for quota and permission
      // failures — surfacing it beats a generic "save failed".
      enqueueSnackbar(
        error instanceof Error ? error.message : 'Could not save the template.',
        { variant: 'error' },
      )
    } finally {
      setSaving(false)
    }
  }, [
    source,
    name,
    description,
    hostId,
    createHostResource,
    enqueueSnackbar,
    onClose,
  ])

  const kindLabel =
    source?.kind === 'component'
      ? 'component'
      : source?.kind === 'layout'
        ? 'layout'
        : 'page'

  return (
    <Dialog open={!!source} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{'Save as template'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {`Saves a copy of this ${kindLabel} to your templates. The ` +
              `original is untouched, and the template stays out of your ` +
              `live site until you use it.`}
          </Typography>
          <TextField
            autoFocus
            size="small"
            label="Template name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={saving}
            fullWidth
          />
          <TextField
            size="small"
            label="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={saving}
            multiline
            minRows={2}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={saving}>
          {'Cancel'}
        </Button>
        <Button
          size="small"
          variant="contained"
          color="secondary"
          onClick={() => void handleSave()}
          disabled={saving || !name.trim()}
        >
          {saving ? 'Saving…' : 'Save template'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

SaveAsTemplateDialog.displayName = 'SaveAsTemplateDialog'

export default SaveAsTemplateDialog
