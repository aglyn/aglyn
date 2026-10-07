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
 * One submission as its own screen (AGL-3622): what a phone pushes from the
 * Inbox list, a notification or a link. Tablets show the same reader beside
 * the list instead.
 */

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { SubmissionDetail } from './submission-detail'

export default function SubmissionScreen({ params, context }: MobileScreenProps) {
  return (
    <SubmissionDetail
      context={context}
      hostId={params['hostId'] || context.hostId}
      submissionId={params['id'] || null}
      showSite={params['showSite'] === '1'}
    />
  )
}
