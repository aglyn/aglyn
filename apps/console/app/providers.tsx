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

import { ConfirmationProviderComponent } from '@aglyn/shared-ui-jsx/components/confirmation-provider.component'
import { LoadingLayoutAppComponent } from '@aglyn/shared-ui-jsx/components/loading-layout-app.component'
import { SnackbarProvider } from '@aglyn/shared-ui-snackstack'
import {
  consoleThemeDark,
  consoleThemeLight,
  withThemeCssVarProvider,
} from '@aglyn/shared-ui-theme'
import type { ReactNode } from 'react'
import ConsoleBrandingEffects from '../components/console-branding-effects.component'
import EditHintBounce from '../components/edit-hint-bounce.component'
import EditorHintCookie from '../components/editor-hint-cookie.component'
import HostIdProvider from '../components/host-id-provider'
import VisitorMarketingSurface from '../components/visitor-marketing-surface.component'
import FirebaseAppLayout from '../components/layouts/firebase-app.layout'
// Dynamic plugin activation (AGL-417): the gate loads + registers the org's
// enabled plugins (ConsoleExtension registry) before the shell renders —
// replacing the static register-console-plugins composition root.
import ConsolePluginsGate from '../components/console-plugins-gate.component'

/**
 * The console's global client providers (App Router), ported from the Pages
 * Router `_app` `MainComponent`: MUI theme via `withThemeCssVarProvider`
 * (emotion SSR is handled by the root layout's `AppRouterCacheProvider`),
 * then firebase init, loading gate, confirmation dialogs, snackbars, and the
 * host-id context. Wraps every app route under the root layout.
 */
/** The props the root layout hands the client stack. */
interface ProvidersProps {
  children?: ReactNode
  /**
   * The request's CSP nonce, read by the root layout from the header the
   * middleware set. Threaded to the advertising mount and nowhere else: it is
   * the one place this stack renders an inline script of its own after
   * hydration, which is the one shape Next's automatic nonce never reaches.
   */
  nonce?: string
}

const ThemeStack = withThemeCssVarProvider(
  ({ children, nonce }: ProvidersProps) => (
    <FirebaseAppLayout>
      {/* White-label chrome effects (White-Label Phase 2): favicon + MUI
          primary color for a white-label-entitled org. Inside FirebaseAppLayout
          so the org scope + Firestore contexts it reads are available. */}
      <ConsoleBrandingEffects />
      {/* Editor-presence hint for the tenant admin bar (AGL-1829): keeps the
          registrable-domain `aglyn_editor` cookie in step with the session.
          Inside FirebaseAppLayout for the auth context; renders nothing. */}
      <EditorHintCookie />
      {/* The `*.aglyn.app` half of that hint (AGL-1842): a throttled
          login-time top-level bounce through the tenant app plants the hint
          on the OTHER registrable domain, where cookies set here cannot
          reach. Renders nothing. */}
      <EditHintBounce />
      <VisitorMarketingSurface nonce={nonce} />
      <LoadingLayoutAppComponent>
        <ConfirmationProviderComponent>
          <SnackbarProvider>
            <HostIdProvider>
              <ConsolePluginsGate>{children}</ConsolePluginsGate>
            </HostIdProvider>
          </SnackbarProvider>
        </ConfirmationProviderComponent>
      </LoadingLayoutAppComponent>
    </FirebaseAppLayout>
  ),
  { theme: { light: consoleThemeLight, dark: consoleThemeDark } },
)

export default function Providers({ children, nonce }: ProvidersProps) {
  return <ThemeStack nonce={nonce}>{children}</ThemeStack>
}
