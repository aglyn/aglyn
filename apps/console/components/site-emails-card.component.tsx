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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  TENANT_EMAIL_COLLECTION,
  TENANT_EMAILS,
  type TenantEmailEntry,
} from '@aglyn/shared-util-email'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { collection, doc, updateDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import { useCurrentOrg } from '../hooks/use-current-org'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useHostId, useHostSubdomain } from './host-id-provider'
import { openHostEmailVersion } from '../utils/open-host-email-version'

/** Groups the flat catalog by owning plugin, preserving catalog order. */
function groupByPlugin(): Array<{
  pluginId: string
  plugin: string
  emails: TenantEmailEntry[]
}> {
  const order: string[] = []
  const byId = new Map<
    string,
    { pluginId: string; plugin: string; emails: TenantEmailEntry[] }
  >()
  for (const entry of TENANT_EMAILS) {
    let group = byId.get(entry.pluginId)
    if (!group) {
      group = { pluginId: entry.pluginId, plugin: entry.plugin, emails: [] }
      byId.set(entry.pluginId, group)
      order.push(entry.pluginId)
    }
    group.emails.push(entry)
  }
  return order.map((id) => byId.get(id) as ReturnType<typeof groupByPlugin>[0])
}

/**
 * The transactional emails a site sends its own customers (AGL-769), each with
 * the way it is controlled (AGL-770): designable ones open the email besigner,
 * ones authored elsewhere say where, and fixed ones say they are not
 * customizable yet. Groups whose plugin is not enabled on this site are shown
 * dimmed with a chip rather than hidden, so the owner sees the whole surface.
 */
export function SiteEmailsCard() {
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  // EXEMPT from `no-unguarded-loading-hook` (AGL-1422). The only thing read
  // off `org` here is `enabledPlugins`, and that check fails OPEN — an org
  // with no explicit list shows every plugin (see below), which is exactly
  // what an undefined `org` produces. So the loading window shows the card
  // and the loaded state may only ever REMOVE it; there is no window in
  // which this tells anyone a feature is off. Catalogued and left alone once
  // already in 854dc2c66, which called it out by name as "looked like a hit
  // and is not". A `ready` gate here would only make the card flash.
  // eslint-disable-next-line aglyn/no-unguarded-loading-hook
  const { org } = useCurrentOrg()
  const [opening, setOpening] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)

  // Which emails have a published design, so the row can offer Edit + Reset
  // instead of Design. Held at null before hostId lands, never addressed as
  // `hosts/-pending-` (AGL-1440): the HostGuard upstream makes that window
  // unreachable today, but a guaranteed-denied ref behind somebody else's
  // guard is one refactor away from a permanent denial loop.
  const { data: templateDocs } = useFirestoreCollection<{
    $id: string
    versionId?: string
  }>(
    () =>
      hostId
        ? collection(firestore, 'hosts', hostId, TENANT_EMAIL_COLLECTION)
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  const customizedByKey = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const entry of templateDocs ?? []) {
      map.set(entry.$id, Boolean(entry.versionId))
    }
    return map
  }, [templateDocs])

  // Fail-open: an org with no explicit plugin list (pre-billing) shows every
  // group as enabled, matching how entitlement helpers treat undefined.
  const enabled = useMemo(() => {
    const list = org?.enabledPlugins
    return Array.isArray(list) ? new Set(list) : null
  }, [org?.enabledPlugins])
  const isEnabled = (pluginId: string) => !enabled || enabled.has(pluginId)

  const groups = useMemo(groupByPlugin, [])

  const openDesigner = async (entry: TenantEmailEntry) => {
    if (!hostId) return
    setOpening(entry.key)
    try {
      const versionId = await openHostEmailVersion(firestore, hostId, entry)
      router.push(
        buildRoute(Route.HOST_EMAIL_BESIGNER, {
          orgSlug,
          host,
          templateKey: entry.key,
          versionId,
        }),
      )
    } catch (error) {
      enqueueSnackbar(
        `Could not open ${entry.name}: ${(error as Error)?.message}`,
        { variant: 'error', allowDuplicate: true },
      )
      setOpening(null)
    }
  }

  const resetToDefault = async (entry: TenantEmailEntry) => {
    if (!hostId) return
    setResetting(entry.key)
    try {
      // Clear the pointer rather than deleting the document, so the record
      // survives and a later Design starts fresh (parity with the staff
      // system-email reset).
      await updateDoc(
        doc(firestore, 'hosts', hostId, TENANT_EMAIL_COLLECTION, entry.key),
        { versionId: null },
      )
      enqueueSnackbar(`${entry.name} is back to the default`, {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      enqueueSnackbar(
        `Could not reset ${entry.name}: ${(error as Error)?.message}`,
        { variant: 'error', allowDuplicate: true },
      )
    } finally {
      setResetting(null)
    }
  }

  return (
    <CardDisplay
      header={'Emails this site sends'}
      help={docsHelp('designedEmails', {
        excerpt:
          'Design the transactional emails your site sends its customers ' +
          'with email-safe blocks and merge tokens.',
      })}
      subheader={
        'The transactional emails your site sends to your own customers. ' +
        'A group applies only when that feature is enabled on this site.'
      }
      contentGutterX
      contentGutterY
    >
      <Stack spacing={3}>
        {groups.map((group) => {
          const groupEnabled = isEnabled(group.pluginId)
          return (
            <Stack
              key={group.pluginId}
              spacing={1}
              sx={{ opacity: groupEnabled ? 1 : 0.55 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="subtitle2">{group.plugin}</Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${group.emails.length} email${
                    group.emails.length === 1 ? '' : 's'
                  }`}
                />
                {groupEnabled ? null : (
                  <Chip size="small" label="Not enabled on this site" />
                )}
              </Stack>
              {group.emails.map((email) => (
                <Stack
                  key={email.key}
                  direction="row"
                  spacing={2}
                  sx={{
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    borderBottom: 1,
                    borderColor: 'divider',
                    pb: 1,
                    '&:last-of-type': { borderBottom: 0, pb: 0 },
                  }}
                >
                  <Stack spacing={0.25} sx={{ flexGrow: 1 }}>
                    <Typography variant="body2">{email.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {email.description}
                    </Typography>
                  </Stack>
                  <Stack sx={{ flexShrink: 0, alignItems: 'flex-end' }}>
                    {email.control === 'besigner' ? (
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        {customizedByKey.get(email.key) ? (
                          <>
                            <Chip
                              size="small"
                              label="Customized"
                              color="primary"
                            />
                            <Button
                              size="small"
                              color="inherit"
                              disabled={
                                !groupEnabled || resetting === email.key
                              }
                              onClick={() => void resetToDefault(email)}
                            >
                              {'Reset to default'}
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              disabled={!groupEnabled || opening === email.key}
                              onClick={() => void openDesigner(email)}
                            >
                              {'Edit'}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="small"
                            variant="contained"
                            disabled={!groupEnabled || opening === email.key}
                            onClick={() => void openDesigner(email)}
                          >
                            {'Design'}
                          </Button>
                        )}
                      </Stack>
                    ) : email.control === 'external' ? (
                      <Typography variant="caption" color="text.secondary">
                        {`Edited in ${email.authoredIn}`}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {'Not customizable yet'}
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          )
        })}
        <Alert severity="info">
          {'These are sent by your site, on your behalf. The account emails ' +
            'Aglyn itself sends you — invites, receipts, security — are ' +
            'managed by Aglyn, not here.'}
        </Alert>
      </Stack>
    </CardDisplay>
  )
}
SiteEmailsCard.displayName = 'SiteEmailsCard'

export default SiteEmailsCard
