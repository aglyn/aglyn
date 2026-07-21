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
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo } from 'react'
import { docsHelp } from '../../constants/docs-links'
import useFirestoreCollection from '../../hooks/use-firestore-collection'

const KIND_ORDER: Array<{ kind: TemplateKind; heading: string; blurb: string }> =
  [
    {
      kind: 'page',
      heading: 'Pages',
      blurb: 'Start a new screen from a saved layout of content.',
    },
    {
      kind: 'component',
      heading: 'Components',
      blurb: 'Drop a saved element tree onto any screen.',
    },
    {
      kind: 'layout',
      heading: 'Layouts',
      blurb: 'Reuse saved page chrome — header, footer, navigation.',
    },
  ]

function sourceChip(source: { type?: string; listingId?: string } | undefined) {
  if (source?.type === 'marketplace') {
    return { label: 'Marketplace', color: 'secondary' as const }
  }
  if (source?.type === 'starter') {
    return { label: 'Starter', color: 'default' as const }
  }
  return { label: 'Saved here', color: 'default' as const }
}

/**
 * Templates library (AGL-667).
 *
 * Templates are inert: nothing here is on the live site until it is used,
 * which is what lets marketplace downloads land somewhere safe instead of
 * publishing pages the moment you click install.
 *
 * Grouped by kind rather than listed flat because the three kinds are used
 * in completely different places — a page template makes a screen, a
 * component template goes onto one.
 */
export function HostTemplatesCard({ hostId }: { hostId: string }) {
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: templateDocs, status } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'templates'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const byKind = useMemo(() => {
    const groups = new Map<string, any[]>()
    for (const template of templateDocs ?? []) {
      if (template.deletedAt) continue
      const kind = template.kind ?? 'page'
      groups.set(kind, [...(groups.get(kind) ?? []), template])
    }
    for (const list of groups.values()) {
      list.sort((a, b) =>
        String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
      )
    }
    return groups
  }, [templateDocs])

  const total = useMemo(
    () => (templateDocs ?? []).filter((entry: any) => !entry.deletedAt).length,
    [templateDocs],
  )

  const handleDelete = useCallback(
    (template: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this template?',
        description:
          `"${template.displayName ?? template.$id}" is removed from your ` +
          'library. Anything you already created from it is unaffected.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      // Soft delete, matching reusable components — a template may be the
      // only remaining copy of a page someone deleted.
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'templates', template.$id),
        { deletedAt: Timestamp.now() },
      )
      enqueueSnackbar('Template deleted', { variant: 'success', persist: false })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header={'Templates'}
      help={docsHelp('templatesLibrary', { anchor: '#the-three-kinds' })}
      contentGutterX
      contentGutterY
    >
      {status === 'loading' ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : total === 0 ? (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {'No templates yet. Save one from the Screens, Layouts or ' +
              'Components list — look for “Save as template” — or install ' +
              'one from the marketplace.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {'Templates stay out of your live site until you use them.'}
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={3}>
          {KIND_ORDER.map(({ kind, heading, blurb }) => {
            const entries = byKind.get(kind) ?? []
            if (!entries.length) return null
            return (
              <Stack key={kind} spacing={1}>
                <Stack spacing={0.25}>
                  <Typography variant="subtitle2">{heading}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {blurb}
                  </Typography>
                </Stack>
                {entries.map((template: any) => {
                  const chip = sourceChip(template.source)
                  return (
                    <Stack
                      key={template.$id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center' }}
                    >
                      <Stack sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {template.displayName ?? template.$id}
                        </Typography>
                        {template.description ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                          >
                            {template.description}
                          </Typography>
                        ) : null}
                      </Stack>
                      {/* Provenance is server-managed (AGL-666), so this
                          badge means something — a client cannot claim a
                          marketplace origin for its own work. */}
                      <Tooltip
                        title={
                          template.source?.type === 'marketplace'
                            ? `Installed from the marketplace${
                                template.source.version
                                  ? ` (v${template.source.version})`
                                  : ''
                              }`
                            : template.source?.type === 'starter'
                              ? 'A first-party starter template'
                              : 'Saved from this site'
                        }
                      >
                        <Chip size="small" label={chip.label} color={chip.color} />
                      </Tooltip>
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDelete(template)}
                      >
                        {'Delete'}
                      </Button>
                    </Stack>
                  )
                })}
              </Stack>
            )
          })}
        </Stack>
      )}
    </CardDisplay>
  )
}

HostTemplatesCard.displayName = 'HostTemplatesCard'

export default HostTemplatesCard
