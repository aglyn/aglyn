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

import { SplashScreenContent } from '@aglyn/shared-ui-jsx/components/splash-screen'
import { Box } from '@mui/material'

/**
 * What the browser paints while the console boots (AGL-896).
 *
 * Everything below `FirebaseAppLayout` is wrapped in `NoSsr`, so the server
 * used to emit an EMPTY body and the first client render produced nothing
 * either — the whole shell only appeared once the bundle had downloaded,
 * parsed and hydrated. On a cold load or a full page navigation (switching
 * workspaces, a pasted deep link) that is 5–15s of pure blank screen with no
 * logo, no spinner, nothing: indistinguishable from a broken app.
 *
 * This is that missing first frame. It is deliberately NOT `SplashScreen` —
 * that one is a `Modal`, i.e. a portal, which renders nothing server-side and
 * nothing pre-mount, which is exactly the hole being plugged. Same artwork,
 * plain positioned Box, so it lands in the SSR HTML.
 */
export function BootSplash() {
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 'max',
        color: 'text.primary',
        bgcolor: 'background.paper',
      }}
    >
      <SplashScreenContent />
    </Box>
  )
}
BootSplash.displayName = 'BootSplash'
BootSplash.aglyn = true

export default BootSplash
