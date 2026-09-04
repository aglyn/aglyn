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

import {
  CreateArtifactDrawer as SharedCreateArtifactDrawer,
  type CreateArtifactDrawerProps as SharedCreateArtifactDrawerProps,
} from '@aglyn/shared-ui-jsx-forms'
import AuthErrorAlertComponent from './auth-error-alert.component'
import AuthFormTemplateComponent from './auth-form-template.component'

export interface CreateArtifactDrawerProps
  extends Omit<
    SharedCreateArtifactDrawerProps,
    'errorSlot' | 'FormTemplate'
  > {
  /** Rendered under the form when a submit fails. */
  error?: unknown
}

/**
 * The console's binding of the shared create drawer (AGL-700).
 *
 * The drawer itself moved to `@aglyn/shared-ui-jsx-forms` so the console pages
 * that PLUGINS ship can create a record the same way the app's own list pages
 * do — a plugin card cannot import from the app that renders it, so leaving
 * the drawer here meant every plugin either stacked an inline form above its
 * table or drew a second drawer that looked almost like this one.
 *
 * What stays here is the console's own form chrome, which reaches for the
 * session through `useSigninCheck` and therefore cannot live in a UI library.
 * Binding it here rather than at each call site is what keeps the four
 * existing console creates byte-identical to what they rendered before.
 */
export function CreateArtifactDrawer(props: CreateArtifactDrawerProps) {
  const { error, ...rest } = props
  return (
    <SharedCreateArtifactDrawer
      {...rest}
      FormTemplate={AuthFormTemplateComponent}
      errorSlot={
        <AuthErrorAlertComponent error={error as any} sx={{ mt: 2, mb: 1 }} />
      }
    />
  )
}

CreateArtifactDrawer.displayName = 'CreateArtifactDrawer'

export default CreateArtifactDrawer
