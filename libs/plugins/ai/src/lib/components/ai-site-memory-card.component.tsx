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

import { aiAddonName, pluginDocsHelp } from '@aglyn/aglyn'
import type { ConsoleHostBusinessProfileZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { Button, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { collection, deleteDoc, doc, limit, query, writeBatch } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  AI_SITE_MEMORY_MAX,
  AI_SITE_MEMORY_SUBCOLLECTION,
  aiSitePreferenceOf,
  type AiSitePreference,
} from '../model/ai-site-memory'

/** The configured brand's AI, never ours by literal (AGL-2153). */
const AI_NAME = aiAddonName()

/** A close mark, drawn inline so the card ships no icon set. */
const ForgetIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden focusable="false">
    <path
      fill="currentColor"
      d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
    />
  </svg>
)

/**
 * What Aglyn AI learned from this site's edits (AGL-3661), on Setup →
 * Business profile: the short preferences the assist edit route distilled
 * from the edits the owner applied, which every later AI job for the site
 * reads. The owner reads them here and forgets one, or all of them.
 *
 * Read and deleted on the client: the rules let a site's members read and
 * delete `aiMemory` and refuse them a create or an update, because a client
 * write would put words of its choosing into later prompts.
 */
export function AiSiteMemoryCard(props: ConsoleHostBusinessProfileZoneProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState(false)
  const { data, status } = useFirestoreCollection<Record<string, unknown> & { $id: string }>(
    () => query(collection(firestore, 'hosts', hostId, AI_SITE_MEMORY_SUBCOLLECTION), limit(AI_SITE_MEMORY_MAX * 2)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const preferences = useMemo(
    () =>
      data
        .map((row) => aiSitePreferenceOf(row.$id, row))
        .filter((row): row is AiSitePreference => row !== null)
        .sort((a, b) => b.count - a.count || b.lastSeenAtMs - a.lastSeenAtMs),
    [data],
  )

  const forget = useCallback(
    async (preference: AiSitePreference) => {
      setBusy(true)
      try {
        await deleteDoc(doc(firestore, 'hosts', hostId, AI_SITE_MEMORY_SUBCOLLECTION, preference.id))
        enqueueSnackbar(`${AI_NAME} will no longer use that preference`, { variant: 'success' })
      } catch (error) {
        console.error('ai memory forget failed', error)
        enqueueSnackbar('That preference was not removed. Try again.', { variant: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [enqueueSnackbar, firestore, hostId],
  )

  const forgetAll = useCallback(async () => {
    const confirmed = await confirm({
      title: `Forget everything ${AI_NAME} learned here?`,
      description:
        `Later AI jobs for this site stop using these preferences. ${AI_NAME} learns again from the edits you apply next.`,
      confirmationText: 'Forget all',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      const batch = writeBatch(firestore)
      for (const preference of preferences) {
        batch.delete(doc(firestore, 'hosts', hostId, AI_SITE_MEMORY_SUBCOLLECTION, preference.id))
      }
      await batch.commit()
      enqueueSnackbar(`${AI_NAME} forgot what it learned on this site`, { variant: 'success' })
    } catch (error) {
      console.error('ai memory clear failed', error)
      enqueueSnackbar('The preferences were not cleared. Try again.', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [confirm, enqueueSnackbar, firestore, hostId, preferences])

  return (
    <CardDisplay
      header={`What ${AI_NAME} learned`}
      subheader="Short preferences from the edits you applied with Assist. Every AI job for this site reads them."
      help={pluginDocsHelp('aiBusinessProfile', {
        anchor: '#what-aglyn-ai-learned',
        excerpt: `Preferences ${AI_NAME} took from the edits you applied. Forget one, or all, at any time.`,
      })}
      actions={
        preferences.length ? (
          <Button color="error" disabled={busy} onClick={() => void forgetAll()}>
            {'Forget all'}
          </Button>
        ) : undefined
      }
      contentGutterX
      contentGutterY
    >
      {preferences.length ? (
        <Stack divider={<Divider flexItem />} data-testid="ai-site-memory">
          {preferences.map((preference) => (
            <Stack key={preference.id} direction="row" spacing={2} sx={{ alignItems: 'center', py: 1 }}>
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{preference.text}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {preference.count === 1 ? 'Seen in 1 applied edit' : `Seen in ${preference.count} applied edits`}
                </Typography>
              </Stack>
              <Tooltip title="Forget this">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Forget “${preference.text}”`}
                    disabled={busy}
                    onClick={() => void forget(preference)}
                  >
                    <ForgetIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      ) : (
        <EmptyStateComponent
          compact
          label={status === 'loading' ? 'Loading…' : 'Nothing learned yet'}
          description={
            status === 'loading'
              ? undefined
              : 'When you apply an Assist edit that shows a preference, such as shorter copy or no emoji, it appears here.'
          }
        />
      )}
    </CardDisplay>
  )
}
AiSiteMemoryCard.displayName = 'AiSiteMemoryCard'

export default AiSiteMemoryCard
