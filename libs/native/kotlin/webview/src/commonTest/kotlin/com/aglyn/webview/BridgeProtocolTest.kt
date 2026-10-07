package com.aglyn.webview

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class BridgeProtocolTest {
  private val trusted = listOf("https://app.aglyn.com")
  private val nonce = "n".repeat(32)
  private val methods = listOf("collectCardPayment", "cancel", "readerStatus")

  private fun message(overrides: Map<String, Any?> = emptyMap()): String {
    val base = mutableMapOf<String, Any?>("aglynBridge" to 1, "nonce" to nonce, "id" to "c1_x", "method" to "readerStatus", "params" to emptyMap<String, Any>())
    base.putAll(overrides)
    return buildJsonObject {
      for ((key, value) in base) when (value) {
        null -> Unit
        is Int -> put(key, value)
        is String -> put(key, value)
        is Map<*, *> -> put(key, JsonObject(value.entries.associate { it.key.toString() to JsonPrimitive(it.value.toString()) }))
        is List<*> -> put(key, Json.parseToJsonElement(value.toString()))
      }
    }.toString()
  }

  private fun parse(data: String, source: String = "https://app.aglyn.com/acme/hosts/shop/pos") =
    parseBridgeMessage(data, source, trusted, nonce, methods)

  @Test
  fun normalizesSchemeCaseAndDefaultPorts() {
    assertEquals("https://app.aglyn.com", originOf("HTTPS://App.Aglyn.com:443/x?y#z"))
    assertEquals("http://localhost:4200", originOf("http://localhost:4200/pos"))
  }

  @Test
  fun refusesEveryLookalike() {
    for (url in listOf(
      "https://app.aglyn.com.evil.com/pos", "https://evil.com/?https://app.aglyn.com", "https://app.aglyn.com@evil.com/pos",
      "https://shop.aglyn.com/pos", "http://app.aglyn.com/pos", "javascript:alert(1)", "file:///etc/passwd", "", null,
    )) {
      assertFalse(isTrustedUrl(url, trusted), url.toString())
    }
    assertTrue(isTrustedUrl("https://app.aglyn.com/acme/hosts/shop/pos", trusted))
  }

  @Test
  fun acceptsAWellFormedCallFromTheConsole() {
    val parsed = parse(message(mapOf("method" to "collectCardPayment", "params" to mapOf("paymentIntentId" to "pi_1"))))
    assertEquals(
      ParsedBridgeMessage.Accepted(BridgeRequest("c1_x", "collectCardPayment", buildJsonObject { put("paymentIntentId", "pi_1") })),
      parsed,
    )
  }

  @Test
  fun dropsAMessageFromAnyOtherOriginWhateverItClaims() {
    assertEquals(ParsedBridgeMessage.Rejected(BridgeRejection.UNTRUSTED_ORIGIN), parse(message(), "https://evil.example/pos"))
  }

  @Test
  fun dropsAMessageWithoutTheInjectedNonce() {
    assertEquals(ParsedBridgeMessage.Rejected(BridgeRejection.BAD_NONCE), parse(message(mapOf("nonce" to "guess"))))
    assertEquals(ParsedBridgeMessage.Rejected(BridgeRejection.BAD_NONCE), parse(message(mapOf("nonce" to null))))
  }

  @Test
  fun refusesAMethodOffTheAllowlistNamingTheCall() {
    assertEquals(ParsedBridgeMessage.Rejected(BridgeRejection.UNKNOWN_METHOD, "c1_x"), parse(message(mapOf("method" to "openUrl"))))
    assertEquals(ParsedBridgeMessage.Rejected(BridgeRejection.MALFORMED, "c1_x"), parse(message(mapOf("method" to "__proto__"))))
  }

  @Test
  fun refusesMalformedMessages() {
    for (data in listOf(
      "nope",
      "[]",
      buildJsonObject { put("nonce", nonce); put("id", "a"); put("method", "cancel") }.toString(),
      message(mapOf("id" to "a b")),
      message(mapOf("params" to listOf(1))),
      message(mapOf("params" to mapOf("pad" to "x".repeat(20_000)))),
    )) {
      assertIs<ParsedBridgeMessage.Rejected>(parse(data), data.take(60))
    }
  }

  @Test
  fun aNonceIs32CharactersFromTheAlphabet() {
    assertTrue(Regex("^[A-Za-z0-9]{32}$").matches(createBridgeNonce()))
    assertEquals("a".repeat(32), createBridgeNonce { 0.0 })
  }

  @Test
  fun theInjectionDefinesOnlyIdentifierMethods() {
    val script = bridgeInjectionScript("AglynPosBridge", nonce, methods, trusted, "AglynNativeBridge", mapOf("platform" to JsonPrimitive("android")))
    assertTrue(script.contains("[\"collectCardPayment\",\"cancel\",\"readerStatus\"]"))
    assertTrue(script.contains("[\"https://app.aglyn.com\"].indexOf(window.location.origin) < 0"))
    assertTrue(script.contains("window.AglynNativeBridge.postMessage"))
    assertFailsWith<IllegalArgumentException> { bridgeInjectionScript("X", nonce, listOf("a;alert(1)"), trusted, "AglynNativeBridge") }
    assertFailsWith<IllegalArgumentException> { bridgeInjectionScript("X", nonce, methods, trusted, "a.b") }
  }

  @Test
  fun aReplyCannotBreakOutOfTheCallItSitsIn() {
    val script = bridgeReplyScript("AglynPosBridge", BridgeReply.Error("c1", "\"});alert(1);// </script>\u2028"))
    assertFalse(script.contains('\u2028'))
    val payload = script.substringAfter("b.__reply(").substringBeforeLast(");}})();true;")
    assertEquals(
      buildJsonObject { put("id", "c1"); put("ok", false); put("error", "\"});alert(1);// </script>\u2028") },
      Json.parseToJsonElement(payload),
    )
  }
}
