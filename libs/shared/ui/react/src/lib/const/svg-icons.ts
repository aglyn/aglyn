/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { createSvgPathIcon } from '../components/svg-path-icon/svg-path-icon'


export const AGLYN_SVG_LOGO = {
  path: 'M17.8,19H15.53l-2.82-6.11H5.17L2.37,19H0L8.64,0h.65Zm-6.06-8.29L9,4.54,6.17,10.71Zm21.75,5.1a13,13,0,0,1-.46,4,5.65,5.65,0,0,1-1.4,2.2,6.26,6.26,0,0,1-2.25,1.36,8.63,8.63,0,0,1-2.89.46c-3.54,0-5.91-1.5-7.09-4.49h2.2a5.09,5.09,0,0,0,4.82,2.6,6.2,6.2,0,0,0,2.77-.6,3.6,3.6,0,0,0,1.72-1.6,7.09,7.09,0,0,0,.5-3.07v-.13a6.4,6.4,0,0,1-2.34,1.67,7.23,7.23,0,0,1-2.85.58,6.66,6.66,0,0,1-4.93-2,6.5,6.5,0,0,1-2-4.77A6.49,6.49,0,0,1,21.4,7.08a6.91,6.91,0,0,1,5-2,6.62,6.62,0,0,1,5,2.35v-2h2.08Zm-2-3.82a4.74,4.74,0,0,0-1.44-3.55A4.82,4.82,0,0,0,26.55,7a5,5,0,0,0-3.69,1.51,4.86,4.86,0,0,0-1.48,3.51,4.52,4.52,0,0,0,1.42,3.38,5,5,0,0,0,3.65,1.39,5,5,0,0,0,3.63-1.36A4.63,4.63,0,0,0,31.49,12Zm7,7h-2V.27h2ZM53.29,5.39,45.22,23.82H43.08l2.62-6L40.18,5.39h2.15l4.47,10,4.32-10ZM67,19H65V12.51a14.49,14.49,0,0,0-.21-3.06,3.85,3.85,0,0,0-.63-1.37,2.51,2.51,0,0,0-1-.84A4,4,0,0,0,61.52,7a3.86,3.86,0,0,0-1.79.45,4.48,4.48,0,0,0-1.5,1.25,4.75,4.75,0,0,0-.86,1.69,18.05,18.05,0,0,0-.23,3.6v5H55.06V5.39h2.08V7.44A6.07,6.07,0,0,1,61.93,5a4.87,4.87,0,0,1,2.67.77A4.65,4.65,0,0,1,66.4,7.9,10.59,10.59,0,0,1,67,12Z',
  viewBox: '0 0 67 23.82'
}
export const AGLYN_SVG_ICON = 'M-79.288-327.3l-2.672-5.8h-5.463l-2.33,5.1H-90.6l-.158.346h-.838l-.162.354H-94l8.184-18h.615l.111.249.274-.6h.615l.113.253.272-.6h.615l8.066,18H-76.29l.155.346h-1.158l.158.354Zm-6.87-8.553h2.96l-1.473-3.279Z'

export const AglynSvgLogo = createSvgPathIcon('Aglyn', AGLYN_SVG_LOGO.path, {
  viewBox: AGLYN_SVG_LOGO.viewBox,
  'aria-label': 'Aglyn',
})
