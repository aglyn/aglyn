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

import { BRAND, CURRENT_YEAR, TRADEMARK_NOTICE } from '@aglyn/shared-data-enums'
import { Typography, type TypographyProps } from '@mui/material'
import { forwardRef } from 'react'

export interface CopyrightProps extends TypographyProps<any, any> {}

const CopyrightComponent = forwardRef<any, CopyrightProps>((props, ref) => {
  const { children, ...rest } = props
  /*
   * `body2`, not `subtitle2` (AGL-2486). We probably don't need to
   * make this copyright text so bold. `subtitle2` is a 500-weight,
   * heading-ish role, which gave a legal footnote more visual weight than the
   * links beside it and the version beneath it. It is boilerplate: it has to
   * be present and legible, not prominent.
   *
   * Both the variant and the colour are still overridable through `rest`, so
   * a surface that genuinely wants it louder can say so at the call site.
   */
  return (
    <Typography
      ref={ref}
      variant="body2"
      color="text.secondary"
      {...rest}
    >
      {/*
       * `© 2026 Aglyn LLC. All rights reserved.` — the conventional order,
       * with the sentence actually closed (AGL-2486).
       *
       * This read `2026 © Aglyn LLC Aglyn™ and Besigner™ are trademarks of
       * Aglyn LLC.`: the year ahead of the symbol, and no full stop, so the
       * legal name ran straight into the trademark sentence as one
       * ungrammatical line. Zach, comparing it against the footer he had
       * authored on a published page and the docs site's own: "we have some
       * differences here, probably should be the same."
       *
       * The legal name and the trademark sentence both still come from the
       * brand configuration, so a self-host or white-label build says its own
       * name here and drops the marks entirely — see TRADEMARK_NOTICE, which
       * is empty unless the deployment is actually ours.
       */}
      &copy; {CURRENT_YEAR} {BRAND.ORG_NAME_LEGAL}. All rights reserved.
      {TRADEMARK_NOTICE && ` ${TRADEMARK_NOTICE}`}
      {children}
    </Typography>
  )
})
CopyrightComponent.displayName = 'CopyrightComponent'
CopyrightComponent.aglyn = true

export { CopyrightComponent }
export default CopyrightComponent
