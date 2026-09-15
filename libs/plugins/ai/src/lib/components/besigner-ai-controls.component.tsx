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

import { FEATURE_FLAG, FieldComponentType, type NodeSchema } from '@aglyn/aglyn'
import { mdiAutoFix } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Button, FormControl, IconButton, Tooltip } from '@mui/material'
import { useContext } from 'react'
import { AiAssistActionsContext } from './ai-assist-actions-context'

/**
 * Whether the copy assistant can rewrite an element (AGL-89, AGL-130): a
 * text-editable element, or one declaring a text attribute — alt text, a
 * label — the rewrite dialog lets the reader pick.
 */
export function nodeTakesCopyRewrite(node: NodeSchema<any> | null | undefined): boolean {
  const schema = node?.componentSchema
  const textEditable =
    ((schema?.flags?.textEditable ?? FEATURE_FLAG.DISABLED) & FEATURE_FLAG.ENABLED) !== 0
  const hasTextAttributes = (schema?.attributes ?? []).some(
    (field: { component?: unknown }) =>
      field.component === FieldComponentType.TEXT_FIELD ||
      field.component === FieldComponentType.TEXTAREA,
  )
  return textEditable || hasTextAttributes
}

/**
 * Generate a section (AGL-169), on the besigner toolbar through the
 * `besignerToolbar` zone: opens the provider's prompt dialog, and the
 * proposed subtree lands at the end of the canvas root. Not drawn while the
 * reader's permission refuses the door.
 */
export function AiGenerateSectionControl() {
  const { onGenerateSection } = useContext(AiAssistActionsContext)
  if (!onGenerateSection) return null
  return (
    <Tooltip title="Generate a section with AI">
      <IconButton
        aria-label="generate section with ai"
        size="small"
        color="inherit"
        onClick={() => onGenerateSection()}
      >
        <MdiIcon fontSize="inherit" path={mdiAutoFix.path} />
      </IconButton>
    </Tooltip>
  )
}
AiGenerateSectionControl.displayName = 'AiGenerateSectionControl'

/**
 * Rewrite with AI (AGL-89), under the selected element's fields through the
 * `besignerInspector` zone: opens the provider's instruction dialog for the
 * element. Drawn for an element the rewrite applies to, while the reader's
 * permission admits the door.
 */
export function AiRewriteControl(props: { node?: NodeSchema<any> | null }) {
  const { onRewrite } = useContext(AiAssistActionsContext)
  const node = props.node
  if (!onRewrite || !node || !nodeTakesCopyRewrite(node)) return null
  return (
    <FormControl margin="none" fullWidth>
      <Button color="primary" onClick={() => onRewrite(node)} fullWidth>
        {'Rewrite with AI'}
      </Button>
    </FormControl>
  )
}
AiRewriteControl.displayName = 'AiRewriteControl'
