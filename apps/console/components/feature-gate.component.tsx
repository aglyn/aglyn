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
import { Alert, AlertTitle, Box, CircularProgress } from '@mui/material'
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
 *
 * Customers get the notice only once the flags have actually ANSWERED — until
 * then this holds (AGL-243 residual). Staff are exempt from the hold because
 * their bypass does not depend on the answer. See the comment on `ready`
 * below.
 */
export function FeatureGate(props: FeatureGateProps) {
  const { flag, children } = props
  const { visible, staffPreview, ready, isStaff } = useReleaseFlag(flag)
  const definition = getReleaseFlagDefinition(flag)

  // HOLD UNTIL THE FLAGS ANSWER (AGL-243 residual). `ready` is Remote Config's
  // `activated`, and it is false on the first paint of every session — the
  // fetch is a network round trip. This component destructured `{ visible,
  // staffPreview }` and dropped it, and `visible` is `released || isStaff`
  // with `released` defaulting FALSE before activation. So a customer whose
  // flag is genuinely ON was told the feature "isn't available on your
  // workspace yet" and then watched it appear. On the marketplace hub and the
  // org Data page that notice is the whole page. It is the fail-CLOSED mirror
  // of the permission gate's fail-open: a loading default answering a question
  // it has not resolved.
  //
  // `&& !isStaff` is the whole subtlety. Staff pass on the bypass, which is
  // known from the token and does not depend on activation at all — for them
  // there is no unresolved question to hold on, and holding anyway would only
  // spin. It would also break AGL-1662's deliberate case, where a staff
  // previewer must reach the page body during the activation window precisely
  // so the route can hand the plugin `released: false` rather than `visible`.
  if (!ready && !isStaff) {
    return (
      <Box sx={{ p: 2 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

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
      {/* `staffPreview` is `isStaff && !released`, and `released` reads false
          before activation — so this banner claimed "hidden from customers by
          release flag" on the first paint of every staff session, for flags
          that are fully released. `ready &&` makes it a statement about the
          flag rather than about the fetch. */}
      {ready && staffPreview ? (
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
