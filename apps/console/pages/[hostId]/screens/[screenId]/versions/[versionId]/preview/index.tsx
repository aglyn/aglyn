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

import * as Aglyn from '@aglyn/aglyn'
import { AglynNodeRenderer, useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import { registerLegacyMuiPlugin } from '@aglyn/plugins-ui-mui'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import {
  getGoogleFontsUrl,
  ThemeProvider,
  useThemeModeState,
} from '@aglyn/shared-ui-theme'
import { CssBaseline, Stack, Typography } from '@mui/material'
import Head from 'next/head'
import { observer } from 'mobx-react-lite'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import '../../../../../../../constants/app-setup'
import {
  previewStateKey,
  readPreviewState,
} from '../../../../../../../constants/preview-state'

registerLegacyMuiPlugin()

const SUPPRESSED_SCREEN_LINKS = { suppressNavigation: true }

function ScreenPreviewPage() {
  const params = useParams<{
    hostId: string
    screenId: string
    versionId: string
  }>()
  const hostId = params?.hostId as string
  const screenId = params?.screenId as string
  const versionId = params?.versionId as string
  const [missing, setMissing] = useState(false)
  const [hostTheme, setHostTheme] = useState<Aglyn.AglynHostTheme | undefined>(
    undefined,
  )

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
        <Head>
          <link
            key="host-fonts-preconnect"
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link key="host-fonts" rel="stylesheet" href={fontsHref} />
        </Head>
      ) : null}
      <CssBaseline enableColorScheme />
      <NextPageTitle screen={'Screen Preview'} />
      {root ? (
        // Preview renders draft state outside the tenant site: screen links
        // show their content but must not navigate the console origin.
        <Aglyn.ScreenLinkContext.Provider value={SUPPRESSED_SCREEN_LINKS}>
          <AglynNodeRenderer node={root} />
        </Aglyn.ScreenLinkContext.Provider>
      ) : null}
    </ThemeProvider>
  )
}

export default observer(ScreenPreviewPage)
