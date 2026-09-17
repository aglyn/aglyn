'use client'

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

import { AiBriefDialog, type AiBriefDialogProps } from './ai-brief-dialog.component'

/**
 * "Describe a page" (AGL-2907): the brief dialog both page entry points open,
 * the Screens page's "Describe it" and the Assist panel's AI jobs.
 *
 * It is the shared brief dialog for a `page` job (AGL-3043): one text box and
 * an optional page type. The job plans first and waits in AI jobs, where the
 * member confirms the plan and opens the draft once it is built; nothing here
 * builds or writes anything.
 */

export type AiPageBriefDialogProps = Omit<AiBriefDialogProps, 'kind'>

export function AiPageBriefDialog(props: AiPageBriefDialogProps) {
  return <AiBriefDialog {...props} kind="page" />
}

export default AiPageBriefDialog
