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
  canManageOrg,
  FIRST_PARTY_PLUGINS,
  resolveDisableCascade,
  resolveEnabledPlugins,
  resolveUpdateState,
  updateStateLabel,
} from '@aglyn/aglyn'
import { mdiChevronRight, mdiPuzzleOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, Container, MdiIcon } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Chip, Stack, Switch, Tooltip, Typography } from '@mui/material'
import { collection, documentId, getDocs, limit, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { useOrgHosts } from '../../../../hooks/use-org-hosts'
import useBranding from '../../../../hooks/use-branding'
import useCurrentOrg from '../../../../hooks/use-current-org'
import PluginDisableCascadeDialog, {
  type CascadeEntry,
} from '../../../../components/plugin-disable-cascade-dialog.component'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'

/**
 * Plugins, as its own console section (AGL-1011).
 *
 * Plugins used to live inside Marketplace, which conflated two different
 * things: shopping for code, and administering the code you already run.
 * It also left the installation detail page (AGL-1007) with no nav tab of
 * its own, so the whole top nav went unhighlighted on it, and no entry point
 * that read like one — the only way in was clicking a listing's name text.
 *
 * This page is the inventory: every plugin this workspace runs, first-party
 * and marketplace together, because where a plugin came from is a fact about
 * it rather than a different kind of thing. Marketplace keeps a quick
 * Installed list for uninstalling, and links here for anything more.
 */
const OrgPlugins: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  // Org-scoped copy names the org's RESOLVED product name (AGL-2319).
  const { branding } = useBranding()
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const orgId = currentOrg?.$id ?? ''
  const canManage = canManageOrg(currentOrg?.role)

  // Held at null while the org scope loads, never `orgs/-pending-`
  // (AGL-1440): installs are member-gated, so the sentinel was a
  // guaranteed-denied listen on every mount of this page.
  const { data: orgInstalls } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(collection(firestore, 'orgs', orgId, 'installs'), limit(100))
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )

  // Site pins too (AGL-1012). Reading only the org pins meant a plugin
  // targeted at specific sites — installed, running, and the whole point of
  // AGL-773/997 — was absent from the workspace's own plugin inventory, and
  // the page said so silently. Fan-in per site, as elsewhere: the host count
  // is data, so a hook per host would change the hook count between renders.
  // `undefined`, never `null`, while the workspace resolves (AGL-2350):
  // `null` means "an account with no org — list every site they hold", and
  // on an org-scoped route that is never the right answer. It listed another
  // client's sites for the width of the cold-load window.
  const { hosts } = useOrgHosts(firestore, user?.uid, orgId || undefined)
  const hostList = useMemo(
    () =>
      ((hosts as Array<{ $id: string; displayName?: string; subdomain?: string }>) ??
        []).map((host) => ({
        id: host.$id,
        label: host.displayName || host.subdomain || host.$id,
      })),
    [hosts],
  )
  const hostIdsKey = hostList.map((host) => host.id).join('|')
  const [sitePins, setSitePins] = useState<Record<string, any[]>>({})
  useEffect(() => {
    if (!hostList.length) return
    let active = true
    void Promise.all(
      hostList.map(async (host) => {
        const snapshot = await getDocs(
          query(
            collection(firestore, 'hosts', host.id, 'installs'),
            limit(100),
          ),
        )
        return [
          host.id,
          snapshot.docs.map((entry) => ({ $id: entry.id, ...entry.data() })),
        ] as const
      }),
    )
      .then((entries) => {
        if (active) setSitePins(Object.fromEntries(entries))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, hostIdsKey])

  /**
   * One row per INSTALLATION, not per pin: a plugin on three sites is one
   * thing an admin manages, and the scope is a fact about it rather than
   * three separate entries. An org pin covers every site, so it wins the
   * caption outright.
   */
  const installations = useMemo(() => {
    const byListing = new Map<
      string,
      { $id: string; displayName?: string; pluginId?: string; version?: string; siteLabels: string[]; orgWide: boolean }
    >()
    for (const install of orgInstalls ?? []) {
      byListing.set(install.$id, {
        ...install,
        siteLabels: [],
        orgWide: true,
      })
    }
    for (const host of hostList) {
      for (const pin of sitePins[host.id] ?? []) {
        const existing = byListing.get(pin.$id)
        if (existing) existing.siteLabels.push(host.label)
        else
          byListing.set(pin.$id, {
            ...pin,
            siteLabels: [host.label],
            orgWide: false,
          })
      }
    }
    return [...byListing.values()]
  }, [orgInstalls, hostList, sitePins])

  /**
   * The listings behind those installs, for the update chip (AGL-1016).
   *
   * Listings are public reads, so this is a plain fetch — but `in` caps at 30
   * ids, and a workspace can run more plugins than that, so it chunks. A
   * failure leaves the map empty and every row resolves to `unknown`, which
   * reads as "we can't say" rather than a false "up to date".
   */
  const listingIdsKey = installations.map((install) => install.$id).sort().join('|')
  const [listings, setListings] = useState<Record<string, any>>({})
  /**
   * The kill switches for the same listings (AGL-2368).
   *
   * Fetched here rather than left to the mirror because a revoked version
   * stays `approved` — revocation does not clear a review verdict — so the
   * chip offered an update `install-plugin` answers 409 to. Same public
   * collection, same chunking, and a failure leaves the map empty, which
   * degrades to the mirror alone rather than to a false "up to date".
   */
  const [revocations, setRevocations] = useState<Record<string, any>>({})
  useEffect(() => {
    const ids = listingIdsKey ? listingIdsKey.split('|') : []
    if (!ids.length) return
    let active = true
    const chunks: string[][] = []
    for (let index = 0; index < ids.length; index += 30) {
      chunks.push(ids.slice(index, index + 30))
    }
    const fetchChunks = (path: string) =>
      Promise.all(
        chunks.map((chunk) =>
          getDocs(
            query(collection(firestore, path), where(documentId(), 'in', chunk)),
          ),
        ),
      ).then((results) =>
        Object.fromEntries(
          results.flatMap((snapshot) =>
            snapshot.docs.map((entry) => [entry.id, entry.data()]),
          ),
        ),
      )
    void fetchChunks('marketplaceListings')
      .then((map) => {
        if (!active) return
        setListings(map)
      })
      .catch(() => undefined)
    void fetchChunks('revocations')
      .then((map) => {
        if (!active) return
        setRevocations(map)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [firestore, listingIdsKey])

  // The ORG DOCUMENT, not `org.enabledPlugins` (AGL-2486). This passed the
  // array, and an array has no `enabledPlugins` property — so the resolver
  // saw `undefined` and returned DEFAULT_ENABLED_PLUGINS every time. The
  // page reported every plugin as enabled whatever the workspace had stored,
  // and `toggle` below read-modify-WRITES off this value into an API that
  // REPLACES the array, so flipping any one plugin silently switched every
  // plugin this workspace had turned off back on, for every site in it. The
  // `as any` is what kept the compiler from saying so, which is why it is
  // gone rather than merely corrected.
  const enabled = useMemo(() => new Set(resolveEnabledPlugins(org)), [org])

  /**
   * The pending cascade (AGL-2486). This switchboard SAVES on change, so the
   * dialog has to stand between the toggle and the write — held here, applied
   * only on confirm. Cancel drops it and writes nothing, and because the
   * switch is controlled by `enabled` (which comes from the org doc, and has
   * not moved) it springs back to ON by itself.
   */
  const [pending, setPending] = useState<{
    id: string
    label: string
    cascade: CascadeEntry[]
  } | null>(null)

  const labelFor = (pluginId: string) =>
    FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === pluginId)?.label ??
    pluginId

  const saveEnabledPlugins = async (pluginIds: string[]) => {
    const idToken = await (
      user as { getIdToken?: () => Promise<string> }
    )?.getIdToken?.()
    const response = await fetch('/api/orgs/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        orgId,
        action: 'set-enabled-plugins',
        enabledPlugins: pluginIds,
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      return void enqueueSnackbar(payload?.error ?? 'Request failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
    enqueueSnackbar('Plugins updated', { variant: 'success', persist: false })
  }

  const toggle = (pluginId: string, on: boolean) => {
    // AGL-1422, and the worst shape in this sweep: not a refusal but a
    // read-modify-WRITE off a value that has not loaded. `enabled` is
    // `resolveEnabledPlugins(org)`, and an undefined `org` resolves to the
    // DEFAULT set — so a toggle inside the loading window saves the defaults
    // plus this one id, silently switching every plugin the workspace had
    // turned off back ON for every site in it. `set-enabled-plugins`
    // replaces the array, so there is no merge to soften it.
    if (!orgReady) {
      return void enqueueSnackbar(
        'Still loading this workspace’s plugins — try again in a moment',
        { variant: 'info', persist: false },
      )
    }
    if (on) {
      const next = new Set(enabled)
      next.add(pluginId)
      return void saveEnabledPlugins([...next])
    }
    // AGL-2486. Only a DISABLE can strand a dependent, and the org level
    // cascades further than the site level: a site can never turn back on
    // what the workspace has switched off, so this lands on every site.
    const cascade = resolveDisableCascade(pluginId, [...enabled])
    if (!cascade.length) return void disableWithCascade(pluginId, [])
    setPending({
      id: pluginId,
      label: labelFor(pluginId),
      cascade: cascade.map((one) => ({ id: one, label: labelFor(one) })),
    })
  }

  /**
   * ONE write for the whole cascade (AGL-2486). `set-enabled-plugins`
   * REPLACES the array, so the plugin and everything depending on it are
   * removed in a single request — there is no window in which A is off while
   * B still believes it can use A, and no half-applied cascade to recover
   * from. Nothing records that these were cascaded, so re-enabling the
   * plugin does NOT bring them back; the dialog says so before you agree.
   */
  const disableWithCascade = (pluginId: string, cascade: readonly string[]) => {
    const next = new Set(enabled)
    next.delete(pluginId)
    for (const id of cascade) next.delete(id)
    void saveEnabledPlugins([...next])
  }

  /**
   * One row per plugin. The chevron and the whole-row link are the point of
   * AGL-1011: the previous entry point was a name rendered as body text, so
   * nothing said it went anywhere.
   */
  const row = (
    key: string,
    pluginRef: string,
    label: string,
    caption: string,
    trailing?: React.ReactNode,
  ) => (
    <AppLink
      key={key}
      href={buildRoute(Route.ORG_PLUGIN_INSTALLATION, {
        orgSlug,
        pluginRef,
      })}
      color="inherit"
      underline="none"
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          py: 1.25,
          px: 1,
          mx: -1,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {caption}
          </Typography>
        </Stack>
        {trailing}
        <MdiIcon
          path={mdiChevronRight.path}
          color="disabled"
          sx={{ fontSize: 20 }}
        />
      </Stack>
    </AppLink>
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Plugins',
          href: buildRoute(Route.ORG_PLUGINS, { orgSlug }),
        },
      ]}
      header={{
        children: 'Plugins',
        icon: { path: mdiPuzzleOutline.path },
      }}
      // A way onward (AGL-1024). Now that Plugins is its own section,
      // landing here with nothing installed used to offer no route to
      // getting any — the marketplace was a tab away with nothing saying so.
      headerRight={
        <AppLink href={buildRoute(Route.ORG_MARKETPLACE, { orgSlug })}>
          <Button variant="outlined" color="primary" component="span">
            {'Install a plugin'}
          </Button>
        </AppLink>
      }
      help="plugins"
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <Stack spacing={3}>
          <CardDisplay
            header={'Installed from the marketplace'}
            // Card-level help, not just the page's (AGL-2129). This is the
            // card people arrive at looking for a switch, having read in
            // Marketplace that installing is done there — so it points at the
            // step of the walkthrough that explains the split.
            help={docsHelp('installYourFirstPlugin', { anchor: '#step-7-off' })}
            contentGutterX
            contentGutterY
          >
            {installations.length ? (
              <Stack>
                {installations.map((install) => {
                  // The update signal (AGL-1016/2368), from the one shared
                  // comparison — for plugins that is the newest INSTALLABLE
                  // version, so this can never offer what install refuses.
                  const status = resolveUpdateState(
                    install as never,
                    listings[install.$id] ?? null,
                    'plugin',
                    revocations[install.$id] ?? null,
                  )
                  return row(
                    install.$id,
                    install.$id,
                    install.displayName ?? install.pluginId ?? install.$id,
                    `v${install.version} · ` +
                      (install.orgWide
                        ? 'every site in this organization'
                        : install.siteLabels.length === 1
                          ? install.siteLabels[0]
                          : `${install.siteLabels.length} sites`),
                    status.state === 'update-available' ? (
                      <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={`v${status.availableVersion} available`}
                      />
                    ) : status.state === 'unknown' ? (
                      <Tooltip title={updateStateLabel(status)}>
                        <Chip size="small" variant="outlined" label={'Unknown'} />
                      </Tooltip>
                    ) : undefined,
                  )
                })}
              </Stack>
            ) : (
              <Alert severity="info">
                {'Nothing installed from the marketplace yet — browse it to ' +
                  'add one.'}
              </Alert>
            )}
          </CardDisplay>

          <CardDisplay
            header={'Built in'}
            help={docsHelp('plugins', {
              excerpt:
                `${branding.productName}’s own plugins. Switching one off removes it from every site in this organization — its navigation, the editor, published pages and the API.`,
            })}
            contentGutterX
            contentGutterY
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 1 }}
            >
              {`The plugins that ship with ${branding.productName}. Turning ` +
                'one off removes it from navigation, the editor, published ' +
                'sites and the API for every site in this organization.'}
            </Typography>
            <Stack>
              {FIRST_PARTY_PLUGINS.map((plugin) =>
                row(
                  plugin.id,
                  plugin.id,
                  plugin.label,
                  plugin.description ?? '',
                  <Switch
                    size="small"
                    // The row is a link and the label is rendered as its own
                    // text, so without this the control has no accessible
                    // name of its own — nothing a screen reader (or a test)
                    // can use to say WHICH plugin a switch belongs to.
                    slotProps={{
                      input: { 'aria-label': `Toggle ${plugin.label}` },
                    }}
                    checked={plugin.alwaysOn || enabled.has(plugin.id)}
                    // Unready means these switch positions are the defaults,
                    // not this workspace's (AGL-1422) — so they are not
                    // something to act on yet.
                    disabled={plugin.alwaysOn || !canManage || !orgReady}
                    /*
                     * The toggle is driven from the CLICK, not from `onChange`
                     * — and that is a fix, not a style choice (AGL-2486).
                     *
                     * The row is a link, so the switch must stop the click
                     * reaching it or toggling a plugin also navigates away.
                     * But `preventDefault()` on a checkbox cancels its
                     * activation behaviour, which reverts `checked` and means
                     * no change event is ever produced — so `onChange` never
                     * ran and EVERY switch on this page has been inert since
                     * AGL-1011 (160df6a5f). Verified with a real mouse click
                     * in the browser: no navigation, no save, no state move.
                     *
                     * `onClick` does fire — it is what cancels the navigation
                     * — so the intent is read there, against the controlled
                     * value rather than the input's own (which preventDefault
                     * is about to revert anyway).
                     */
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      toggle(plugin.id, !enabled.has(plugin.id))
                    }}
                  />,
                ),
              )}
            </Stack>
          </CardDisplay>
        </Stack>
        <PluginDisableCascadeDialog
          open={Boolean(pending)}
          pluginId={pending?.id ?? ''}
          pluginLabel={pending?.label ?? ''}
          cascade={pending?.cascade ?? []}
          scope="org"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (!pending) return
            disableWithCascade(
              pending.id,
              pending.cascade.map((entry) => entry.id),
            )
            setPending(null)
          }}
        />
      </Container>
    </DashboardLayout>
  )
}
OrgPlugins.displayName = 'Page:OrgPlugins'

export default OrgPlugins
