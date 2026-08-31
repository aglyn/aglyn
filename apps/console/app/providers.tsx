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
import VisitorConsent from '../components/visitor-consent.component'
import PlatformAdvertisingTags from '../components/advertising-tags.component'
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
const ThemeStack = withThemeCssVarProvider(
  ({ children }: { children?: ReactNode }) => (
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
      {/* The visitor-consent banner and the privacy-choices panel (AGL-1498
          posture, applied to the console itself).

          OUTSIDE `LoadingLayoutAppComponent` on purpose, beside the two
          effects above: the banner has to reach a visitor who is not signed
          in and never will be — `/signin` is this surface's most-collected
          page — and it must not wait on an auth gate to say so. It needs no
          Firebase context of its own, only the MUI theme, which this whole
          subtree already has.

          Renders nothing at all for a visitor whose posture is implied
          consent and who has not opened the panel; the enforcement it
          describes lives in the Firebase services provider and holds whether
          or not this ever mounts. */}
      <VisitorConsent />
      {/* The console's consent-gated advertising tags (Meta, Google Ads,
          LinkedIn, and a Google Tag Manager container).

          Beside `VisitorConsent` and for the same reason: the advertising
          grant belongs to a visitor who may never sign in, and `/signin` is
          this surface's most-collected page — so the mount must not sit behind
          the auth gate. It needs no Firebase context of its own.

          It renders nothing at all until the visitor's record is resolved, and
          nothing ever unless that record grants the category. The enforcement
          is structural: an ungranted visitor gets no `<Script>`, so no request
          reaches a vendor — not loaded and then suppressed. */}
      <PlatformAdvertisingTags />
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

export default function Providers({ children }: { children?: ReactNode }) {
  return <ThemeStack>{children}</ThemeStack>
}
