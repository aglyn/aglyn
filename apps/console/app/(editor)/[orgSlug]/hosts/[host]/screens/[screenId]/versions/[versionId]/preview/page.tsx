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

import * as Aglyn from '@aglyn/aglyn'
import { AglynNodeRenderer, useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import {
  getGoogleFontsUrl,
  ThemeProvider,
  useThemeModeState,
} from '@aglyn/shared-ui-theme'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { CssBaseline, Stack, Typography } from '@mui/material'
import { observer } from 'mobx-react-lite'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import '../../../../../../../../../../constants/app-setup'
// Dynamic site-plugin activation (AGL-417): canvas components register
// via the org-gated loader; the page gates the canvas on readiness.
import { withSitePlugins } from '../../../../../../../../../../components/console-plugins-gate.component'
import { useHostId } from '../../../../../../../../../../components/host-id-provider'
import {
  previewStateKey,
  readPreviewState,
} from '../../../../../../../../../../constants/preview-state'

const SUPPRESSED_SCREEN_LINKS = { suppressNavigation: true }

function ScreenPreviewPage() {
  const params = useParams<{
    hostId: string
    screenId: string
    versionId: string
  }>()
  const hostId = useHostId()
  const firestore = useFirestore()
  const screenId = params?.screenId as string
  const versionId = params?.versionId as string
  const [missing, setMissing] = useState(false)
  const [hostTheme, setHostTheme] = useState<Aglyn.AglynHostTheme | undefined>(
    undefined,
  )
  // Per-runtime page-props slices for the mounted site runtimes (AGL-830).
  // Preview has no server enricher, so each runtime rebuilds its own slice
  // client-side (e.g. marketing compiles the host's interactions), letting the
  // SAME runtimes the tenant uses drive hover menus/drawers in preview.
  const [runtimePages, setRuntimePages] = useState<
    Record<string, unknown>[] | null
  >(null)

  useEffect(() => {
    if (!hostId || !screenId || !versionId) return
    const ids = { hostId, screenId, versionId }

    const applyState = () => {
      const state = readPreviewState(ids)
      if (!state) {
        setMissing(true)
        return
      }
      setMissing(false)
      setHostTheme(state.theme)
      Aglyn.canvas.setNodes(Aglyn.canvas.processNodesToDenormalized(state.nodes))
    }
    applyState()

    // Re-apply when the besigner tab writes a fresh snapshot, so an already
    // open preview tab reflects the latest Preview click immediately.
    const handleStorage = (event: StorageEvent) => {
      if (event.key === previewStateKey(ids)) applyState()
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [hostId, screenId, versionId])

  // Interactions parity (AGL-830): mount the registered site runtimes exactly
  // like the tenant page, each fed the page-props slice it rebuilds client-side.
  // Site plugins are already registered by the withSitePlugins gate, so
  // listSiteRuntimes() is populated by the time this runs. Actions are
  // host-scoped and delegated at the document level, so this loads once — a
  // fresh node snapshot re-renders the DOM but the armed listeners still match.
  useEffect(() => {
    if (!hostId || !firestore) return
    let cancelled = false
    const runtimes = Aglyn.listSiteRuntimes()
    Promise.all(
      runtimes.map((runtime) =>
        runtime.loadPreviewProps
          ? runtime.loadPreviewProps({ hostId, firestore }).catch(() => ({}))
          : Promise.resolve({}),
      ),
    ).then((pages) => {
      if (!cancelled) setRuntimePages(pages)
    })
    return () => {
      cancelled = true
    }
  }, [hostId, firestore])

  const root = Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)
  // Style like the live site: the snapshot carries the host theme, and the
  // scheme resolves from the shared cookie + prefers-color-scheme state so
  // the preview goes dark exactly when the tenant site would.
  const [[, themeMode]] = useThemeModeState()
  const scheme = themeMode === 'dark' ? 'dark' : 'light'
  const siteTheme = useAglynSiteTheme({ theme: hostTheme, scheme })
  const fontsHref = getGoogleFontsUrl(hostTheme?.fonts)

  if (missing) {
    return (
      <Stack
        sx={{
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: 1,
        }}
      >
        <Typography variant="h6">{'No preview state found'}</Typography>
        <Typography color="text.secondary">
          {'Open this screen in the besigner and click Preview again.'}
        </Typography>
      </Stack>
    )
  }

  return (
    <ThemeProvider theme={siteTheme}>
      {fontsHref ? (
        <>
          <link
            key="host-fonts-preconnect"
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link key="host-fonts" rel="stylesheet" href={fontsHref} />
        </>
      ) : null}
      <CssBaseline enableColorScheme />
      {/* Shared hidden-class rule (AGL-562/830): the tenant page ships this in
          its SSR HTML so author-hidden elements (a mega-menu panel carries the
          class to start closed) paint hidden from the first frame. Preview
          renders the same nodes, so it ships the same rule — without it the
          panel is stuck open. */}
      <style>{Aglyn.ELEMENT_HIDDEN_STYLE_TEXT}</style>
      {root ? (
        // Preview renders draft state outside the tenant site: screen links
        // show their content but must not navigate the console origin.
        // suppressNavigation only — NOT editorInert — so interactions run for
        // real and hover-to-open menus behave like the live site (AGL-830).
        <Aglyn.ScreenLinkContext.Provider value={SUPPRESSED_SCREEN_LINKS}>
          <AglynNodeRenderer node={root} />
        </Aglyn.ScreenLinkContext.Provider>
      ) : null}
      {/* Site runtimes (AGL-419/830): the marketing automations engine arms
          the authored hover/click triggers and drives the menu/drawer command
          buses — the same components the tenant catch-all mounts. */}
      {runtimePages
        ? Aglyn.listSiteRuntimes().map((runtime, index) => (
            <runtime.Component
              key={runtime.runtimeId}
              hostId={hostId}
              page={runtimePages[index] ?? {}}
            />
          ))
        : null}
    </ThemeProvider>
  )
}

export default withSitePlugins(observer(ScreenPreviewPage))
