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

import { Chip, ChipRow, Text } from '@aglyn/mobile-ui'
import { View } from 'react-native'
import { titleCase } from '../shared/format'
import { SITE_ROLE_HINTS, SITE_ROLE_OPTIONS, type SiteRole } from './team-api'

export interface SiteAccessDraft {
  allHosts: boolean
  hostAccess: Record<string, SiteRole>
}

const SITE_ROLE_CHIPS = SITE_ROLE_OPTIONS.map((value) => ({
  value,
  label: value === 'none' ? 'None' : titleCase(value),
}))

/**
 * All sites, or a role on each named site: the console's Site access
 * dialog, over the workspace's sites the reader can see.
 */
export function SiteAccessPicker({
  value,
  onChange,
  sites,
  roleLabel,
}: {
  value: SiteAccessDraft
  onChange: (next: SiteAccessDraft) => void
  sites: ReadonlyArray<{ id: string; name: string }>
  /** The org role, for "All sites (as editor)". */
  roleLabel: string
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
        <Chip
          testID="access-all-sites"
          icon={value.allHosts ? 'checkmark' : undefined}
          label={`All sites (as ${roleLabel})`}
          selected={value.allHosts}
          onPress={() => onChange({ ...value, allHosts: !value.allHosts })}
        />
      </View>
      {value.allHosts
        ? null
        : sites.map((site) => {
            const current = value.hostAccess[site.id] ?? 'none'
            return (
              <View key={site.id} style={{ gap: 2 }}>
                <Text style={{ paddingHorizontal: 16 }}>{site.name}</Text>
                <ChipRow
                  testID={`access-${site.id}`}
                  options={SITE_ROLE_CHIPS}
                  value={current}
                  onChange={(next) => {
                    const hostAccess = { ...value.hostAccess }
                    if (next === 'none') delete hostAccess[site.id]
                    else hostAccess[site.id] = next as SiteRole
                    onChange({ ...value, hostAccess })
                  }}
                />
                <Text variant="caption" tone="secondary" style={{ paddingHorizontal: 16 }}>
                  {SITE_ROLE_HINTS[current]}
                </Text>
              </View>
            )
          })}
    </View>
  )
}
