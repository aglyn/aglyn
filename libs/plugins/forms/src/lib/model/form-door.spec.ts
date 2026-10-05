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

import { FORMS_OFF_FOR_SITE_REFUSAL, formSubmissionDoorPlugin } from './form-door'

/**
 * Whose switch decides a submission to the shared door (AGL-3029): a
 * Marketing popup's capture is Marketing's, and anything that names form data
 * is a form's, whatever door it claims.
 */
describe('the plugin a submission came through', () => {
  it('is the forms plugin for a form, and for a body naming no door', () => {
    expect(formSubmissionDoorPlugin({ fields: { email: 'a@b.co' } })).toBe('forms')
    expect(formSubmissionDoorPlugin(null)).toBe('forms')
  })

  it('is Marketing for a popup’s capture', () => {
    expect(formSubmissionDoorPlugin({ door: 'popup', fields: { email: 'a@b.co' } })).toBe('marketing')
  })

  it('is the forms plugin again for a "popup" that names a form or a dataset binding', () => {
    expect(formSubmissionDoorPlugin({ door: 'popup', formId: 'f1' })).toBe('forms')
    expect(formSubmissionDoorPlugin({ door: 'popup', datasetBinding: { datasetId: 'd1' } })).toBe('forms')
  })

  it('tells a visitor the site is not accepting, naming no plugin or setting', () => {
    expect(FORMS_OFF_FOR_SITE_REFUSAL).toBe('This site is not accepting form submissions')
    expect(FORMS_OFF_FOR_SITE_REFUSAL.toLowerCase()).not.toMatch(/plugin|switch|setting/)
  })
})
