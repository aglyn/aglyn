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

/**
 * The Redirects card on the dashboard (AGL-3620): how many rules the site
 * serves, and how many are switched off.
 */

import type { MobileWidgetProps } from '@aglyn/mobile-plugin-host'
import { Button, Skeleton, Text } from '@aglyn/mobile-ui'
import { REDIRECTS_LIST_SCREEN } from './screen-ids'
import { useHostRedirects } from './use-host-redirects'

export default function RedirectsSummaryWidget({ context }: MobileWidgetProps) {
  const { rows, ready, error } = useHostRedirects(context.firestore, context.hostId)
  if (!ready) return <Skeleton height={36} />
  if (error) return <Text tone="secondary">Could not load redirects.</Text>
  const off = rows.filter((row) => row.enabled === false).length
  return (
    <>
      <Text variant="title" testID="redirects-summary-count">
        {rows.length - off}
      </Text>
      <Text tone="secondary">
        {rows.length - off === 1 ? 'redirect is on' : 'redirects are on'}
        {off ? ` · ${off} off` : ''}
      </Text>
      <Button title="View" variant="text" onPress={() => context.navigate(REDIRECTS_LIST_SCREEN)} />
    </>
  )
}
