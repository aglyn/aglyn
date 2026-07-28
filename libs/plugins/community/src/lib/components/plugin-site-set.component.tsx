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

import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { mdiCheckCircle } from '@aglyn/shared-data-mdi'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  FormGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { OrgInstallSummary } from '../model/community'

export interface PluginSiteSetProps {
  /** The listing/installation these pins belong to. */
  listing: any
  /** Every site in the org, in display order. */
  hosts: ReadonlyArray<{ id: string; label: string }>
  /** The resolved picture — see `resolveOrgInstallSummary`. */
  orgInstall: OrgInstallSummary
  /** Version the pins should be at; a site behind this can be updated. */
  latestVersion?: string | number | null
  /** Install the given concrete steps (org pin and/or named host pins). */
  installPlan: (
    listing: any,
    steps: ReadonlyArray<{ scope: 'org' | 'host'; hostId?: string }>,
  ) => Promise<unknown>
  /** Drop a pin — org-wide, or from one named site. */
  uninstall: (
    listing: any,
    scope?: 'org' | 'host',
    hostId?: string,
  ) => Promise<unknown>
  /** Re-read the pins after a write; the caller owns that state. */
  onChanged: () => void
}

/**
 * The set of sites a plugin is installed on, and the controls to change it
 * (AGL-997), extracted from the listing page so the installation detail page
 * (AGL-1007) shows the same thing rather than a second implementation that
 * drifts.
 *
 * An org-scope install is a SET, not a boolean: an org pin covers every site
 * including ones created later, host pins name specific sites, and a host
 * pin on top of an org pin shadows it for that one site. All three facts
 * have to survive into the UI, which is why this takes the whole summary
 * rather than a scope.
 */
export function PluginSiteSet(props: PluginSiteSetProps) {
  const {
    listing,
    hosts,
    orgInstall,
    latestVersion,
    installPlan,
    uninstall,
    onChanged,
  } = props
  const [addHostIds, setAddHostIds] = useState<string[]>([])
  const [siteBusy, setSiteBusy] = useState(false)
  const staleSites = useMemo(
    () =>
      orgInstall.sites.filter(
        (site) =>
          site.version != null &&
          latestVersion != null &&
          String(latestVersion) !== site.version,
      ),
    [orgInstall.sites, latestVersion],
  )
  const runSiteEdit = async (work: () => Promise<unknown>) => {
    setSiteBusy(true)
    try {
      await work()
    } finally {
      setSiteBusy(false)
      setAddHostIds([])
      onChanged()
    }
  }

  if (!orgInstall.installedAnywhere) return null

  return (
  <Stack spacing={1.5}>
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'flex-start' }}
    >
      <MdiIcon
        path={mdiCheckCircle.path}
        color="success"
        sx={{ fontSize: 20, mt: '2px' }}
      />
      <Typography variant="body2">
        {orgInstall.orgWide
          ? `Installed for the whole organization ` +
            `(v${orgInstall.orgVersion}) — every site, ` +
            'including ones you add later.'
          : `Installed on ${orgInstall.sites.length} of ` +
            `${hosts.length} sites.`}
      </Typography>
    </Stack>

    {/* Name them. A count alone still leaves you
        guessing which sites are running the thing. */}
    <Stack spacing={0.5}>
      {orgInstall.sites.map((site) => (
        <Stack
          key={site.hostId}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center' }}
        >
          <Typography
            variant="body2"
            sx={{ flex: 1, minWidth: 0 }}
            noWrap
          >
            {site.label}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
          >
            {`v${site.version ?? '—'}`}
          </Typography>
          {site.shadowed ? (
            <Chip
              size="small"
              variant="outlined"
              label="Overrides org"
            />
          ) : null}
          {/* Removable only where the site owns its
              pin: dropping a site covered by the org
              pin would mean writing an exclusion the
              loader has no concept of. */}
          {site.pinnedBy === 'host' ? (
            <Button
              size="small"
              color="inherit"
              disabled={siteBusy}
              onClick={() =>
                void runSiteEdit(() =>
                  uninstall(listing, 'host', site.hostId),
                )
              }
            >
              {'Remove'}
            </Button>
          ) : null}
        </Stack>
      ))}
    </Stack>

    {staleSites.length ? (
      <Button
        size="small"
        variant="outlined"
        color="secondary"
        disabled={siteBusy}
        onClick={() =>
          void runSiteEdit(() =>
            installPlan(
              listing,
              orgInstall.orgWide
                ? [{ scope: 'org' as const }]
                : orgInstall.hostPinnedIds.map(
                    (hostId) => ({
                      scope: 'host' as const,
                      hostId,
                    }),
                  ),
            ),
          )
        }
      >
        {`Update to v${latestVersion}`}
      </Button>
    ) : null}

    {/* Add sites after the fact. The picker used to
        render only when nothing was installed, which
        froze the set at install time. */}
    {!orgInstall.orgWide &&
    orgInstall.availableHostIds.length ? (
      <Stack spacing={0.5}>
        <Typography
          variant="caption"
          color="text.secondary"
        >
          {'Add to more sites'}
        </Typography>
        <FormGroup
          sx={{ maxHeight: 200, overflowY: 'auto' }}
        >
          {orgInstall.availableHostIds.map((hostIdOption) => (
            <FormControlLabel
              key={hostIdOption}
              control={
                <Checkbox
                  size="small"
                  checked={addHostIds.includes(
                    hostIdOption,
                  )}
                  onChange={(event) =>
                    setAddHostIds((current) =>
                      event.target.checked
                        ? [...current, hostIdOption]
                        : current.filter(
                            (id) => id !== hostIdOption,
                          ),
                    )
                  }
                />
              }
              label={
                hosts.find(
                  (host) => host.id === hostIdOption,
                )?.label ?? hostIdOption
              }
              slotProps={{
                typography: { variant: 'body2' },
              }}
            />
          ))}
        </FormGroup>
        <Box>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            disabled={siteBusy || !addHostIds.length}
            onClick={() =>
              void runSiteEdit(() =>
                installPlan(
                  listing,
                  addHostIds.map((hostIdOption) => ({
                    scope: 'host' as const,
                    hostId: hostIdOption,
                  })),
                ),
              )
            }
          >
            {'Add to selected'}
          </Button>
        </Box>
      </Stack>
    ) : null}

    <Divider />

    {/* Change the shape of the install, not just its
        membership: one org pin covers sites made
        later, which no set of host pins can. */}
    {orgInstall.orgWide ? (
      <Button
        fullWidth
        size="small"
        color="inherit"
        disabled={siteBusy}
        onClick={() =>
          void runSiteEdit(() =>
            uninstall(listing, 'org'),
          )
        }
      >
        {'Uninstall org-wide'}
      </Button>
    ) : (
      <Button
        fullWidth
        size="small"
        variant="outlined"
        color="secondary"
        disabled={siteBusy}
        onClick={() =>
          void runSiteEdit(async () => {
            // Promote: add the org pin, then drop the
            // per-site pins it makes redundant. In
            // this order, so a failure part-way
            // leaves the plugin installed everywhere
            // it already was rather than nowhere.
            await installPlan(listing, [
              { scope: 'org' },
            ])
            for (const hostIdPinned of orgInstall.hostPinnedIds) {
              await uninstall(
                listing,
                'host',
                hostIdPinned,
              )
            }
          })
        }
      >
        {'Install for the whole organization'}
      </Button>
    )}
  </Stack>
  )
}
PluginSiteSet.displayName = 'PluginSiteSet'

export default PluginSiteSet
