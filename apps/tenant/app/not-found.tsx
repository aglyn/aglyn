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

import StatusScreenPlain from '@aglyn/shared-ui-jsx/components/status-screen-plain.component'

/**
 * Root not-found boundary (AGL-2074).
 *
 * Almost every tenant request is rewritten into `[host]/…` by the middleware
 * and lands on the branded `[host]/not-found.tsx` instead — this catches the
 * remainder: a path the middleware matcher excluded that matches no route,
 * and a `notFound()` thrown before any host segment is entered.
 *
 * Deliberately the PLAIN screen. There is no resolved host at this level, so
 * there is no theme, no logo and no name to render, and inventing one is the
 * white-label defect described in `site-status-screen.component.tsx`. Being
 * unstyled by our theme is fine; being branded as somebody else is not.
 */
export default function RootNotFound() {
  return (
    <StatusScreenPlain
      code="404"
      title={'We can’t find that page'}
      message={
        'The link may be out of date, or the page may have been moved or ' +
        'removed.'
      }
    />
  )
}
