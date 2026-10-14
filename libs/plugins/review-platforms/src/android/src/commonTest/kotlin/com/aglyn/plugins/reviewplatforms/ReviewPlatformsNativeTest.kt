package com.aglyn.plugins.reviewplatforms

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReviewPlatformsNativeTest {
  private val declared = mapOf(
    "screens" to listOf("review-platforms.service"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("review-platforms", declared, ::registerReviewPlatformsNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = ReviewPlatformsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("review-platforms.service").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
