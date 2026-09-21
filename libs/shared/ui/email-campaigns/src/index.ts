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

// THE MODEL IS ALL THIS LIBRARY IS NOW (AGL-3080). It used to carry
// `components/report-figures` as well, reachable only by subpath so that a
// server handler reading a stored field name never pulled a component graph
// behind it. The figure primitives had already moved to
// `@aglyn/shared-ui-jsx`; the money ones that stayed were stranded where only
// the email surfaces could reach them, so they went the same way. This
// library renders nothing, and the subpath rule no longer has a subject.
export * from './lib/model'
