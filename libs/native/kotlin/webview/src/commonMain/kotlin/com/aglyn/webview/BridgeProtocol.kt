package com.aglyn.webview

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import kotlin.random.Random

/*
 * The console view's bridge: how a console page calls the app (the POS page
 * asking for a card payment, say). The port of the React Native bridge
 * protocol (libs/mobile/webview bridge-protocol.ts), with its checks:
 *
 * - a call is read only from a page on a trusted origin, by exact origin;
 * - every call carries the nonce injected into this page load;
 * - only the methods the app registered for this view exist, and a method
 *   name is an identifier;
 * - a reply is JSON inside a function call it cannot break out of.
 */

data class BridgeRequest(val id: String, val method: String, val params: JsonObject)

sealed interface BridgeReply {
  val id: String
  data class Ok(override val id: String, val result: JsonElement) : BridgeReply
  data class Error(override val id: String, val error: String) : BridgeReply
}

/** Why a message was dropped, for the app's own log. */
enum class BridgeRejection(val wire: String) {
  UNTRUSTED_ORIGIN("untrusted-origin"),
  MALFORMED("malformed"),
  BAD_NONCE("bad-nonce"),
  UNKNOWN_METHOD("unknown-method"),
}

sealed interface ParsedBridgeMessage {
  data class Accepted(val request: BridgeRequest) : ParsedBridgeMessage
  data class Rejected(val reason: BridgeRejection, val id: String? = null) : ParsedBridgeMessage
}

private val ORIGIN = Regex("^(https?)://([^/?#]+)", RegexOption.IGNORE_CASE)
private val ID_PATTERN = Regex("^[A-Za-z0-9_-]{1,64}$")
private val METHOD_PATTERN = Regex("^[A-Za-z][A-Za-z0-9]{0,63}$")

/** The largest message the app reads; a bigger one is not a bridge call. */
const val MAX_BRIDGE_MESSAGE_BYTES = 16 * 1024

/** The origin of a URL, or null for anything that is not http(s). */
fun originOf(url: String?): String? {
  if (url.isNullOrEmpty()) return null
  val match = ORIGIN.find(url.trim()) ?: return null
  val scheme = match.groupValues[1].lowercase()
  val authority = match.groupValues[2].lowercase()
  // Credentials in the authority (`https://evil@trusted.com`) are refused outright.
  if ('@' in authority) return null
  val host = authority.substringBefore(':')
  val port = if (':' in authority) authority.substringAfter(':') else ""
  if (host.isEmpty()) return null
  val defaultPort = if (scheme == "https") "443" else "80"
  return if (port.isNotEmpty() && port != defaultPort) "$scheme://$host:$port" else "$scheme://$host"
}

fun isTrustedUrl(url: String?, trustedOrigins: List<String>): Boolean {
  val origin = originOf(url) ?: return false
  return trustedOrigins.any { originOf(it) == origin }
}

fun parseBridgeMessage(
  data: String,
  sourceUrl: String?,
  trustedOrigins: List<String>,
  nonce: String,
  methods: List<String>,
): ParsedBridgeMessage {
  if (!isTrustedUrl(sourceUrl, trustedOrigins)) return ParsedBridgeMessage.Rejected(BridgeRejection.UNTRUSTED_ORIGIN)
  if (data.length > MAX_BRIDGE_MESSAGE_BYTES) return ParsedBridgeMessage.Rejected(BridgeRejection.MALFORMED)
  val parsed = runCatching { Json.parseToJsonElement(data) }.getOrNull() as? JsonObject
    ?: return ParsedBridgeMessage.Rejected(BridgeRejection.MALFORMED)
  if ((parsed["aglynBridge"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull != 1) {
    return ParsedBridgeMessage.Rejected(BridgeRejection.MALFORMED)
  }
  val id = (parsed["id"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
  if (id == null || !ID_PATTERN.matches(id)) return ParsedBridgeMessage.Rejected(BridgeRejection.MALFORMED)
  val sentNonce = (parsed["nonce"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
  if (sentNonce == null || nonce.isEmpty() || sentNonce != nonce) return ParsedBridgeMessage.Rejected(BridgeRejection.BAD_NONCE)
  val method = (parsed["method"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
  if (method == null || !METHOD_PATTERN.matches(method)) return ParsedBridgeMessage.Rejected(BridgeRejection.MALFORMED, id)
  if (method !in methods) return ParsedBridgeMessage.Rejected(BridgeRejection.UNKNOWN_METHOD, id)
  val params = parsed["params"] ?: JsonObject(emptyMap())
  if (params !is JsonObject) return ParsedBridgeMessage.Rejected(BridgeRejection.MALFORMED, id)
  return ParsedBridgeMessage.Accepted(BridgeRequest(id, method, params))
}

private const val NONCE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

/** A nonce for one page load. [random] returns [0, 1) and is injectable for specs. */
fun createBridgeNonce(random: () -> Double = { Random.nextDouble() }): String = buildString {
  repeat(32) { append(NONCE_ALPHABET[(random() * NONCE_ALPHABET.length).toInt() % NONCE_ALPHABET.length]) }
}

private fun jsString(value: String): String = JsonPrimitive(value).toString()

/** JSON that is also safe JavaScript: the line separators older engines read as line ends are escaped. */
private fun safeJson(element: JsonElement): String = element.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

/** The JavaScript the app runs to deliver one reply into the page. */
fun bridgeReplyScript(globalName: String, reply: BridgeReply): String {
  val payload = when (reply) {
    is BridgeReply.Ok -> buildJsonObject { put("id", reply.id); put("ok", true); put("result", reply.result) }
    is BridgeReply.Error -> buildJsonObject { put("id", reply.id); put("ok", false); put("error", reply.error) }
  }
  return "(function(){var b=window[${jsString(globalName)}];if(b&&b.__reply){b.__reply(${safeJson(payload)});}})();true;"
}

/**
 * The script injected into each trusted page: it defines `window[globalName]`
 * with exactly [methods] (plus read-only [info]), frozen, posting each call
 * with the nonce through [transport] (the JavaScript object the platform
 * exposes with a `postMessage(string)`). It defines nothing on any other origin.
 */
fun bridgeInjectionScript(
  globalName: String,
  nonce: String,
  methods: List<String>,
  trustedOrigins: List<String>,
  transport: String,
  info: Map<String, JsonPrimitive> = emptyMap(),
): String {
  for (method in methods) require(METHOD_PATTERN.matches(method)) { "Invalid bridge method name: $method" }
  require(METHOD_PATTERN.matches(transport)) { "Invalid bridge transport name: $transport" }
  val name = jsString(globalName)
  val methodList = safeJson(kotlinx.serialization.json.JsonArray(methods.map(::JsonPrimitive)))
  val infoJson = safeJson(JsonObject(info))
  val trusted = safeJson(kotlinx.serialization.json.JsonArray(trustedOrigins.mapNotNull(::originOf).map(::JsonPrimitive)))
  val ready = jsString("$globalName:ready")
  return """(function(){
if (window[$name] || !window.$transport) return;
if ($trusted.indexOf(window.location.origin) < 0) return;
var pending = {};
var counter = 0;
function call(method, params) {
  return new Promise(function (resolve, reject) {
    counter += 1;
    var id = 'c' + counter + '_' + Date.now().toString(36);
    pending[id] = { resolve: resolve, reject: reject };
    window.$transport.postMessage(JSON.stringify({
      aglynBridge: 1, nonce: ${jsString(nonce)}, id: id, method: method,
      params: params && typeof params === 'object' ? params : {}
    }));
  });
}
var bridge = { info: Object.freeze($infoJson) };
$methodList.forEach(function (method) {
  bridge[method] = function (params) { return call(method, params); };
});
Object.defineProperty(bridge, '__reply', {
  value: function (reply) {
    var entry = reply && pending[reply.id];
    if (!entry) return;
    delete pending[reply.id];
    if (reply.ok) entry.resolve(reply.result);
    else entry.reject(new Error(String(reply.error || 'The app could not do that.')));
  }
});
Object.defineProperty(window, $name, { value: Object.freeze(bridge), writable: false, configurable: false });
try { window.dispatchEvent(new Event($ready)); } catch (e) {}
})();true;"""
}

/**
 * A bridge a console view offers its page: the global it defines, the
 * methods by name, and read-only facts. A handler's throw becomes an error
 * reply in the handler's words.
 */
class ConsoleBridge(
  val globalName: String,
  val handlers: Map<String, suspend (JsonObject) -> JsonElement>,
  val info: Map<String, JsonPrimitive> = emptyMap(),
)
