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

import { styled } from '@aglyn/shared-ui-theme'
import { base64Encode } from '@aglyn/shared-util-tools'
import NextImageRaw, { type ImageProps as NextImageProps } from 'next/image'
import { useMemo } from 'react'

interface NextEmotionImageProps
  extends JSX.ComponentProps<typeof NextEmotionImage> {}

const NextEmotionImage = styled(NextImageRaw, {
  name: 'NextEmotionImage',
})<NextImageProps>({})

const shimmer = (props: {
  width?: number | string
  height?: number | string
}) => {
  const { width: w, height: h } = props
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="g">
      <stop stop-color="#333" offset="20%" />
      <stop stop-color="#222" offset="50%" />
      <stop stop-color="#333" offset="70%" />
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="#333" />
  <rect id="r" width="${w}" height="${h}" fill="url(#g)" />
  <animate xlink:href="#r" attributeName="x" from="-${w}" to="${w}" dur="1s" repeatCount="indefinite"  />
</svg>`
}

function shimmerToBase64(shimmer?: string) {
  return `data:image/svg+xml;base64,${base64Encode(shimmer)}`
}

export interface ImageProps extends NextEmotionImageProps {
  disableShimmer?: boolean
}

function Image(props: ImageProps): JSX.Element {
  const { width, height, disableShimmer, ...rest } = props

  const shimmeredImage = useMemo(() => {
    return Image.shimmer({ width, height })
  }, [width, height])
  const base64Shimmer = useMemo(() => {
    return Image.shimmerToBase64(shimmeredImage)
  }, [shimmeredImage])

  return (
    <NextEmotionImage
      width={width}
      height={height}
      blurDataURL={!disableShimmer ? base64Shimmer : undefined}
      {...rest}
    />
  )
}
Image.displayName = 'Image'
Image.aglyn = true
Image.defaultProps = {
  width: 100,
  height: 100,
  placeholder: 'blur',
}
Image.shimmerToBase64 = shimmerToBase64
Image.shimmer = shimmer

export { Image }
export default Image
