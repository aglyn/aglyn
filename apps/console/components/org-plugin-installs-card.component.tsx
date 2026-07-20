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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useOrgHosts } from '../hooks/use-org-hosts'
import useFirestoreCollection from '../hooks/use-firestore-collection'

export interface OrgPluginInstallsCardProps {
  orgId: string
}

/**
 * Org-tier plugin installs (AGL-263): the pins at `orgs/{orgId}/installs`
 * that apply to every site in the organization. Browsing/installing
 * happens on any site's Community tab (choose "whole organization" at
 * install time); this card is the org-level inventory with uninstall.
 */
export function OrgPluginInstallsCard(props: OrgPluginInstallsCardProps) {
  const { orgId } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  // The install API authorizes through a host the caller manages.
  const { hosts } = useOrgHosts(firestore, (user as any)?.uid, orgId)

  const { data: installDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'orgs', orgId, 'installs'), limit(50)),
    [firestore, orgId],
    { idField: '$id' },
  )
  const installs = [...(installDocs ?? [])].sort((a, b) =>
    String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
  )

  const handleUninstall = async (install: any) => {
    const hostId = hosts?.[0]?.$id
    if (!hostId) {
      return void enqueueSnackbar(
        'You need access to at least one site to manage installs',
        { variant: 'warning', persist: false },
      )
    }
    const accepted = await confirm({
      title: 'Uninstall from the whole organization?',
      description: `"${install.displayName ?? install.$id}" stops loading on every site.`,
      confirmationButtonProps: { color: 'error' },
    })
    if (!accepted) return
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/community/install-plugin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          listingId: install.$id,
          action: 'uninstall',
          scope: 'org',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Uninstall failed', {
          variant: 'warning',
          persist: false,
        })
      }
      enqueueSnackbar('Uninstalled from the organization', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    }
  }

  return (
    <CardDisplay
      header="Organization plugin installs"
      help={docsHelp('plugins', {
        anchor: '#install--upgrade',
        excerpt:
          'Marketplace plugins installed for the whole organization — ' +
          'they load on every site until uninstalled here.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Plugins installed for the whole organization load on every ' +
            'site. Browse and install from any site’s Community tab ' +
            'and choose "whole organization" at install time.'}
        </Typography>
        {/* Core platform bundles (AGL-379): every org gets them; locked. */}
        {[
          ['Material UI components', 'The core component and theme library.'],
          ['Commerce storefront', 'Product grids, PDPs, cart, checkout.'],
          ['Events Calendar', 'Published events list with schema.org markup.'],
          ['Email Designer', 'Email-safe blocks for campaign emails.'],
        ].map(([name, description]) => (
          <Stack
            key={name}
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: 1.5,
            }}
          >
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {description}
              </Typography>
            </Stack>
            <Chip size="small" color="secondary" label="Core" />
          </Stack>
        ))}
        {installs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No organization-wide installs yet.'}
            {hosts?.[0]?.$id ? (
              <>
                {' '}
                <a
                  href={buildRoute(Route.HOST_COMMUNITY, {
                    orgSlug,
                    host: hosts[0].subdomain,
                  })}
                >
                  {'Browse the marketplace'}
                </a>
              </>
            ) : null}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Plugin'}</TableCell>
                <TableCell>{'Version'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {installs.map((install) => (
                <TableRow key={install.$id}>
                  <TableCell>
                    {install.displayName ?? install.pluginId ?? install.$id}
                    <Chip
                      size="small"
                      label="org-wide"
                      sx={{ ml: 1 }}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>{install.version ?? '—'}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      onClick={() => void handleUninstall(install)}
                    >
                      {'Uninstall'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>
    </CardDisplay>
  )
}
OrgPluginInstallsCard.displayName = 'OrgPluginInstallsCard'

export default OrgPluginInstallsCard
