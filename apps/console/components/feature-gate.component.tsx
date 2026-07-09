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

import { getReleaseFlagDefinition, type ReleaseFlagKey } from '@aglyn/aglyn'
import { Alert, AlertTitle } from '@mui/material'
import { useReleaseFlag } from '../hooks/use-release-flags'

export interface FeatureGateProps {
  flag: ReleaseFlagKey
  children?: JSX.Children
}

/**
 * Page-level release gate (AGL-229), mounted inside the page's own
 * `<Container>`. Customers with the flag off get a coming-soon notice —
 * deep links leak nothing. Staff always pass, but a flagged-off feature
 * carries a warning banner so nobody mistakes an unreleased surface for a
 * launched one.
 */
export function FeatureGate(props: FeatureGateProps) {
  const { flag, children } = props
  const { visible, staffPreview } = useReleaseFlag(flag)
  const definition = getReleaseFlagDefinition(flag)

  if (!visible) {
    return (
      <Alert severity="info">
        <AlertTitle>{`${definition.label} is coming soon`}</AlertTitle>
        {
          "This feature isn't available on your workspace yet. It will appear here automatically once it's released."
        }
      </Alert>
    )
  }

  return (
    <>
      {staffPreview ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>{'Release-flagged feature'}</AlertTitle>
          {`${definition.label} is hidden from customers by release flag `}
          <code>{definition.key}</code>
          {' — you can see it because you are staff. Manage it under Staff → Feature flags.'}
        </Alert>
      ) : null}
      {children}
    </>
  )
}
FeatureGate.displayName = 'FeatureGate'
FeatureGate.aglyn = true

export default FeatureGate
