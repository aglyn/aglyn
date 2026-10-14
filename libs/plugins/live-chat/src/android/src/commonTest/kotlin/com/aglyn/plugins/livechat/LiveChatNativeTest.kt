package com.aglyn.plugins.livechat

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LiveChatNativeTest {
  private val declared = mapOf(
    "screens" to listOf("live-chat.settings"),
    "widgets" to listOf("live-chat.settings.card"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("live-chat", declared, ::registerLiveChatNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheSitePluginSettingsZone() {
    val specs = LiveChatScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("live-chat.settings").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "sitePluginSettings" in it.zones } || specs.all { it.zones.isEmpty() })
    assertEquals("hostSettings", specs.first { it.id == "live-chat.settings" }.cardSlot, "its Setup > Integrations card")
  }
}
