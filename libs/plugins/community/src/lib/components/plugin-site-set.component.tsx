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
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  FormGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { compareArtifactVersions } from '@aglyn/aglyn'
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
    options?: { intent?: 'install' | 'update'; version?: string | number | null },
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
  /**
   * A site is behind only when its pin is genuinely OLDER (AGL-1017). "Not
   * equal" also fires when a site runs something newer than the offer — a
   * publisher testing their own build, or a version withdrawn after install —
   * and offering to "update" those would quietly move them backwards.
   */
  const staleSites = useMemo(
    () =>
      orgInstall.sites.filter(
        (site) => (compareArtifactVersions(site.version, latestVersion) ?? 0) < 0,
      ),
    [orgInstall.sites, latestVersion],
  )
  /**
   * Update is per-site FIRST (AGL-1017). A version with breaking changes has
   * to be absorbable one site at a time — take it on a quiet site, see what
   * breaks, then decide about the rest — so each site behind the offer gets
   * its own control and the bulk action is the convenience on top.
   *
   * An org pin cannot do that: it is one pointer covering every site, so
   * moving it moves all of them at once. Rather than hide that behind a
   * button that looks per-site, the panel says so and points at the split.
   */
  const [pending, setPending] = useState<
    { hostIds: string[] | null; label: string } | null
  >(null)
  const [changelog, setChangelog] = useState<string | null>(null)
  useEffect(() => {
    if (!pending || !listing?.$id || !latestVersion) return
    let active = true
    setChangelog(null)
    void fetch(
      `/api/community/listing-versions?listingId=${encodeURIComponent(
        String(listing.$id),
      )}`,
    )
      .then((response) => (response.ok ? response.json() : { versions: [] }))
      .then((payload) => {
        if (!active) return
        const entry = (payload?.versions ?? []).find(
          (version: { version?: string }) =>
            String(version?.version) === String(latestVersion),
        )
        setChangelog(entry?.changelog ?? '')
      })
      .catch(() => active && setChangelog(''))
    return () => {
      active = false
    }
  }, [pending, listing?.$id, latestVersion])
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
          {/* This site alone (AGL-1017). Only where the site owns its pin —
              a site covered by the org pin has no pointer of its own to
              move, and pretending otherwise would update every site. */}
          {site.pinnedBy === 'host' &&
          staleSites.some((stale) => stale.hostId === site.hostId) ? (
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              disabled={siteBusy}
              onClick={() =>
                setPending({
                  hostIds: [site.hostId],
                  label: site.label,
                })
              }
            >
              {`Update to v${latestVersion}`}
            </Button>
          ) : null}
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
      <Stack spacing={1}>
        {orgInstall.orgWide ? (
          // Said out loud rather than discovered afterwards (AGL-1017): an
          // org pin is a single pointer, so there is no half of it to move.
          // A workspace that wants to stage a breaking update has to be on
          // per-site pins, and the way there is the split below.
          <Alert severity="info" variant="outlined">
            {'This is one organization-wide pin, so updating moves every ' +
              'site at once. To take a version on one site first, install ' +
              'per site instead.'}
          </Alert>
        ) : null}
        <Box>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            disabled={siteBusy}
            onClick={() =>
              setPending({
                hostIds: orgInstall.orgWide ? null : staleSites.map((site) => site.hostId),
                label: orgInstall.orgWide
                  ? 'every site in this organization'
                  : `${staleSites.length} site${staleSites.length === 1 ? '' : 's'}`,
              })
            }
          >
            {orgInstall.orgWide
              ? `Update to v${latestVersion}`
              : `Update all ${staleSites.length} to v${latestVersion}`}
          </Button>
        </Box>
      </Stack>
    ) : null}

    {/* What changes, before it changes (AGL-1017). Third-party code moving
        in a workspace deserves more than a spinner: the version pair, the
        publisher's changelog, and which sites are about to take it. */}
    <Dialog
      open={Boolean(pending)}
      onClose={() => setPending(null)}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{`Update to v${latestVersion}?`}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2">
            {`${listing?.displayName ?? 'This plugin'} moves from the version ` +
              `running now to v${latestVersion} on ${pending?.label ?? ''}.`}
          </Typography>
          {pending?.hostIds && pending.hostIds.length === 1 ? (
            <Typography variant="body2" color="text.secondary">
              {'Other sites stay on the version they are running.'}
            </Typography>
          ) : null}
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{"What's new"}</Typography>
            {changelog === null ? (
              <Typography variant="body2" color="text.secondary">
                {'Loading the changelog…'}
              </Typography>
            ) : changelog ? (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {changelog}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {'The publisher did not describe this version.'}
              </Typography>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {'Pins only move forward — there is no going back to the ' +
              'previous version from here.'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={() => setPending(null)}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={siteBusy}
          onClick={() => {
            const target = pending
            setPending(null)
            if (!target) return
            void runSiteEdit(() =>
              installPlan(
                listing,
                target.hostIds
                  ? target.hostIds.map((hostId) => ({
                      scope: 'host' as const,
                      hostId,
                    }))
                  : [{ scope: 'org' as const }],
                { intent: 'update', version: latestVersion },
              ),
            )
          }}
        >
          {'Update'}
        </Button>
      </DialogActions>
    </Dialog>

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
      <>
        {/* The inverse of promote (AGL-1017), and the thing that makes
            per-site updates reachable at all: one org pin cannot be moved
            for one site, so a workspace that needs to stage a breaking
            version has to hold per-site pins first. Sites added later are
            no longer covered automatically — that is the trade, and the
            button says so rather than discovering it weeks later. */}
        <Button
          fullWidth
          size="small"
          variant="outlined"
          color="secondary"
          disabled={siteBusy || !hosts.length}
          onClick={() =>
            void runSiteEdit(async () => {
              // Pin every site BEFORE dropping the org pin, so a failure
              // part-way leaves the plugin installed everywhere it already
              // was rather than nowhere.
              await installPlan(
                listing,
                hosts.map((host) => ({ scope: 'host' as const, hostId: host.id })),
              )
              await uninstall(listing, 'org')
            })
          }
        >
          {'Split into per-site installs'}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {'Pins each site separately so you can update them one at a time. ' +
            'Sites you add later will not get this plugin automatically.'}
        </Typography>
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
      </>
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
