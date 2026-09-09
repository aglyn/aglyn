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

import Button from '@mui/material/Button'
import SiteStatusScreen from './site-status-screen.component'

export interface SiteErrorScreenProps {
  /** Re-runs the render that threw; supplied by the Next error boundary. */
  onReset: () => void
}

/**
 * The BODY of the tenant's branded 500, split out of `[host]/error.tsx`.
 *
 * A file of its own so the boundary can reach it through `next/dynamic`. A
 * Next error boundary is a client reference in the page's flight payload, so
 * every module it imports statically is downloaded by every visitor to every
 * published site — and this one imports the status screen, which reaches
 * `AppLink`'s five MUI variants and the whole `TextField`/`Select` cluster
 * behind the 404's search box. That is first-paint weight on the metered page
 * for markup that renders only when a render has already failed.
 *
 * Nothing is lost by deferring it: React 19.2 runs no error boundary during
 * streaming SSR, so this markup never appears in served HTML — the boundary
 * renders on the client, where one more chunk request is already the cheapest
 * thing happening.
 */
export default function SiteErrorScreen({ onReset }: SiteErrorScreenProps) {
  return (
    <SiteStatusScreen
      code="500"
      title={'Something went wrong'}
      message={
        'This page didn’t load properly. Trying again often fixes it — if it ' +
        'doesn’t, the rest of the site is still available.'
      }
      action={
        <Button variant="outlined" onClick={onReset}>
          {'Try again'}
        </Button>
      }
    />
  )
}
