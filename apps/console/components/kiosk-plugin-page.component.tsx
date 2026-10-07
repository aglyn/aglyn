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
  normalizeConsolePublicPath,
  resolveConsolePublicPage,
  type ConsolePublicPageEntry,
} from '@aglyn/aglyn'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { notFound } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { consolePluginLoader } from '../constants/console-plugin-loader'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'
import { useDeclareDocumentSubject } from './document-subject'

/**
 * Whether the first-party manifest says `pluginId` serves `path` publicly
 * (AGL-3608).
 *
 * Asked BEFORE anything loads, from the generated manifest's
 * `contributes.console.publicRoutes`, so an anonymous visitor typing
 * `/kiosk/{any plugin}/{anything}` fetches no plugin bundle at all — a
 * plugin's code reaches this route only for a page it declared.
 */
export function kioskRouteDeclared(pluginId: string, path: string): boolean {
  const entry = CONSOLE_PLUGIN_MANIFEST.find((candidate) => candidate.id === pluginId)
  if (!entry?.register['console']) return false
  const wanted = normalizeConsolePublicPath(path)
  return (entry.contributes?.console?.publicRoutes ?? []).some(
    (route) => normalizeConsolePublicPath(route) === wanted,
  )
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; page: ConsolePublicPageEntry }
  | { kind: 'missing' }

/**
 * The console's generic public route (AGL-3608): one plugin's
 * `ConsolePublicPage`, full screen, with the console's theme and nothing of
 * the workspace shell.
 *
 * Loads ONLY the named plugin's console bundle — not the workspace's plugin
 * set, which a device with no session has none of — and only when the
 * manifest declares the path. A path the plugin does not register, once
 * loaded, is a 404 like any other unknown address.
 */
export function KioskPluginPage({ pluginId, path }: { pluginId: string; path: string }) {
  const declared = kioskRouteDeclared(pluginId, path)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  useEffect(() => {
    if (!declared) return undefined
    let active = true
    setPhase({ kind: 'loading' })
    consolePluginLoader
      .ensure([pluginId], ['console'])
      .then(() => {
        if (!active) return
        const page = resolveConsolePublicPage(pluginId, path)
        setPhase(page ? { kind: 'ready', page } : { kind: 'missing' })
      })
      .catch((error: unknown) => {
        console.error('[kiosk] plugin failed to load', pluginId, error)
        if (active) setPhase({ kind: 'missing' })
      })
    return () => {
      active = false
    }
  }, [declared, pluginId, path])

  const page = phase.kind === 'ready' ? phase.page : undefined
  useDeclareDocumentSubject(path, page?.title)

  if (!declared || phase.kind === 'missing') notFound()

  if (!page) {
    return (
      <Box
        sx={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress aria-label="Loading" />
      </Box>
    )
  }

  const { Component } = page
  return (
    <Box
      component="main"
      sx={{ minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}
    >
      <Suspense fallback={null}>
        <Component pluginId={pluginId} path={page.path} />
      </Suspense>
    </Box>
  )
}

KioskPluginPage.displayName = 'KioskPluginPage'

export default KioskPluginPage
