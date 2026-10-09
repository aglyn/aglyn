package com.aglyn.plugins.sms

import com.aglyn.core.FirestoreWriter
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class FakeWriter : FirestoreWriter {
  val merged = mutableListOf<Pair<String, Map<String, Any?>>>()
  var fail = false
  override suspend fun merge(path: String, data: Map<String, Any?>) {
    if (fail) error("permission denied")
    merged += path to data
  }
}

private class FakeApi(var channel: TextChannel) : TextsApi {
  override suspend fun channel() = channel
}

class CustomerTextsTest {
  @Test
  fun registersEveryDeclaredId() {
    val registry = NativePluginRegistry()
    val declared = mapOf("screens" to listOf(SMS_TEXTS_SCREEN), "quickActions" to listOf("sms.open"))
    val result = registry.load(listOf(NativePluginManifestEntry("sms", declared, ::registerSmsNative)))
    assertEquals(listOf("sms"), result.loaded, result.failed.toString())
    assertTrue(registry.screen(SMS_TEXTS_SCREEN)!!.requiresSite)
  }

  @Test
  fun textsAreOnUnlessTheStoreTurnedThemOff() = runTest {
    val texts = CustomerTexts(FakeApi(TextChannel.Available), FakeWriter(), "h1", this)
    assertTrue(texts.enabled(null))
    assertTrue(texts.enabled(emptyMap()))
    assertTrue(texts.enabled(mapOf("buyerNotifications" to mapOf("receipt" to false))))
    assertFalse(texts.enabled(mapOf("buyerNotifications" to mapOf("texts" to false))))
    assertTrue(texts.enabled(mapOf("buyerNotifications" to "garbage")))
  }

  @Test
  fun theChannelAnswerGatesTheSwitch() = runTest {
    val api = FakeApi(TextChannel.Unavailable)
    val texts = CustomerTexts(api, FakeWriter(), "h1", this)
    assertEquals(TextChannel.Checking, texts.channel)
    texts.check()
    advanceUntilIdle()
    assertEquals(TextChannel.Unavailable, texts.channel)
    api.channel = TextChannel.Available
    texts.check()
    advanceUntilIdle()
    assertEquals(TextChannel.Available, texts.channel)
  }

  @Test
  fun aSwitchWritesOnlyItsOwnKeyUnderTheStoreSettings() = runTest {
    val writer = FakeWriter()
    val texts = CustomerTexts(FakeApi(TextChannel.Available), writer, "h1", this)
    texts.set(false)
    advanceUntilIdle()
    assertEquals(listOf<Pair<String, Map<String, Any?>>>("hosts/h1/settings/store" to mapOf("buyerNotifications" to mapOf("texts" to false))), writer.merged)
    assertNull(texts.error)
    assertFalse(texts.saving)
  }

  @Test
  fun aRefusedWriteSaysSoInTheCardsWords() = runTest {
    val writer = FakeWriter().apply { fail = true }
    val texts = CustomerTexts(FakeApi(TextChannel.Available), writer, "h1", this)
    texts.set(true)
    advanceUntilIdle()
    assertEquals("That setting could not be saved. Try again.", texts.error)
    assertFalse(texts.saving)
  }
}
