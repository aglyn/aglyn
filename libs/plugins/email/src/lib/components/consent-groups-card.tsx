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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { mdiLinkVariantOff, mdiPencilOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ConsentGroupAccess, useConsentGroupAccess } from './consent-group-access'
import ConsentGroupChangeProgress from './consent-group-change-progress'
import ConsentGroupDialog, { type ConsentGroupDialogMode } from './consent-group-dialog'
import {
  draftDisclosure,
  listConsentGroups,
  unusableConsentGroupCount,
} from './consent-group-editing'
import {
  CONSENT_GROUP_MIN_HOSTS,
  readConsentGroupChangeMarker,
} from './consent-groups-api'
import { orgSiteName, useEmailOrgMount } from './email-org-mount'

export interface ConsentGroupsCardProps {
  /** The org document the shell passes, kept live by its listener. */
  org?: Record<string, unknown> | null
  /**
   * Whether the reader may change consent groups, when the section already
   * asked. Absent, the card reads the reader's membership itself.
   */
  access?: ConsentGroupAccess
}

/** Why the editor's controls are off, in the order a reader would fix them. */
function blockedReason(input: {
  access: ConsentGroupAccess
  siteCount: number
  sitesReady: boolean
  changing: boolean
}): string | null {
  const { access, siteCount, sitesReady, changing } = input
  if (!access.ready) return null
  if (access.missing) {
    return `You need the ${access.missing} permission to change consent groups.`
  }
  if (changing) return 'Finishing the last change.'
  if (sitesReady && siteCount < CONSENT_GROUP_MIN_HOSTS) {
    return 'A consent group needs at least two sites.'
  }
  return null
}

/**
 * Consent groups — the sites this organization declares ONE SENDER
 * (AGL-3320).
 *
 * ## What a group is, in the terms the admin is held to
 *
 * Undeclared, every site is its own sender: a signup on one site reaches only
 * that site, and an unsubscribe applies to that site alone. A group names the
 * sites that are one sender. Its signup forms say so by name, a signup made
 * on one of those forms may be mailed by every site in it, and an opt-out on
 * any of them stops marketing email from all of them. This card lists the
 * groups and is the only way to change them.
 *
 * ## Lists here, edits in a dialog
 *
 * The console's standing shape for a list surface: **New group** sits in the
 * header and opens a dialog, and each row's menu edits or dissolves that
 * group in the same dialog. No form sits above the table.
 *
 * ## One change at a time, shown until it is done
 *
 * A change runs as a job — refusals copied, the declaration flipped, CRM
 * records moved — and the org document carries its marker until it
 * finishes. While it does, the banner above the table shows where it is and
 * the controls say "Finishing the last change", because the route refuses a
 * second change until the first is swept.
 *
 * Reads nothing of its own beyond the reader's membership: the groups and
 * the marker are fields of the org document the shell already holds, and the
 * job document is read only by the banner, only while a change runs, and
 * only for a reader who may drive it.
 */
export function ConsentGroupsCard(props: ConsentGroupsCardProps) {
  const { org, access } = props
  const mount = useEmailOrgMount()
  const orgId = mount?.orgId ?? ''
  const { enqueueSnackbar } = useSnackbar()
  // Handed the answer, the card opens no read of its own for it.
  const own = useConsentGroupAccess(access ? undefined : orgId || undefined)
  const allowed = access ?? own

  const groups = useMemo(() => listConsentGroups(org), [org])
  const unusable = unusableConsentGroupCount(org)
  const marker = readConsentGroupChangeMarker(org)
  const sites = mount?.hosts ?? []
  const sitesReady = mount?.hostsReady ?? false

  /*
   * The change this page just started, held until the org document's marker
   * catches up — the listener lands a moment after the route answers, and
   * the banner should not blink out in between.
   */
  const [started, setStarted] = useState<string | null>(null)
  useEffect(() => {
    if (started && marker?.changeId === started) setStarted(null)
  }, [started, marker?.changeId])
  const changeId = marker?.changeId ?? started

  /*
   * Announced once per change, whichever way its end is noticed: the banner's
   * own answer, the job document, or the marker leaving the org document.
   */
  const announced = useRef(new Set<string>())
  const announce = useCallback(
    (id: string, outcome: 'done' | 'canceled') => {
      if (announced.current.has(id)) return
      announced.current.add(id)
      if (outcome === 'done') {
        enqueueSnackbar('Consent groups updated', { variant: 'success', persist: false })
      }
    },
    [enqueueSnackbar],
  )
  const seenMarker = useRef<string | null>(null)
  useEffect(() => {
    const previous = seenMarker.current
    seenMarker.current = marker?.changeId ?? null
    if (previous && !marker) announce(previous, 'done')
  }, [marker, announce])

  const [dialog, setDialog] = useState<{
    mode: ConsentGroupDialogMode
    groupId: string | null
  } | null>(null)

  const blocked = blockedReason({
    access: allowed,
    siteCount: sites.length,
    sitesReady,
    changing: Boolean(changeId),
  })
  const canEdit = allowed.ready && !blocked && Boolean(orgId)
  const rowBlocked = allowed.ready ? (blocked ?? null) : 'Checking your permissions'
  const changingHosts = new Set(marker?.hostIds ?? [])

  const rowActions = (groupId: string): RowActionsMenuItem[] => [
    {
      key: 'edit',
      label: 'Edit group',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : (rowBlocked ?? undefined),
      onClick: () => setDialog({ mode: 'edit', groupId }),
    },
    {
      key: 'dissolve',
      label: 'Dissolve group',
      icon: <MdiIcon path={mdiLinkVariantOff.path} size={0.8} />,
      destructive: true,
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : (rowBlocked ?? undefined),
      onClick: () => setDialog({ mode: 'dissolve', groupId }),
    },
  ]

  return (
    <CardDisplay
      header="Consent groups"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#consent-groups' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            variant="contained"
            disabled={!canEdit}
            onClick={() => setDialog({ mode: 'create', groupId: null })}
          >
            {'New group'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Sites in a consent group send as one. Their signup forms name the ' +
            'group, someone who signs up on one of those forms can hear from ' +
            'every site in it, and an unsubscribe or opt-out on any of them ' +
            'stops marketing email from all of them. A site in no group sends ' +
            'on its own.'}
        </Typography>
        {blocked ? (
          <Typography variant="body2" color="text.secondary">
            {blocked}
          </Typography>
        ) : null}
        {changeId && orgId ? (
          <ConsentGroupChangeProgress
            key={changeId}
            orgId={orgId}
            changeId={changeId}
            marker={marker}
            canDrive={allowed.ready && !allowed.missing}
            onFinished={(outcome) => {
              announce(changeId, outcome)
              setStarted(null)
            }}
          />
        ) : null}
        {groups.length ? (
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Group'}</TableCell>
                <TableCell>{'Sites'}</TableCell>
                <TableCell>{'Signup forms say'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {group.name}
                      </Typography>
                      {/*
                        The id an integration sends as `consentGroupId` to opt
                        someone in for the whole group; nothing else shows it.
                       */}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                      >
                        {group.id}
                      </Typography>
                      {group.hostIds.some((hostId) => changingHosts.has(hostId)) ? (
                        <Chip size="small" color="info" variant="outlined" label="Changing" />
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {group.hostIds.map((hostId) => (
                        <Chip
                          key={hostId}
                          size="small"
                          variant="outlined"
                          label={orgSiteName(mount, hostId)}
                        />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Typography variant="body2" color="text.secondary">
                      {draftDisclosure(group.name, group.hostIds, group.id) ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ width: 56, verticalAlign: 'top' }}>
                    <RowActionsMenu label={group.name} items={rowActions(group.id)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No consent groups yet. Every site is its own sender: someone who ' +
              'signs up on one site hears only from that site, and an ' +
              'unsubscribe applies to that site alone.'}
          </Typography>
        )}
        {unusable > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {`${unusable === 1 ? 'One saved consent group' : `${unusable} saved consent groups`} ` +
              'can’t be used — no name, too few or too many sites, or a site ' +
              `another group also claims — so nothing honors ${unusable === 1 ? 'it' : 'them'}. ` +
              `The next change you make removes ${unusable === 1 ? 'it' : 'them'}.`}
          </Typography>
        ) : null}
      </Stack>
      {dialog && orgId ? (
        <ConsentGroupDialog
          open
          mode={dialog.mode}
          groupId={dialog.groupId}
          org={org}
          orgId={orgId}
          sites={sites}
          onClose={() => setDialog(null)}
          onApplied={({ changeId: applied, done }) => {
            setDialog(null)
            if (done) {
              announce(applied, 'done')
              return
            }
            setStarted(applied)
          }}
        />
      ) : null}
    </CardDisplay>
  )
}
ConsentGroupsCard.displayName = 'ConsentGroupsCard'

export default ConsentGroupsCard
