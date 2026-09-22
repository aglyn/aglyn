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
  CRM_DAILY_DIGEST_KEY,
  crmDailyDigestEnabled,
  DIGEST_PREFS_FIELD,
  INSIGHT_DIGESTS_FIELD,
  insightDigestSubscribed,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_CHANNEL_DEFAULTS,
  NOTIFICATION_SETTINGS_FIELD,
  notificationAccountTypePref,
  notificationCategory,
  notificationOverriddenScopes,
  notificationScopePref,
  PLATFORM_BRAND_NAME,
  STAFF_NOTIFICATION_CATEGORIES,
  type AglynNotificationType,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationSettings,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
// Never a raw `Table` (AGL-3045): a card clips whatever is wider than it is,
// and the scope table is six rows of three-button groups.
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../../../../../constants/docs-links'
import NotificationCategoryTable from '../../../../../../components/notification-category-table.component'
import useIsStaff from '../../../../../../hooks/use-is-staff'
import useNotificationAlertPrefs from '../../../../../../hooks/use-notification-prefs'
import useOrgHosts from '../../../../../../hooks/use-org-hosts'
import { useOrgScope } from '../../../../../../hooks/use-org-scope'
import {
  desktopNotificationPermission,
  playNotificationChime,
  requestDesktopNotifications,
  showDesktopNotification,
} from '../../../../../../utils/notification-alerts'

const CHANNELS: Array<{ key: NotificationChannel; label: string }> = [
  { key: 'console', label: 'In console' },
  { key: 'email', label: 'Email' },
]

/** One scope the page can edit — the account, a workspace, or a site. */
type Scope =
  { kind: 'account' } | { kind: 'org' | 'host'; id: string; label: string }

const ACCOUNT_SCOPE_VALUE = 'account'
const scopeValue = (scope: Scope) =>
  scope.kind === 'account' ? ACCOUNT_SCOPE_VALUE : `${scope.kind}:${scope.id}`

/**
 * Notification settings (AGL-3226): every preference the product holds about
 * notifications, off the feed that shows them.
 *
 * They were all crammed into the header above that table — six category
 * switches, the digests, the per-device alerts and a test button — which put
 * an edit form above the list it edits and was already the tallest thing on
 * the page before AGL-3223 multiplied it by two channels and by every
 * workspace and site a person belongs to.
 *
 * A SECTION of the Notifications area rather than an area of its own
 * (AGL-3230): the header, the breadcrumb and the rail that selects it belong
 * to the sections layout above, so this renders its four cards and nothing
 * around them.
 */
const ManageNotificationSettings: NextPageWithLayout<
  Record<string, never>
> = () => {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const uid = (user as any)?.uid as string | undefined
  const { orgs, loading: orgsLoading } = useOrgScope()
  const isStaff = useIsStaff()
  const { enqueueSnackbar } = useSnackbar()
  // Per-device, and stated as such on the card: the desktop permission is
  // granted per origin per device, and whether you want sound on your work
  // laptop says nothing about your phone.
  const [alertPrefs, setAlertPrefs] = useNotificationAlertPrefs()
  const [permission, setPermission] = useState<
    NotificationPermission | 'unsupported'
  >('default')
  useEffect(() => {
    setPermission(desktopNotificationPermission())
  }, [])

  /*
   * EVERY site this person holds, across workspaces.
   *
   * `null` widens the list past the open workspace, which every other
   * console surface is forbidden from doing — a site list that widens while
   * resolution is still settling shows a member of two workspaces the wrong
   * workspace's sites. It is right here and only here because this page is
   * not scoped to a workspace at all: it edits preferences for everything
   * the person holds, so there is no open workspace to leak out of.
   *
   * Gated on `loading` all the same, which is what the AGL-236 sweep asks
   * for: `undefined` holds the hook off until the scope has settled, so the
   * picker fills once rather than flashing a partial list.
   */
  const { hosts } = useOrgHosts(firestore, uid, orgsLoading ? undefined : null)

  const [settings, setSettings] = useState<NotificationSettings>({})
  const [digestPrefs, setDigestPrefs] = useState<Record<string, boolean>>({})
  const [insightDigests, setInsightDigests] = useState<Record<string, boolean>>(
    {},
  )
  const [legacyPrefs, setLegacyPrefs] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!uid) return
    let active = true
    void (async () => {
      try {
        const snapshot = await getDoc(doc(firestore, 'users', uid))
        if (!active) return
        setSettings(
          (snapshot.get(NOTIFICATION_SETTINGS_FIELD) as NotificationSettings) ??
            {},
        )
        setDigestPrefs(
          (snapshot.get(DIGEST_PREFS_FIELD) as Record<string, boolean>) ?? {},
        )
        setInsightDigests(
          (snapshot.get(INSIGHT_DIGESTS_FIELD) as Record<string, boolean>) ??
            {},
        )
        setLegacyPrefs(
          (snapshot.get('notificationPrefs') as Record<string, boolean>) ?? {},
        )
      } catch {
        // Defaults when the doc is unreadable — everything in the console,
        // nothing by email.
      }
    })()
    return () => {
      active = false
    }
  }, [firestore, uid])

  const categories = useMemo(
    () =>
      (
        Object.entries(NOTIFICATION_CATEGORY_LABELS) as Array<
          [NotificationCategory, string]
        >
      ).filter(
        // Staff-only rows are hidden from everyone else: a switch for
        // notifications that could never arrive is a promise nothing keeps.
        ([category]) =>
          !STAFF_NOTIFICATION_CATEGORIES.has(category) || isStaff === true,
      ),
    [isStaff],
  )

  const scopes = useMemo<Scope[]>(() => {
    const workspaces = (orgs ?? []).map((org) => ({
      kind: 'org' as const,
      id: org.$id,
      label: org.name ?? org.slug ?? org.$id,
    }))
    const sites = (hosts ?? []).map((host) => ({
      kind: 'host' as const,
      id: host.$id,
      label: `${(host['name'] as string) ?? host['subdomain'] ?? host.$id} (site)`,
    }))
    return [{ kind: 'account' as const }, ...workspaces, ...sites]
  }, [orgs, hosts])

  const [selected, setSelected] = useState<string>(ACCOUNT_SCOPE_VALUE)
  const scope = useMemo<Scope>(
    () =>
      scopes.find((entry) => scopeValue(entry) === selected) ?? {
        kind: 'account',
      },
    [scopes, selected],
  )

  const overridden = useMemo(
    () => notificationOverriddenScopes(settings),
    [settings],
  )

  /**
   * Writes one cell.
   *
   * `undefined` REMOVES the key rather than storing it, because that is what
   * Inherit means and Firestore refuses `undefined` anyway. The whole
   * document's `notificationSettings` is written back each time: the map is a
   * few dozen booleans, and a field-path merge would leave an emptied
   * override as a husk that the "scopes you have changed" list would keep
   * reporting forever.
   */
  const write = useCallback(
    (
      target: Scope,
      category: NotificationCategory,
      channel: NotificationChannel,
      value: boolean | undefined,
    ) => {
      if (!uid) return
      const next: NotificationSettings = JSON.parse(JSON.stringify(settings))
      const layer =
        target.kind === 'account'
          ? (next.account ??= {})
          : target.kind === 'org'
            ? ((next.orgs ??= {})[target.id] ??= {})
            : ((next.hosts ??= {})[target.id] ??= {})
      const cell = (layer[category] ??= {})
      if (value === undefined) delete cell[channel]
      else cell[channel] = value
      if (!Object.keys(cell).length) delete layer[category]
      setSettings(next)
      void setDoc(
        doc(firestore, 'users', uid),
        { [NOTIFICATION_SETTINGS_FIELD]: next },
        { merge: true },
      ).catch(console.error)
    },
    [firestore, settings, uid],
  )

  /**
   * The same write, one level finer (AGL-3251): the account's answer for a
   * single TYPE, which `undefined` clears so the row follows its category
   * again.
   *
   * Its own map on the settings document rather than a key beside the
   * categories — see {@link NotificationSettings.accountTypes} — and the same
   * whole-field write as above, so an emptied override leaves no husk behind.
   */
  const saveSettings = useCallback(
    (next: NotificationSettings) => {
      if (!uid) return
      setSettings(next)
      void setDoc(
        doc(firestore, 'users', uid),
        { [NOTIFICATION_SETTINGS_FIELD]: next },
        { merge: true },
      ).catch(console.error)
    },
    [firestore, uid],
  )

  const writeType = useCallback(
    (
      type: AglynNotificationType,
      channel: NotificationChannel,
      value: boolean,
    ) => {
      const next: NotificationSettings = JSON.parse(JSON.stringify(settings))
      const types = (next.accountTypes ??= {})
      ;(types[type] ??= {})[channel] = value
      saveSettings(next)
    },
    [saveSettings, settings],
  )

  /**
   * Put a type back on its category — every channel at once (AGL-3251).
   *
   * ⚠️ One write, NOT a clear per channel. This rebuilds the whole document
   * from the `settings` it closed over, so two clears dispatched in the same
   * tick would both read the value from before either of them and the second
   * would restore what the first removed. Caught by this page's own test,
   * which is the only place the two-call version looked wrong.
   */
  const resetType = useCallback(
    (type: AglynNotificationType) => {
      const next: NotificationSettings = JSON.parse(JSON.stringify(settings))
      delete next.accountTypes?.[type]
      saveSettings(next)
    },
    [saveSettings, settings],
  )

  /*
   * The digest key comes from the module that reads it, never spelled here
   * (`check:plugin-domain-in-core`, rule 7).
   *
   * A console page may CALL a plugin's seam and must not declare its
   * vocabulary — and a literal `crmDaily:` written as an object member is a
   * declaration. Writing it through `CRM_DAILY_DIGEST_KEY` also removes the
   * second copy of the string: the switch and the reader that answers it now
   * name the same constant, so they cannot come to disagree.
   *
   * The card is still core naming a plugin's schedule, which is the AGL-3227
   * seam — this page will render whatever digests are registered rather than
   * the two it knows about.
   */
  const toggleDigest = () => {
    if (!uid) return
    const next = { ...digestPrefs }
    next[CRM_DAILY_DIGEST_KEY] = !crmDailyDigestEnabled(digestPrefs)
    setDigestPrefs(next)
    void setDoc(
      doc(firestore, 'users', uid),
      { [DIGEST_PREFS_FIELD]: next },
      { merge: true },
    ).catch(console.error)
  }

  const toggleInsightDigest = (orgId: string) => {
    if (!uid) return
    const next = !insightDigestSubscribed(insightDigests, orgId)
    setInsightDigests({ ...insightDigests, [orgId]: next })
    void setDoc(
      doc(firestore, 'users', uid),
      { [INSIGHT_DIGESTS_FIELD]: { [orgId]: next } },
      { merge: true },
    ).catch(console.error)
  }

  /**
   * Send a test alert (AGL-650).
   *
   * Alert settings are otherwise unverifiable: you cannot tell whether the
   * chime is audible, whether the browser actually granted permission, or
   * what a desktop notification looks like on your OS, without waiting for
   * something real to happen.
   *
   * The chime always plays — previewing it is the point, and muting the
   * preview because sound is off would make the button do nothing in the
   * exact case where you want to hear it before switching it on.
   */
  const handleTestAlerts = useCallback(async () => {
    playNotificationChime()
    let current = desktopNotificationPermission()
    if (current === 'default') current = await requestDesktopNotifications()
    setPermission(current)
    if (current === 'granted') {
      // force: the tab is focused by definition when you click Test, and
      // desktop alerts are otherwise hidden-tab-only.
      showDesktopNotification({
        title: `${PLATFORM_BRAND_NAME} notifications are on`,
        body: 'This is what a notification looks like.',
        tag: 'aglyn-test',
        force: true,
      })
      setAlertPrefs({ desktop: true })
    }
    enqueueSnackbar(
      current === 'granted'
        ? 'Played the chime and sent a test notification.'
        : current === 'denied'
          ? 'Chime played. Desktop notifications are blocked for this site — re-allow them in your browser settings.'
          : current === 'unsupported'
            ? "Chime played. This browser doesn't support desktop notifications."
            : 'Chime played. Desktop notifications were not granted.',
      { variant: current === 'granted' ? 'success' : 'info', persist: false },
    )
  }, [setAlertPrefs, enqueueSnackbar])

  const handleDesktopToggle = useCallback(async () => {
    if (alertPrefs.desktop) {
      setAlertPrefs({ desktop: false })
      return
    }
    // The prompt only works from a user gesture, which is why this lives on
    // the toggle rather than firing on page load.
    let current = desktopNotificationPermission()
    if (current === 'default') current = await requestDesktopNotifications()
    setPermission(current)
    setAlertPrefs({ desktop: current === 'granted' })
  }, [alertPrefs.desktop, setAlertPrefs])

  /** The account layer's effective answer, mute map included. */
  const accountValue = (
    category: NotificationCategory,
    channel: NotificationChannel,
  ): boolean => {
    const own = notificationScopePref(
      settings,
      { kind: 'account' },
      category,
      channel,
    )
    if (typeof own === 'boolean') return own
    if (channel === 'console' && legacyPrefs[category] === false) return false
    return NOTIFICATION_CHANNEL_DEFAULTS[category][channel]
  }

  /**
   * What would actually happen for one type: its own answer if it has one,
   * otherwise its category's (AGL-3251).
   *
   * The same order `notificationChannelEnabled` resolves in at this layer —
   * type before category — so the switch a person sees and the decision the
   * fan-out makes cannot disagree.
   */
  const typeValue = (
    type: AglynNotificationType,
    channel: NotificationChannel,
  ): boolean => {
    const own = notificationAccountTypePref(settings, type, channel)
    if (typeof own === 'boolean') return own
    return accountValue(notificationCategory(type), channel)
  }

  return (
    <Stack spacing={2}>
      <CardDisplay
        header={'What you are told about'}
        help={docsHelp('consoleTour', {
          anchor: '#notification-settings',
          excerpt:
            'Choose which notifications reach the console and which ' +
            'reach your inbox. Email is off until you switch it on.',
        })}
        contentGutterX
        contentGutterY
        contentBordered="all"
      >
        <NotificationCategoryTable
          categories={categories}
          channels={CHANNELS}
          categoryValue={accountValue}
          typeValue={typeValue}
          typePref={(type, channel) =>
            notificationAccountTypePref(settings, type, channel)
          }
          onCategoryChange={(category, channel, value) =>
            write({ kind: 'account' }, category, channel, value)
          }
          onTypeChange={writeType}
          onTypeReset={resetType}
        />
      </CardDisplay>

      <CardDisplay
        header={'One workspace or one site'}
        help={docsHelp('consoleTour', {
          anchor: '#workspace-and-site-overrides',
          excerpt:
            'Answer for one workspace or one site instead of your whole ' +
            'account. Inherit follows the level above it.',
        })}
        contentGutterX
        contentGutterY
        contentBordered="all"
      >
        <Stack spacing={1.5}>
          <Typography variant="caption" color="text.secondary">
            {'Everything below starts at Inherit, which means it follows ' +
              'the answers above. A site follows its workspace, and a ' +
              'workspace follows your account.'}
          </Typography>
          <TextField
            select
            size="small"
            label="Workspace or site"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            sx={{ maxWidth: 420 }}
          >
            {scopes.map((entry) => (
              <MenuItem key={scopeValue(entry)} value={scopeValue(entry)}>
                {entry.kind === 'account'
                  ? 'Your account (the answers above)'
                  : entry.label}
              </MenuItem>
            ))}
          </TextField>
          {scope.kind === 'account' ? (
            <Typography variant="caption" color="text.secondary">
              {overridden.orgIds.length || overridden.hostIds.length
                ? `You have changed ${
                    overridden.orgIds.length + overridden.hostIds.length
                  } of these. Pick one to see what it says.`
                : 'You have not changed any of these yet.'}
            </Typography>
          ) : (
            <ScrollTable size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Category'}</TableCell>
                  {CHANNELS.map((channel) => (
                    <TableCell key={channel.key} align="center">
                      {channel.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {categories.map(([category, label]) => (
                  <TableRow key={category}>
                    <TableCell>{label}</TableCell>
                    {CHANNELS.map((channel) => {
                      const value = notificationScopePref(
                        settings,
                        scope,
                        category,
                        channel.key,
                      )
                      return (
                        <TableCell key={channel.key} align="center">
                          <ToggleButtonGroup
                            exclusive
                            size="small"
                            value={
                              value === undefined ? 'inherit' : String(value)
                            }
                            onChange={(_event, next) => {
                              // `null` is the group refusing to
                              // deselect — a re-click on the active
                              // button, which must change nothing.
                              if (next === null) return
                              write(
                                scope,
                                category,
                                channel.key,
                                next === 'inherit'
                                  ? undefined
                                  : next === 'true',
                              )
                            }}
                            aria-label={`${label} — ${channel.label}`}
                          >
                            <ToggleButton value="inherit">
                              {'Inherit'}
                            </ToggleButton>
                            <ToggleButton value="true">{'On'}</ToggleButton>
                            <ToggleButton value="false">{'Off'}</ToggleButton>
                          </ToggleButtonGroup>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </ScrollTable>
          )}
        </Stack>
      </CardDisplay>

      <CardDisplay
        header={'Digests'}
        help={docsHelp('consoleTour', {
          anchor: '#daily-digests',
          excerpt:
            'The daily CRM digest and the weekly insights: what each ' +
            'one sends, and when.',
        })}
        contentGutterX
        contentGutterY
        contentBordered="all"
      >
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}
          >
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={crmDailyDigestEnabled(digestPrefs)}
                  onChange={toggleDigest}
                />
              }
              label="Daily CRM digest"
              slotProps={{ typography: { variant: 'caption' } }}
            />
            <Typography variant="caption" color="text.secondary">
              {'Each morning: your overdue and due-today tasks and the ' +
                'leads nobody has worked, here and by email.'}
            </Typography>
          </Stack>
          {Object.keys(insightDigests).length ? (
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}
            >
              <Typography variant="caption" color="text.secondary">
                {'Weekly insights:'}
              </Typography>
              {Object.keys(insightDigests)
                .sort()
                .map((orgId) => (
                  <FormControlLabel
                    key={orgId}
                    control={
                      <Switch
                        size="small"
                        checked={insightDigestSubscribed(insightDigests, orgId)}
                        onChange={() => toggleInsightDigest(orgId)}
                      />
                    }
                    label={
                      (orgs ?? []).find((org) => org.$id === orgId)?.name ??
                      'A workspace you left'
                    }
                    slotProps={{ typography: { variant: 'caption' } }}
                  />
                ))}
              <Typography variant="caption" color="text.secondary">
                {'Each Monday: what your sites’ figures showed that week, ' +
                  'here and by email. Turned on from Ask about your numbers.'}
              </Typography>
            </Stack>
          ) : null}
        </Stack>
      </CardDisplay>

      <CardDisplay
        header={'Alerts on this device'}
        help={docsHelp('consoleTour', {
          anchor: '#alerts-on-this-device',
          excerpt:
            'The tab badge, the chime and desktop notifications are ' +
            'settings for this browser, not for your account.',
        })}
        contentGutterX
        contentGutterY
        contentBordered="all"
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}
        >
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={alertPrefs.tabBadge}
                onChange={() =>
                  setAlertPrefs({ tabBadge: !alertPrefs.tabBadge })
                }
              />
            }
            label="Unread count in tab title"
            slotProps={{ typography: { variant: 'caption' } }}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={alertPrefs.sound}
                onChange={() => setAlertPrefs({ sound: !alertPrefs.sound })}
              />
            }
            label="Sound"
            slotProps={{ typography: { variant: 'caption' } }}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={alertPrefs.desktop}
                disabled={
                  permission === 'unsupported' || permission === 'denied'
                }
                onChange={() => void handleDesktopToggle()}
              />
            }
            label="Desktop notifications"
            slotProps={{ typography: { variant: 'caption' } }}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={() => void handleTestAlerts()}
          >
            {'Send test alert'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {permission === 'denied'
              ? 'Blocked for this site — re-allow notifications in your ' +
                'browser settings to switch this on.'
              : permission === 'unsupported'
                ? 'This browser does not support desktop notifications.'
                : 'These three are settings for this browser on this ' +
                  'device, not for your account.'}
          </Typography>
        </Stack>
      </CardDisplay>
    </Stack>
  )
}
ManageNotificationSettings.displayName = 'Page:ManageNotificationSettings'

export default ManageNotificationSettings
