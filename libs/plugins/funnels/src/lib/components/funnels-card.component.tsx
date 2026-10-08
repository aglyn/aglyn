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

import { checkEntitlement, planLabelGrantingFeature } from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { mdiPencilOutline, mdiPlus, mdiRefresh } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useOrgPlan,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { announceSiteWideChange } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import {
  Alert,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { pluginRecordHref } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { normalizeFunnelDefinition } from '../model/funnel-definition'
import type { FunnelInventory } from '../model/funnel-inventory'
import {
  FUNNEL_FEATURE,
  FUNNELS_COLLECTION,
  FUNNELS_MAX_PER_SITE,
  isFunnelDraft,
  type FunnelDefinition,
  type FunnelResult,
  type StoredFunnel,
} from '../model/funnels.types'
import { funnelStepTitle } from '../model/funnel-definition'
import { FunnelDropOffDialog } from './funnel-drop-off.dialog'
import { FunnelEditorDialog } from './funnel-editor.dialog'
import { FunnelResults } from './funnel-results.component'
import { FUNNEL_INSIGHT_ZONE, FUNNELS_CREATE_ZONE } from './funnel-zones'
import {
  activateFunnel,
  deleteFunnel,
  draftDropOffAutomation,
  fetchFunnelInventory,
  fetchFunnelResult,
  proposeFunnel,
  recentRange,
  saveFunnel,
} from './funnels-client'

/**
 * Analytics → Funnels (AGL-3605), drawn in the Analytics page's
 * `hostAnalytics` zone: the site's funnels, one at a time with its result
 * over a range, the editor, and two zones another plugin fills — "Create with
 * AI" beside the create button, and "Ask AI about this funnel" on a result.
 *
 * Paid analytics: a workspace without the tier sees the card with one line
 * saying which plan includes it, and nothing it would have to buy to read.
 *
 * A DRAFT funnel (AGL-3616) — one an AI build made — is listed and editable,
 * shows its steps for review instead of a result, and is put live by
 * Activate, which is when it is measured and the site starts recording.
 */

export const FUNNEL_RANGES = [7, 14, 30, 90] as const

const HELP = pluginDocsHelp('funnels')

export interface FunnelsCardProps {
  hostId: string
  orgId?: string
}

interface EditorState {
  funnelId: string | null
  initial: FunnelDefinition | null
  dropped?: string[]
}

export function FunnelsCard({ hostId, orgId }: FunnelsCardProps) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { org, ready } = useOrgPlan(hostId)
  const { confirm } = useConfirmationContext()
  const Zone = useConsoleWidgetSlot()
  const entitled = ready && checkEntitlement(org as never, FUNNEL_FEATURE)

  const { data: host } = useFirestoreDoc<{ memberRoles?: Record<string, string> }>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
  )
  const role = user?.uid ? host?.memberRoles?.[user.uid] : undefined
  const canManage = role === 'admin' || role === 'editor'

  const { data: rows, status } = useFirestoreCollection<StoredFunnel>(
    () =>
      entitled && hostId
        ? query(collection(firestore, 'hosts', hostId, FUNNELS_COLLECTION), limit(FUNNELS_MAX_PER_SITE))
        : null,
    [firestore, hostId, entitled],
    { idField: '$id' },
  )
  const funnels = useMemo(
    () =>
      [...(rows ?? [])]
        .filter((row) => 'funnel' in normalizeFunnelDefinition(row))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [rows],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = funnels.find((one) => one.$id === selectedId) ?? funnels[0] ?? null
  const [days, setDays] = useState<number>(30)
  const [result, setResult] = useState<FunnelResult | null>(null)
  const [resultError, setResultError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [inventory, setInventory] = useState<FunnelInventory | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dropOffStep, setDropOffStep] = useState<number | null>(null)
  const params = useParams<{ orgSlug?: string; host?: string }>()
  // Where a drafted automation is edited, from whichever plugin publishes the
  // `action` record kind: text instead of a link where none does.
  const automationHref = (automationId: string) =>
    params?.orgSlug && params?.host
      ? pluginRecordHref('action', { orgSlug: params.orgSlug, host: params.host }, automationId)
      : null

  const selectedDraft = isFunnelDraft(selected)
  const [activating, setActivating] = useState(false)
  // A draft is not measured: there is no result to ask for until it is active.
  const selectedKey = selected && !selectedDraft ? `${selected.$id}` : null
  useEffect(() => {
    if (!entitled || !selectedKey || !user) return
    let active = true
    const { from, to } = recentRange(days)
    setLoading(true)
    setResultError(null)
    fetchFunnelResult(user, hostId, selectedKey, from, to, refreshKey > 0)
      .then((next) => active && setResult(next))
      .catch((error: Error) => active && (setResult(null), setResultError(error.message)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // `selected.updatedAt` moves the key server-side; the id and range are
    // what the card asks for.
  }, [entitled, selectedKey, days, user, hostId, refreshKey, selected?.updatedAt])

  const loadInventory = useCallback(async () => {
    if (inventory || !user) return inventory
    const next = await fetchFunnelInventory(user, hostId)
    setInventory(next)
    return next
  }, [inventory, user, hostId])

  // The editor opens once the site's inventory is in hand, so a new funnel's
  // first step starts on one of the site's real pages rather than a guess.
  const openEditor = useCallback(
    async (state: EditorState) => {
      setSaveError(null)
      try {
        await loadInventory()
      } catch (error) {
        setResultError((error as Error).message)
        return
      }
      setEditor(state)
    },
    [loadInventory],
  )

  const propose = useCallback(
    async (brief: string): Promise<string | null> => {
      try {
        const proposal = await proposeFunnel(user, hostId, brief)
        await openEditor({ funnelId: null, initial: proposal.draft, dropped: proposal.dropped })
        return null
      } catch (error) {
        return (error as Error).message
      }
    },
    [user, hostId, openEditor],
  )

  const afterRecordingChange = (changed: boolean) => {
    // The published page reads the recording switch from the host document
    // it was rendered with, so the site's cached pages are dropped.
    if (changed) void announceSiteWideChange({ user, hostId })
  }

  const save = async (funnel: FunnelDefinition) => {
    if (!editor) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await saveFunnel(user, hostId, funnel, editor.funnelId)
      afterRecordingChange(saved.recordingChanged)
      setSelectedId(saved.funnelId)
      setResult(null)
      setEditor(null)
    } catch (error) {
      setSaveError((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const activate = async () => {
    if (!selected) return
    setActivating(true)
    setResultError(null)
    try {
      const activated = await activateFunnel(user, hostId, selected.$id)
      afterRecordingChange(activated.recordingChanged)
      setResult(null)
    } catch (error) {
      setResultError((error as Error).message)
    } finally {
      setActivating(false)
    }
  }

  const remove = async () => {
    if (!selected) return
    const confirmed = await confirm({
      title: 'Delete this funnel?',
      description: `${selected.name} and its results are removed. Recorded visits are kept until they expire.`,
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    try {
      const deleted = await deleteFunnel(user, hostId, selected.$id)
      afterRecordingChange(deleted.recordingChanged)
      setSelectedId(null)
      setResult(null)
    } catch (error) {
      setResultError((error as Error).message)
    }
  }

  if (!ready) {
    return (
      <CardDisplay header="Funnels" help={HELP} contentGutterX contentGutterY>
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      </CardDisplay>
    )
  }

  if (!entitled) {
    return (
      <CardDisplay header="Funnels" help={HELP} contentGutterX contentGutterY>
        <Typography variant="body2" color="text.secondary">
          {`Funnels come with per-page analytics, included from ${
            planLabelGrantingFeature(FUNNEL_FEATURE) ?? 'a paid plan'
          }.`}
        </Typography>
      </CardDisplay>
    )
  }

  const createZone =
    Zone && canManage ? (
      <Zone slot={FUNNELS_CREATE_ZONE.id} hostId={hostId} orgId={orgId} propose={propose} />
    ) : null
  const newButton = canManage ? (
    <Button
      size="small"
      variant="outlined"
      startIcon={<MdiIcon path={mdiPlus.path} />}
      disabled={funnels.length >= FUNNELS_MAX_PER_SITE}
      onClick={() => void openEditor({ funnelId: null, initial: null })}
    >
      {'New funnel'}
    </Button>
  ) : null

  return (
    <CardDisplay
      header="Funnels"
      help={HELP}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: funnels.length ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {createZone}
            {newButton}
          </Stack>
        ) : undefined,
      }}
    >
      {status === 'loading' ? (
        <LinearProgress />
      ) : !funnels.length ? (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            {'A funnel is the steps you expect a visitor to take — a page, then a form, then a booking — ' +
              'and shows how many visits reached each step and where they dropped off. ' +
              'Recording starts when you save the first one.'}
          </Typography>
          {resultError ? <Alert severity="error">{resultError}</Alert> : null}
          {canManage ? (
            <Stack direction="row" spacing={1}>
              {createZone}
              {newButton}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'A site admin or editor can create one.'}
            </Typography>
          )}
        </Stack>
      ) : (
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              select
              size="small"
              label="Funnel"
              value={selected?.$id ?? ''}
              sx={{ minWidth: 220 }}
              onChange={(event) => {
                setResult(null)
                setRefreshKey(0)
                setSelectedId(event.target.value)
              }}
            >
              {funnels.map((one) => (
                <MenuItem key={one.$id} value={one.$id}>
                  {isFunnelDraft(one) ? `${one.name} (draft)` : one.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Range"
              value={days}
              onChange={(event) => {
                setResult(null)
                setDays(Number(event.target.value))
              }}
            >
              {FUNNEL_RANGES.map((range) => (
                <MenuItem key={range} value={range}>{`Last ${range} days`}</MenuItem>
              ))}
            </TextField>
            {selectedDraft ? (
              <Chip label="Draft" size="small" />
            ) : (
              <IconButton aria-label="Refresh" onClick={() => setRefreshKey((key) => key + 1)}>
                <MdiIcon path={mdiRefresh.path} />
              </IconButton>
            )}
            {canManage && selected ? (
              <>
                <IconButton
                  aria-label="Edit funnel"
                  onClick={() =>
                    void openEditor({
                      funnelId: selected.$id,
                      initial: { name: selected.name, steps: selected.steps },
                    })
                  }
                >
                  <MdiIcon path={mdiPencilOutline.path} />
                </IconButton>
                <Button size="small" color="error" onClick={() => void remove()}>
                  {'Delete'}
                </Button>
              </>
            ) : null}
          </Stack>
          {selected && selectedDraft ? (
            <Alert
              severity="info"
              action={
                canManage ? (
                  <Button color="inherit" size="small" disabled={activating} onClick={() => void activate()}>
                    {'Activate'}
                  </Button>
                ) : undefined
              }
            >
              <Typography variant="body2" sx={{ mb: 1 }}>
                {'A draft, set up for you to review. It is not measured, and the site does not record visits ' +
                  'for it, until ' +
                  (canManage ? 'you activate it.' : 'a site admin or editor activates it.')}
              </Typography>
              <ol aria-label="Draft steps" style={{ margin: 0, paddingInlineStart: 20 }}>
                {selected.steps.map((step, index) => (
                  <li key={index}>
                    <Typography variant="body2">{funnelStepTitle(step)}</Typography>
                  </li>
                ))}
              </ol>
            </Alert>
          ) : null}
          {loading && !result ? <LinearProgress /> : null}
          {resultError ? <Alert severity="error">{resultError}</Alert> : null}
          {result && !selectedDraft ? (
            <FunnelResults
              result={result}
              onActOnDropOff={canManage ? (reached) => setDropOffStep(reached) : undefined}
            />
          ) : null}
          {result && !selectedDraft && Zone && selected ? (
            <Zone
              slot={FUNNEL_INSIGHT_ZONE.id}
              hostId={hostId}
              orgId={orgId}
              funnelName={selected.name}
              days={days}
            />
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {'A visit is one browser tab, recorded only when the visitor’s consent allows analytics.'}
          </Typography>
        </Stack>
      )}
      {selected && dropOffStep !== null ? (
        <FunnelDropOffDialog
          open
          step={dropOffStep}
          stepLabel={selected.steps[dropOffStep - 1] ? funnelStepTitle(selected.steps[dropOffStep - 1]) : ''}
          nextStepLabel={selected.steps[dropOffStep] ? funnelStepTitle(selected.steps[dropOffStep]) : ''}
          onClose={() => setDropOffStep(null)}
          onDraft={async (afterHours, action) => {
            const drafted = await draftDropOffAutomation(user, hostId, selected.$id, dropOffStep, afterHours, action)
            return { name: drafted.name, href: automationHref(drafted.automationId) }
          }}
        />
      ) : null}
      <FunnelEditorDialog
        open={editor !== null}
        initial={editor?.initial ?? null}
        dropped={editor?.dropped}
        inventory={inventory}
        saving={saving}
        error={saveError}
        onClose={() => setEditor(null)}
        onSave={(funnel) => void save(funnel)}
      />
    </CardDisplay>
  )
}

export default FunnelsCard
