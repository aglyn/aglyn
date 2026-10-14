package com.aglyn.plugins.reviewplatforms

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The ReviewPlatforms plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/review-platforms.screens.json. The ids are the ones
 * plugins.config.json declares under `review-platforms.mobile.contributes`.
 */
fun registerReviewPlatformsNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(ReviewPlatformsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
