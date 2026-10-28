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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { isHostInPreview } from '@aglyn/aglyn/app-utils/site-preview'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useUser } from '../hooks/firebase/firebase-services'
import { useFirestoreDoc } from '../hooks/use-firestore-doc'

/**
 * The site's Preview switch (AGL-4086), as a hook and as the switch itself,
 * so every place that offers it — Admin → Error pages, the console's "in
 * preview" banner, the Bring my site review — flips it the same way.
 *
 * It never writes the host document itself. `/api/hosts/preview` does: making
 * a site public is a launch, so the door checks the person is a site admin,
 * drops every cached page and reports the first publish, and the rules keep
 * the field away from the client SDK.
 */

/** What a flip came to. */
export interface SitePreviewOutcome {
  /** The state the site is in now. */
  preview: boolean
  /** Whether every cached page was dropped with it. */
  dropped: boolean
  /** Why it did not change, when it did not. */
  error?: string
}

/** Ask the door to put the site in preview, or make it public. */
export async function requestSitePreview(
  user: Parameters<typeof authorizedFetch>[0],
  hostId: string,
  preview: boolean,
): Promise<SitePreviewOutcome> {
  try {
    const response = await authorizedFetch(user, '/api/hosts/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, preview }),
    })
    const payload = (await response.json().catch(() => null)) as
      | { preview?: boolean; dropped?: boolean; error?: string }
      | null
    if (!response.ok) {
      return {
        preview: !preview,
        dropped: false,
        error: String(payload?.error ?? 'The site could not be changed'),
      }
    }
    return { preview: payload?.preview === true, dropped: payload?.dropped === true }
  } catch {
    return { preview: !preview, dropped: false, error: 'The site could not be changed' }
  }
}

/**
 * The link that opens a site in preview on its own address (AGL-4086): a
 * two-minute enter link the console mints for the site's team, which plants
 * the preview cookie on that host and lands on `path`. `null` when it could
 * not be minted.
 */
export async function requestSitePreviewLink(
  user: Parameters<typeof authorizedFetch>[0],
  hostId: string,
  path = '/',
): Promise<string | null> {
  try {
    const response = await authorizedFetch(user, '/api/site-preview/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, path }),
    })
    if (!response.ok) return null
    const payload = (await response.json().catch(() => null)) as { url?: unknown } | null
    return typeof payload?.url === 'string' ? payload.url : null
  } catch {
    return null
  }
}

/**
 * Open a site in preview in a new tab, entering it through the minted link.
 *
 * The tab is opened FIRST, inside the click, and pointed at the link once it
 * arrives: a tab opened after an await is a popup a browser blocks. When the
 * link cannot be minted the tab goes to `fallbackHref`, the site's ordinary
 * address, where the public answer is what anyone gets.
 */
export async function openSitePreview(
  user: Parameters<typeof authorizedFetch>[0],
  hostId: string,
  fallbackHref: string,
  path = '/',
): Promise<void> {
  const tab = typeof window === 'undefined' ? null : window.open('', '_blank')
  const url = (await requestSitePreviewLink(user, hostId, path)) ?? fallbackHref
  if (!tab) {
    if (typeof window !== 'undefined') window.location.assign(url)
    return
  }
  // Severed before it navigates, as `rel="noopener"` would have.
  tab.opener = null
  tab.location.href = url
}

/**
 * The site's preview state, live, and the setter. `inPreview` is `null` while
 * the host document loads, so a caller can hold its control rather than show
 * a state it has not read.
 */
export function useSitePreviewSwitch(hostId: string | null | undefined): {
  inPreview: boolean | null
  busy: boolean
  setPreview: (preview: boolean) => Promise<SitePreviewOutcome>
} {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { data: host, status } = useFirestoreDoc<{ preview?: boolean }>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
  )
  const [busy, setBusy] = useState(false)
  const setPreview = useCallback(
    async (preview: boolean): Promise<SitePreviewOutcome> => {
      if (!hostId) return { preview: !preview, dropped: false, error: 'No site' }
      setBusy(true)
      try {
        return await requestSitePreview(user, hostId, preview)
      } finally {
        setBusy(false)
      }
    },
    [hostId, user],
  )
  return {
    inPreview: status === 'success' ? isHostInPreview(host) : null,
    busy,
    setPreview,
  }
}

export interface SitePreviewSwitchProps {
  hostId: string
  /**
   * The site's state as the caller reads it, `null` while it loads. Handed
   * in rather than read here, so the switch draws whatever host document the
   * page already holds and opens no second listener on it.
   */
  inPreview: boolean | null
  /** The signed-in user, whose ID token the door checks. */
  user: Parameters<typeof authorizedFetch>[0]
  /**
   * Shown off with the reason, never hidden, when the person cannot flip it
   * — the same rule every console prerequisite follows.
   */
  disabledReason?: string | null
  /** Told how each flip came out, for the caller's snackbar. */
  onChanged?: (outcome: SitePreviewOutcome, asked: boolean) => void
}

/** The words of the switch, shared with the native screen and the docs. */
export const SITE_PREVIEW_SWITCH_LABEL =
  'Preview — only you and your team can see the site'

export const SITE_PREVIEW_SWITCH_HELP =
  'Visitors see your 503 page, or "Coming soon", until you make the site public. ' +
  `You, your team and ${PLATFORM_BRAND_NAME} support see the whole site.`

/** The switch, as Admin → Error pages draws it. */
export function SitePreviewSwitch(props: SitePreviewSwitchProps) {
  const { hostId, inPreview, user, disabledReason, onChanged } = props
  const [busy, setBusy] = useState(false)
  // What the person just asked for, shown until the host document catches up.
  const [asked, setAsked] = useState<boolean | null>(null)
  // Let go of it once the document agrees, so a later change from elsewhere
  // shows through.
  useEffect(() => {
    if (asked !== null && inPreview === asked) setAsked(null)
  }, [asked, inPreview])
  const checked = asked ?? inPreview === true
  const disabled = Boolean(disabledReason) || busy || inPreview === null
  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        control={
          <Switch
            color="primary"
            checked={checked}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.checked
              setAsked(next)
              setBusy(true)
              void requestSitePreview(user, hostId, next).then((outcome) => {
                setBusy(false)
                setAsked(outcome.error ? null : outcome.preview)
                onChanged?.(outcome, next)
              })
            }}
          />
        }
        label={SITE_PREVIEW_SWITCH_LABEL}
      />
      <Typography variant="caption" color="text.secondary">
        {disabledReason || SITE_PREVIEW_SWITCH_HELP}
      </Typography>
    </Stack>
  )
}
SitePreviewSwitch.displayName = 'SitePreviewSwitch'

export default SitePreviewSwitch
