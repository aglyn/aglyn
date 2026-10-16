package com.aglyn.contracts

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Decodes what the console's encoder (`compress`) makes of trees and scalars, from function-cases.generated.json. */
@OptIn(ExperimentalEncodingApi::class)
class StoredNodesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }

  @Test
  fun everyValueTheConsoleEncodesDecodesToItself() {
    val all = cases("compress")
    assertTrue(all.size >= 15)
    for ((args, result) in all) {
      val decoded = decodeMsgPack(Base64.decode(result.jsonPrimitive.content))
      assertEquals(comparable(plainOf(args[0])), comparable(decoded), args.toString())
    }
  }

  @Test
  fun aStoredFieldIsReadWhicheverFormItIsIn() {
    val tree = mapOf("root" to mapOf("\$id" to "root", "componentId" to "div", "nodes" to emptyList<Any>()))
    // A plain map is the tree already.
    assertEquals(tree, decodeStoredNodes(tree))
    // Bytes as the readers hand them over: base64 text, or raw.
    val encoded = cases("compress").first { (args, _) -> (args[0] as? kotlinx.serialization.json.JsonObject)?.containsKey("root") == true }.second.jsonPrimitive.content
    val fromText = assertNotNull(decodeStoredNodes(encoded))
    assertEquals(setOf("root", "n1", "n2"), fromText.keys)
    assertEquals(fromText, decodeStoredNodes(Base64.decode(encoded)))
    // Anything else, and bytes that are not a tree, are skipped rather than thrown.
    assertNull(decodeStoredNodes(null))
    assertNull(decodeStoredNodes(12L))
    assertNull(decodeStoredNodes("not base64 at all!"))
    assertNull(decodeStoredNodes(Base64.encode(byteArrayOf(0x91.toByte(), 0x01))))
  }

  @Test
  fun bytesThatAreNotAValueAreRefused() {
    assertFailsWith<MsgPackException> { decodeMsgPack(byteArrayOf(0x92.toByte(), 0x01)) }
    assertFailsWith<MsgPackException> { decodeMsgPack(byteArrayOf(0xc1.toByte())) }
    assertFailsWith<MsgPackException> { decodeMsgPack(byteArrayOf(0x01, 0x02)) }
    assertFailsWith<MsgPackException> { decodeMsgPack(byteArrayOf(0xa2.toByte(), 0xff.toByte(), 0xfe.toByte())) }
    // A length that names more than the bytes hold.
    assertFailsWith<MsgPackException> { decodeMsgPack(byteArrayOf(0xdd.toByte(), 0x7f, 0xff.toByte(), 0xff.toByte(), 0xff.toByte())) }
  }
}
