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
import { useEffect, useState } from 'react'
import {
  type PreviewKind,
  type PreviewStateIds,
  previewStateKey,
  readPreviewState,
} from '../constants/preview-state'

const SUPPRESSED_SCREEN_LINKS = { suppressNavigation: true }

const KIND_LABEL: Record<PreviewKind, string> = {
  screen: 'screen',
  component: 'component',
  layout: 'layout',
  template: 'template',
}

export interface DocumentPreviewProps {
  ids?: PreviewStateIds | null
}

/**
 * Renders a besigner draft snapshot the way the live site would (AGL-1203).
 *
 * One surface for all four document kinds. Screens were the only kind with a
 * preview route; components, layouts and templates showed a Preview button
 * that did nothing. They render through the SAME renderer, theme, hidden-class
 * rule and site runtimes, so a mega-menu authored in a reusable component
 * opens on hover in its own preview exactly as it does on a screen.
 *
 * Snapshots travel through `localStorage`, so this works on localhost with no
 * deployment — the previous "preview" for a screen row opened a Vercel URL,
 * which 404s for anything not yet deployed.
 */
export function DocumentPreview(props: DocumentPreviewProps) {
  const { ids } = props
  const firestore = useFirestore()
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

  const hostId = ids?.hostId
  const kind = ids?.kind
  const docId = ids?.docId
  const versionId = ids?.versionId

  useEffect(() => {
    if (!hostId || !kind || !docId) return
    const resolved: PreviewStateIds = { hostId, kind, docId, versionId }

    const applyState = () => {
      const state = readPreviewState(resolved)
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
      if (event.key === previewStateKey(resolved)) applyState()
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [hostId, kind, docId, versionId])

  // Interactions parity (AGL-830): mount the registered site runtimes exactly
  // like the tenant page, each fed the page-props slice it rebuilds
  // client-side. Actions are host-scoped and delegated at the document level,
  // so this loads once — a fresh node snapshot re-renders the DOM but the
  // armed listeners still match.
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
          {`Open this ${KIND_LABEL[kind ?? 'screen']} in the besigner and click Preview again.`}
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
              hostId={hostId as string}
              page={runtimePages[index] ?? {}}
            />
          ))
        : null}
    </ThemeProvider>
  )
}

export default observer(DocumentPreview)
