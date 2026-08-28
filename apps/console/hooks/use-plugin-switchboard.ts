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
  isDefaultOffPerSite,
  resolveDisableCascade,
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
} from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHost, useUser, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import type { CascadeEntry } from '../components/plugin-disable-cascade-dialog.component'
import useCurrentOrg from './use-current-org'
import { useOrgScope } from './use-org-scope'

/**
 * ONE writer of plugin enablement per scope, called by every surface that
 * offers the switch (AGL-2486, AGL-1014).
 *
 * The switch used to live only on the two LIST surfaces, and the site detail
 * page said why in as many words: per-site enablement is a boundary rather
 * than a preference — `resolveHostEnabledPlugins` is the single enforcement
 * point for navigation, the editor, published pages and API dispatch — and
 * turning one off cascades to the plugins that depend on it, so a second
 * writer of that state would be a second place for the cascade to be
 * forgotten. That reasoning is right; the conclusion it reached was not. The
 * answer to "two surfaces must not each own this write" is one writer both
 * call, not a detail page that sends the reader back to a list.
 *
 * So the cascade check lives HERE, in front of the write, and cannot be
 * reached around: a surface gets `requestToggle` and a dialog to render, and
 * has no path to the write that skips them. Adding a third surface adds no
 * third place to forget.
 *
 * ⚠️ This is still the courtesy half. The refusal a caller cannot skip is
 * `strandedDependents`, enforced in `/api/orgs/settings` for the workspace
 * scope; the per-site write goes client-side to the host document, whose
 * rules gate on ROLE and do not read the dependency graph.
 */
export interface PluginSwitchboard {
  /** Whether this plugin is on at this scope, as the surface should render it. */
  isOn: (pluginId: string) => boolean
  /** Whether this plugin is locked on and cannot be switched off. */
  isLocked: (pluginId: string) => boolean
  /**
   * Ask for a change. A disable that would strand a declared dependent opens
   * the cascade dialog instead of writing; everything else applies at once.
   */
  requestToggle: (pluginId: string, on: boolean) => void
  /** True once the state the write is seeded from can be trusted. */
  ready: boolean
  /** True when this reader may change anything here at all. */
  canWrite: boolean
  /** A write is in flight. */
  busy: boolean
  /** Local edits not yet written (deferred-save surfaces only). */
  dirty: boolean
  /** Persist the local edits. A no-op where the scope writes on change. */
  save: () => Promise<void>
  /** Spread onto `PluginDisableCascadeDialog`. */
  dialogProps: {
    open: boolean
    pluginId: string
    pluginLabel: string
    cascade: CascadeEntry[]
    scope: 'org' | 'site'
    hostId?: string
    onCancel: () => void
    onConfirm: () => void
  }
}

/** A pending cascade, held rather than applied so Cancel is a genuine no-op. */
interface Pending {
  id: string
  on: boolean
  label: string
  cascade: CascadeEntry[]
}

const catalogLabel = (pluginId: string): string =>
  FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === pluginId)?.label ??
  pluginId

export interface SwitchboardOptions {
  /**
   * How a plugin id reads to an operator. Defaults to the first-party
   * catalog label, which answers with the raw id for a marketplace listing —
   * a surface that knows the install's `displayName` should pass it, or the
   * dialog names a Firestore document id in a sentence about consequences.
   */
  labelFor?: (pluginId: string) => string
}

/**
 * The WORKSPACE switchboard: `org.enabledPlugins`, through
 * `/api/orgs/settings`. Writes on change — the array is replaced whole, so
 * there is no half-applied cascade to recover from.
 */
export function useOrgPluginSwitchboard(
  options: SwitchboardOptions = {},
): PluginSwitchboard {
  const { currentOrg } = useOrgScope()
  const { org, ready } = useCurrentOrg()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const orgId = currentOrg?.$id ?? ''
  const canWrite = canManageOrg(currentOrg?.role)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const labelFor = options.labelFor ?? catalogLabel

  // The org DOCUMENT, never `org.enabledPlugins` — an array has no
  // `enabledPlugins` property, so the resolver would answer with the default
  // set for every workspace and every toggle would read-modify-write those
  // defaults back over whatever the workspace had stored.
  const enabled = useMemo(() => resolveEnabledPlugins(org), [org])
  const enabledSet = useMemo(() => new Set(enabled), [enabled])

  const write = useCallback(
    async (pluginIds: string[]) => {
      setBusy(true)
      try {
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
        enqueueSnackbar('Plugins updated', {
          variant: 'success',
          persist: false,
        })
      } finally {
        setBusy(false)
      }
    },
    [enqueueSnackbar, orgId, user],
  )

  const applyDisable = useCallback(
    (pluginId: string, cascade: readonly string[]) => {
      const next = new Set(enabledSet)
      next.delete(pluginId)
      for (const id of cascade) next.delete(id)
      void write([...next])
    },
    [enabledSet, write],
  )

  const requestToggle = useCallback(
    (pluginId: string, on: boolean) => {
      /*
       * Unready means `enabled` is the DEFAULT set rather than this
       * workspace's, and the write below replaces the array — so a toggle
       * inside the loading window would switch every plugin the workspace had
       * turned off back on, for every site in it.
       */
      if (!ready) {
        return void enqueueSnackbar(
          'Still loading this workspace’s plugins — try again in a moment',
          { variant: 'info', persist: false },
        )
      }
      if (on) {
        const next = new Set(enabledSet)
        next.add(pluginId)
        return void write([...next])
      }
      // Only a DISABLE can strand a dependent. The org level cascades further
      // than the site level: a site can never turn back on what the workspace
      // has switched off, so this lands on every site in the workspace.
      const cascade = resolveDisableCascade(pluginId, enabled)
      if (!cascade.length) return void applyDisable(pluginId, [])
      setPending({
        id: pluginId,
        on,
        label: labelFor(pluginId),
        cascade: cascade.map((one) => ({ id: one, label: labelFor(one) })),
      })
    },
    [applyDisable, enabled, enabledSet, enqueueSnackbar, labelFor, ready, write],
  )

  return {
    isOn: (pluginId: string) => enabledSet.has(pluginId),
    isLocked: (pluginId: string) =>
      Boolean(
        FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === pluginId)?.alwaysOn,
      ),
    requestToggle,
    ready,
    canWrite,
    busy,
    dirty: false,
    save: async () => undefined,
    dialogProps: {
      open: Boolean(pending),
      pluginId: pending?.id ?? '',
      pluginLabel: pending?.label ?? '',
      cascade: pending?.cascade ?? [],
      scope: 'org',
      onCancel: () => setPending(null),
      onConfirm: () => {
        if (!pending) return
        applyDisable(
          pending.id,
          pending.cascade.map((entry) => entry.id),
        )
        setPending(null)
      },
    },
  }
}

/** The two host fields that together decide what runs on one site. */
interface SiteState {
  /** Refusals — every ordinary plugin is on until it appears here. */
  disabled: string[]
  /** Consent — a `defaultOffPerSite` plugin is off until it appears here. */
  optedIn: string[]
}

export interface SiteSwitchboardOptions extends SwitchboardOptions {
  /**
   * Write as soon as a change is applied, rather than collecting edits behind
   * a Save button. The list surface batches a whole switchboard; a detail page
   * is about ONE plugin, and a Save button for a single switch the reader just
   * flipped reads as a second, unexplained step.
   */
  autoSave?: boolean
  /** The reader may not write — rendered disabled rather than hidden. */
  readOnly?: boolean
}

/**
 * The SITE switchboard: the host document's `disabledPlugins` deny-list and
 * its `enabledPlugins` opt-in list, written together in one `setDoc`.
 */
export function useSitePluginSwitchboard(
  hostId: string,
  options: SiteSwitchboardOptions = {},
): PluginSwitchboard & {
  /**
   * The host's plugin policy AS THE SWITCHES CURRENTLY STAND — stored values
   * until the reader edits one, the pending edit after.
   *
   * Exposed so a page can resolve "does this run here" from the same state the
   * switch is showing, instead of listening to `hosts/{hostId}` a second time
   * and answering from a document the pending edit has not reached. Two reads
   * of one document are two answers waiting to disagree, and the surface that
   * disagreed would be the sentence explaining the switch beside it.
   */
  siteDoc: { disabledPlugins: string[]; enabledPlugins: string[] }
} {
  const { enqueueSnackbar } = useSnackbar()
  // EXEMPT from `no-unguarded-loading-hook`: `org` reaches only
  // `resolveEnabledPlugins`, which fails OPEN — an absent list means every
  // first-party plugin — so an unready org can only over-state what is
  // available to switch, never under-state it. The dangerous half is the
  // write, and it is seeded from the HOST doc, whose staleness is guarded by
  // `writeGuardedBySeed` below.
  // eslint-disable-next-line aglyn/no-unguarded-loading-hook
  const { org } = useCurrentOrg()
  const {
    doc: { data: host, status: hostStatus, fromCache: hostFromCache },
    setDoc,
  } = useHost({ hostId })
  const [state, setState] = useState<SiteState>({ disabled: [], optedIn: [] })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const labelFor = options.labelFor ?? catalogLabel

  const storedDisabled = Array.isArray(host?.disabledPlugins)
    ? host.disabledPlugins.map(String).join('|')
    : ''
  const storedOptedIn = Array.isArray(host?.enabledPlugins)
    ? host.enabledPlugins.map(String).join('|')
    : ''

  useEffect(() => {
    // Reset from the live doc until the user starts editing.
    if (dirty) return
    setState({
      disabled: storedDisabled ? storedDisabled.split('|') : [],
      optedIn: storedOptedIn ? storedOptedIn.split('|') : [],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedDisabled, storedOptedIn])

  /** What runs on this site given a candidate local state. */
  const effective = useCallback(
    (candidate: SiteState) =>
      resolveHostEnabledPlugins(org, {
        disabledPlugins: candidate.disabled,
        enabledPlugins: candidate.optedIn,
      }),
    [org],
  )

  const enabledNow = useMemo(() => effective(state), [effective, state])
  const enabledSet = useMemo(() => new Set(enabledNow), [enabledNow])

  const save = useCallback(
    async (next?: SiteState) => {
      const payload = next ?? state
      setBusy(true)
      try {
        // The guard WRAPS the write: an early return is a shape you can keep
        // while losing the protection. Both arrays are replaced atomically —
        // a deep merge could never REMOVE an id — so a cached seed would
        // re-enable every plugin disabled since that snapshot, and
        // `resolveHostEnabledPlugins` is the single enforcement point, so a
        // plugin switched back on here is running again on a live site with
        // nobody having asked for it.
        const verdict = await writeGuardedBySeed(
          {
            subject: 'site plugin list',
            unreadable: hostStatus === 'error',
            fromCache: hostFromCache,
          },
          async () => {
            // Both lists in ONE write: they are two halves of a single
            // switchboard state, and saving them separately would let a
            // failure land between them.
            await setDoc(
              {
                disabledPlugins: payload.disabled,
                enabledPlugins: payload.optedIn,
              },
              { mergeFields: ['disabledPlugins', 'enabledPlugins'] },
            )
          },
        )
        if (!verdict.ok) {
          // `dirty` stays true and the switches keep their positions, so the
          // user can retry rather than discovering later that nothing saved.
          return void enqueueSnackbar(verdict.message, { variant: 'warning' })
        }
        enqueueSnackbar('Site plugins saved', { variant: 'success' })
        setDirty(false)
      } catch (error) {
        enqueueSnackbar(`Error: ${JSON.stringify(error)}`, { variant: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [enqueueSnackbar, hostFromCache, hostStatus, setDoc, state],
  )

  /**
   * One switch, two fields. A `defaultOffPerSite` row records CONSENT in
   * `enabledPlugins`; every other row records refusal in `disabledPlugins`.
   * Which list a row writes follows from the catalog, never from the row's
   * position or label.
   */
  const applyIds = useCallback(
    (current: SiteState, pluginIds: readonly string[], on: boolean): SiteState => {
      const next: SiteState = {
        disabled: [...current.disabled],
        optedIn: [...current.optedIn],
      }
      for (const pluginId of pluginIds) {
        if (isDefaultOffPerSite(pluginId)) {
          next.optedIn = on
            ? next.optedIn.includes(pluginId)
              ? next.optedIn
              : [...next.optedIn, pluginId]
            : next.optedIn.filter((id) => id !== pluginId)
          // An explicit deny beats an opt-in, so a site turning one ON must
          // also stop refusing it — otherwise the resolver keeps subtracting
          // it and the switch reads on while the plugin does not run.
          if (on) next.disabled = next.disabled.filter((id) => id !== pluginId)
          continue
        }
        next.disabled = on
          ? next.disabled.filter((id) => id !== pluginId)
          : next.disabled.includes(pluginId)
            ? next.disabled
            : [...next.disabled, pluginId]
      }
      return next
    },
    [],
  )

  const commit = useCallback(
    (pluginIds: readonly string[], on: boolean) => {
      const next = applyIds(state, pluginIds, on)
      setState(next)
      if (options.autoSave) return void save(next)
      setDirty(true)
    },
    [applyIds, options.autoSave, save, state],
  )

  const requestToggle = useCallback(
    (pluginId: string, on: boolean) => {
      if (options.readOnly) return
      // Only a DISABLE can strand a dependent. Turning one on cannot.
      if (on) return void commit([pluginId], true)
      const cascade = resolveDisableCascade(pluginId, enabledNow)
      if (!cascade.length) return void commit([pluginId], false)
      setPending({
        id: pluginId,
        on,
        label: labelFor(pluginId),
        cascade: cascade.map((one) => ({ id: one, label: labelFor(one) })),
      })
    },
    [commit, enabledNow, labelFor, options.readOnly],
  )

  return {
    siteDoc: {
      disabledPlugins: state.disabled,
      enabledPlugins: state.optedIn,
    },
    isOn: (pluginId: string) => enabledSet.has(pluginId),
    isLocked: (pluginId: string) =>
      Boolean(
        FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === pluginId)?.alwaysOn,
      ),
    requestToggle,
    // The host doc's own staleness is what the seed guard covers; nothing
    // here claims a plan, so there is no unresolved-entitlement window to
    // hold the list behind.
    ready: hostStatus !== 'loading',
    canWrite: !options.readOnly,
    busy,
    dirty,
    save: () => save(),
    dialogProps: {
      open: Boolean(pending),
      pluginId: pending?.id ?? '',
      pluginLabel: pending?.label ?? '',
      cascade: pending?.cascade ?? [],
      scope: 'site',
      hostId,
      onCancel: () => setPending(null),
      onConfirm: () => {
        if (!pending) return
        // Every id here is ON by construction — `resolveDisableCascade`
        // filters to the enabled set — so the whole cascade is one disable,
        // applied in a single state move and a single write.
        commit([pending.id, ...pending.cascade.map((entry) => entry.id)], false)
        setPending(null)
      },
    },
  }
}
