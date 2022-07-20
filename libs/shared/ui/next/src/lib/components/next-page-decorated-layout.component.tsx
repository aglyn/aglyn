/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {
  getNextPageLayout,
  type NextAppWithLayoutProps,
} from '../utils/get-next-page-layout'

export interface NextPageDecoratedLayoutComponentProps<Props, InitialProps>
  extends NextAppWithLayoutProps<Props, InitialProps> {}

/**
 * Decorate next page with defined layout
 * Uses the layout defined at the page level, if available
 */
function NextPageDecoratedLayoutComponent<Props, InitialProps>(
  props: NextPageDecoratedLayoutComponentProps<Props, InitialProps>,
) {
  const Component = props.Component
  return getNextPageLayout(props)(<Component {...props.pageProps} />, props)
}

NextPageDecoratedLayoutComponent.displayName =
  'NextPageDecoratedLayoutComponent'
NextPageDecoratedLayoutComponent.aglyn = true

export { NextPageDecoratedLayoutComponent }
export default NextPageDecoratedLayoutComponent
