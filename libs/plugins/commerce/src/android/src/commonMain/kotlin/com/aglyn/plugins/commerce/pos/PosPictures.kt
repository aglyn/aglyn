package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * How a register or kiosk screen turns a product's stored picture (a media reference, `media:<scope>/<id>`, or a path on
 * the console, `/api/media/cdn/…`) into an address the image loader can fetch (AGL-3906). Provided by each screen from
 * its console origin and site; null when there is no picture.
 */
internal val LocalPosPictures = staticCompositionLocalOf<(String?) -> String?> { { it } }
