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

import { DesignerAssistContext, type DesignerAssistContextValue } from '@aglyn/aglyn'

/**
 * The designer's name for the core assistant seam (AGL-2939): the console's
 * AI provider fills `DesignerAssistContext`, and the attributes panel shows
 * "Rewrite with AI" and the toolbar "Generate section" only where the
 * callback exists. The context lives in core so neither the designer nor a
 * plugin has to import the other.
 */
export type AiAssistContextValue = DesignerAssistContextValue
export const AiAssistContext = DesignerAssistContext

export default AiAssistContext
