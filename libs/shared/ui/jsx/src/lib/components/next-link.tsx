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

import {styled} from '@aglyn/shared-feature-themes'
import Link, {type LinkProps} from 'next/link'
import {type AnchorHTMLAttributes, forwardRef} from 'react'


interface AnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {}

// Add support for the sx prop
const Anchor = styled('a', {name: 'AglynAnchor'})<AnchorProps>({})
Anchor.displayName = 'Anchor'


export interface NextLinkProps extends Omit<AnchorProps, 'href'>, Omit<LinkProps, 'as' | 'href'> {
  hrefTo?: LinkProps['href']
  hrefAs?: LinkProps['as']
}

const NextLink = forwardRef<HTMLAnchorElement, NextLinkProps>(
  function RefRenderFn(props, ref) {
    const {
      as: _1,
      href: _2,
      hrefAs,
      hrefTo,
      replace,
      scroll,
      passHref,
      shallow,
      prefetch,
      locale,
      ...rest
    } = props as LinkProps & NextLinkProps

    return (
      <Link
        as={hrefAs}
        href={hrefTo}
        locale={locale}
        passHref={passHref}
        prefetch={prefetch}
        replace={replace}
        scroll={scroll}
        shallow={shallow}
      >
        <Anchor ref={ref} {...rest} />
      </Link>
    )
  },
)

NextLink.displayName = 'NextLink'
NextLink.defaultProps = {passHref: true}

export {NextLink}
export default NextLink
