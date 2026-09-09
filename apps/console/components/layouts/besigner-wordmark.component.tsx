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

// Subpath, not the barrel: the barrel reaches `svg-icons.tsx`, which draws
// five more wordmarks nothing here renders.
import { AglynBesignerLogoFull } from '@aglyn/shared-ui-jsx/const/aglyn-besigner-logo-full'

/**
 * The besigner wordmark at app-bar size, passed to `MainLayout` as `wordmark`
 * by each editor shell.
 *
 * A module of its own so the mark rides with the editor pages that draw it
 * rather than with `main.layout.tsx`, which every console route loads: the
 * two authoring wordmarks are ~13 KB of outlined path data each, and a
 * ternary between them in the shell put both on every page. One import here,
 * one app-bar height, and the pages carry a node rather than a size.
 */
export function BesignerWordmark() {
  return <AglynBesignerLogoFull sx={{ height: 24, width: 'auto' }} />
}
BesignerWordmark.displayName = 'BesignerWordmark'

export default BesignerWordmark
