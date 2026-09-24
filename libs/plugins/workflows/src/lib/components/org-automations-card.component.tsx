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
  type AglynOrgBilling,
  checkEntitlement,
  HOST_ACTION_STEP_LABELS,
  type HostActionStepType,
  hostEventLabel,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import {
  hostIdsFromScope,
  isOrgWideScope,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  ORG_AUTOMATIONS_COLLECTION,
  ORG_AUTOMATIONS_MAX,
  orgAutomationPausedHostIds,
  type OrgAutomationRow,
  readOrgAutomation,
} from '../model/org-automations'
import {
  newOrgAutomationDraft,
  OrgAutomationEditor,
  orgAutomationBody,
  type OrgAutomationDraft,
  orgAutomationDraft,
} from './org-automation-editor.component'
import { useOrgAutomationsApi } from './use-org-automations-api'
import { orgSiteName, type WorkflowsOrgMount } from './workflows-org-mount'

export interface OrgAutomationsCardProps {
  mount: WorkflowsOrgMount
  org?: Partial<AglynOrgBilling>
  /**
   * Whether the reader may write the organization's automations — an owner,
   * admin or editor. The route decides; this keeps a viewer from being
   * offered controls that are about to refuse them.
   */
  canEdit: boolean
}

/** The sites an automation runs on, by id: every org site for `['org']`. */
function placedSiteIds(
  row: Pick<OrgAutomationRow, 'visibleTo'>,
  mount: WorkflowsOrgMount,
): string[] {
  return isOrgWideScope(row.visibleTo)
    ? mount.hosts.map((host) => host.id)
    : hostIdsFromScope(row.visibleTo)
}

/** "Runs on every site" or "Runs on Shop, Blog". */
function placementLine(
  row: Pick<OrgAutomationRow, 'visibleTo'>,
  mount: WorkflowsOrgMount,
): string {
  if (isOrgWideScope(row.visibleTo)) return 'Runs on every site'
  const names = hostIdsFromScope(row.visibleTo).map((id) => orgSiteName(mount, id))
  return names.length ? `Runs on ${names.join(', ')}` : 'Runs on no site'
}

/**
 * THE ORGANIZATION'S AUTOMATIONS (AGL-3302): what the organization runs on
 * the sites it chooses.
 *
 * One ceilinged read of the live automations — the org hub admits only
 * org-wide members, who read every one — and every write through
 * `automations/manage` or `automations/pause`, because the collection is
 * closed to client writes. Each row says where it runs and where it is
 * paused; a paused site is resumed from its chip, and any placed site can be
 * paused from the row, which is the same control the site's own hub offers.
 */
export function OrgAutomationsCard(props: OrgAutomationsCardProps) {
  const { mount, org, canEdit } = props
  const firestore = useFirestore()
  const api = useOrgAutomationsApi()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  /*
   * Every LIVE automation, ceilinged at the organization's cap plus the probe
   * row. `deletedAt` is always written — `null` while live — so equality asks
   * for exactly the live ones and deleted documents never take a place in the
   * window. Ordered by document id, which the automatic single-field index
   * carries behind the equality, so the window is named rather than whatever
   * order Firestore returns; the list is sorted by name once it is in hand.
   */
  const { data: rows } = useFirestoreCollection<OrgAutomationRow>(
    () =>
      query(
        collection(firestore, 'orgs', mount.orgId, ORG_AUTOMATIONS_COLLECTION),
        where('deletedAt', '==', null),
        orderBy(documentId()),
        limit(ORG_AUTOMATIONS_MAX + 1),
      ),
    [firestore, mount.orgId],
    { idField: '$id' },
  )
  const automations = useMemo(
    () =>
      [...(rows ?? [])]
        .slice(0, ORG_AUTOMATIONS_MAX)
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))),
    [rows],
  )
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const shown = useMemo(
    () => automations.slice(page * pageSize, page * pageSize + pageSize),
    [automations, page, pageSize],
  )

  const [draft, setDraft] = useState<OrgAutomationDraft | null>(null)
  /**
   * The editor has been opened at least once — the latch the pickers key on,
   * so Cancel and the next Edit do not buy the option lists twice.
   */
  const [editorOpened, setEditorOpened] = useState(false)
  if (draft && !editorOpened) setEditorOpened(true)
  const [saving, setSaving] = useState(false)
  const [pauseMenu, setPauseMenu] = useState<{
    anchor: HTMLElement
    row: OrgAutomationRow
  } | null>(null)

  const entitled = checkEntitlement(org, 'actions')
  const fail = useCallback(
    (error: unknown) =>
      enqueueSnackbar((error as Error)?.message || 'The request could not be completed', {
        variant: 'warning',
        persist: false,
      }),
    [enqueueSnackbar],
  )

  const handleAdd = useCallback(() => {
    if (!entitled) {
      enqueueSnackbar(
        'Org automations are built from the actions builder, which requires a Pro plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
      return
    }
    setDraft(newOrgAutomationDraft())
  }, [entitled, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!draft) return
    const body = orgAutomationBody(draft)
    // The route's own reader, asked first so a mistake reads the same here as
    // it would coming back from the server — and costs no round trip.
    const read = readOrgAutomation(body)
    if (read.ok === false) {
      return void enqueueSnackbar(read.problem, { variant: 'warning', persist: false })
    }
    setSaving(true)
    try {
      await api('manage', {
        orgId: mount.orgId,
        action: draft.id ? 'update' : 'create',
        ...(draft.id ? { automationId: draft.id } : {}),
        automation: body,
      })
      setDraft(null)
      enqueueSnackbar('Org automation saved', { variant: 'success', persist: false })
    } catch (error) {
      fail(error)
    } finally {
      setSaving(false)
    }
  }, [draft, api, mount.orgId, enqueueSnackbar, fail])

  const handleToggle = useCallback(
    (row: OrgAutomationRow) => async (event: { target: { checked: boolean } }) => {
      try {
        await api('manage', {
          orgId: mount.orgId,
          action: 'setEnabled',
          automationId: row.$id,
          enabled: event.target.checked,
        })
      } catch (error) {
        fail(error)
      }
    },
    [api, mount.orgId, fail],
  )

  const handleDelete = useCallback(
    (row: OrgAutomationRow) => async () => {
      const confirmed = await confirm({
        title: 'Delete this org automation?',
        description:
          `"${row.name}" stops running on every site it is placed on, and ` +
          'anyone waiting inside it stops too.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      try {
        await api('manage', {
          orgId: mount.orgId,
          action: 'delete',
          automationId: row.$id,
        })
      } catch (error) {
        fail(error)
      }
    },
    [confirm, api, mount.orgId, fail],
  )

  const setPaused = useCallback(
    async (row: OrgAutomationRow, hostId: string, paused: boolean) => {
      setPauseMenu(null)
      try {
        await api('pause', { hostId, automationId: row.$id, paused })
      } catch (error) {
        fail(error)
      }
    },
    [api, fail],
  )

  return (
    <CardDisplay
      header={'Org automations'}
      help={pluginDocsHelp('orgAutomations', { anchor: '#what-an-org-automation-is' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'Write an automation once and run it on every site you choose. ' +
            'Each run is that site’s own: its email goes from that site, it ' +
            'counts on that site’s action runs, and the site can pause it ' +
            'for itself. Pro plans and up.'}
        </Typography>
        {shown.map((row) => {
          const paused = orgAutomationPausedHostIds(row)
          const placed = placedSiteIds(row, mount)
          const pausable = placed.filter((hostId) => !paused.includes(hostId))
          return (
            <Stack
              key={row.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Switch
                size="small"
                checked={row.enabled !== false}
                disabled={!canEdit}
                onChange={handleToggle(row)}
                slotProps={{ input: { 'aria-label': `Switch ${row.name} on or off` } }}
              />
              <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.25}>
                <Typography variant="body2" noWrap>
                  {row.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {`on ${hostEventLabel(row.trigger?.event)} · ${(row.steps ?? [])
                    .map(
                      (step) =>
                        HOST_ACTION_STEP_LABELS[step.type as HostActionStepType] ??
                        step.type,
                    )
                    .join(' → ')}`}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {placementLine(row, mount)}
                </Typography>
                {paused.length ? (
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    {paused.map((hostId) => (
                      <Chip
                        key={hostId}
                        size="small"
                        variant="outlined"
                        color="warning"
                        label={`Paused on ${orgSiteName(mount, hostId)}`}
                        {...(canEdit
                          ? { onDelete: () => void setPaused(row, hostId, false) }
                          : {})}
                      />
                    ))}
                  </Stack>
                ) : null}
              </Stack>
              {canEdit ? (
                <>
                  <Button size="small" onClick={() => setDraft(orgAutomationDraft(row))}>
                    {'Edit'}
                  </Button>
                  <Button
                    size="small"
                    disabled={!pausable.length}
                    aria-haspopup="menu"
                    onClick={(event) =>
                      setPauseMenu({ anchor: event.currentTarget, row })
                    }
                  >
                    {'Pause on…'}
                  </Button>
                  <Button size="small" color="error" onClick={handleDelete(row)}>
                    {'Delete'}
                  </Button>
                </>
              ) : null}
            </Stack>
          )
        })}
        {automations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No org automations yet.'}
          </Typography>
        ) : (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={shown.length}
            count={automations.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
        {(rows?.length ?? 0) > ORG_AUTOMATIONS_MAX ? (
          <Alert severity="info">
            {`Showing ${ORG_AUTOMATIONS_MAX} org automations, the most an ` +
              'organization holds.'}
          </Alert>
        ) : null}
        {canEdit ? (
          <Button
            size="small"
            color="primary"
            sx={{ alignSelf: 'flex-start' }}
            onClick={handleAdd}
          >
            {'Add org automation'}
          </Button>
        ) : null}
      </Stack>
      <Menu
        anchorEl={pauseMenu?.anchor ?? null}
        open={Boolean(pauseMenu)}
        onClose={() => setPauseMenu(null)}
      >
        {pauseMenu
          ? placedSiteIds(pauseMenu.row, mount)
              .filter(
                (hostId) =>
                  !orgAutomationPausedHostIds(pauseMenu.row).includes(hostId),
              )
              .map((hostId) => (
                <MenuItem
                  key={hostId}
                  onClick={() => void setPaused(pauseMenu.row, hostId, true)}
                >
                  {`Pause on ${orgSiteName(mount, hostId)}`}
                </MenuItem>
              ))
          : null}
      </Menu>
      <OrgAutomationEditor
        mount={mount}
        draft={draft}
        onDraft={(update) =>
          setDraft((previous) => (previous ? update(previous) : previous))
        }
        opened={editorOpened}
        saving={saving}
        onSave={() => void handleSave()}
        onClose={() => setDraft(null)}
      />
    </CardDisplay>
  )
}
OrgAutomationsCard.displayName = 'OrgAutomationsCard'

export default OrgAutomationsCard
