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

import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { Card } from '@mui/material'

/**
 * The Sequences section (AGL-2974).
 *
 * An empty state and nothing else: no list is read because none can exist
 * yet, and there is no create button because nothing could answer one. A
 * control that does nothing, or a sentence describing what a sequence will
 * do, would promise behavior the product does not have.
 */
export function OutreachSequencesSection() {
  return (
    <Card variant="outlined">
      <EmptyStateComponent label="No sequences yet" />
    </Card>
  )
}
OutreachSequencesSection.displayName = 'OutreachSequencesSection'

export default OutreachSequencesSection
