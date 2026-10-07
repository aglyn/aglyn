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

import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { Button, EmptyState } from '@aglyn/mobile-ui'
import { crmSuiteLockedCopy } from './crm-mobile-scope'

/** The CRM on a plan without it: the console's upgrade notice, with its way to the plans. */
export function CrmSuiteLocked({ context }: { context: Pick<MobilePluginContext, 'openConsolePath'> }) {
  const copy = crmSuiteLockedCopy()
  return (
    <EmptyState
      icon="lock-closed-outline"
      title={copy.title}
      body={copy.body}
      action={<Button title="View plans" variant="outlined" onPress={() => context.openConsolePath('/billing', 'org')} />}
    />
  )
}
