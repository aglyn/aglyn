package com.aglyn.contracts

import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/*
 * A page, component, layout or template keeps its node tree either as a plain
 * map or as msgpack bytes (`decodeStoredNodes` in stored-nodes.ts). A native
 * reader hands the bytes over as base64 text, and the console's routes take
 * the tree as JSON and encode it themselves, so the apps only ever READ
 * msgpack. The cases in function-cases.generated.json hold what the console's
 * encoder (`compress`) makes of trees and scalars, and the tests decode each.
 */

/** Bytes that are not a msgpack value this decoder reads. */
class MsgPackException(message: String) : Exception(message)

private const val MSGPACK_MAX_DEPTH = 512

/**
 * One msgpack value as plain Kotlin: a map is a `Map<String, Any?>`, an array
 * a `List<Any?>`, an integer a `Long` (a `Double` past what a `Long` holds),
 * a float a `Double`, `bin` a `ByteArray`. A non-string map key is read as its
 * text.
 */
fun decodeMsgPack(bytes: ByteArray): Any? {
  val reader = MsgPackReader(bytes)
  val value = reader.read(0)
  if (reader.position != bytes.size) throw MsgPackException("${bytes.size - reader.position} bytes follow the value")
  return value
}

private class MsgPackReader(private val bytes: ByteArray) {
  var position = 0
    private set

  private fun need(count: Int) {
    if (count < 0 || position + count > bytes.size) throw MsgPackException("the bytes end inside a value")
  }

  private fun byte(): Int {
    need(1)
    return bytes[position++].toInt() and 0xff
  }

  private fun unsigned(width: Int): Long {
    need(width)
    var value = 0L
    repeat(width) { value = (value shl 8) or (bytes[position++].toLong() and 0xff) }
    return value
  }

  private fun signed(width: Int): Long {
    val raw = unsigned(width)
    val bits = width * 8
    return if (bits == 64) raw else (raw shl (64 - bits)) shr (64 - bits)
  }

  private fun text(length: Int): String {
    need(length)
    val value = try {
      bytes.decodeToString(position, position + length, throwOnInvalidSequence = true)
    } catch (_: CharacterCodingException) {
      throw MsgPackException("a string is not UTF-8")
    }
    position += length
    return value
  }

  private fun binary(length: Int): ByteArray {
    need(length)
    return bytes.copyOfRange(position, position + length).also { position += length }
  }

  private fun array(length: Int, depth: Int): List<Any?> {
    need(0)
    if (length > bytes.size - position) throw MsgPackException("an array longer than the bytes left")
    return ArrayList<Any?>(length).also { list -> repeat(length) { list.add(read(depth + 1)) } }
  }

  private fun map(length: Int, depth: Int): Map<String, Any?> {
    if (length > bytes.size - position) throw MsgPackException("a map longer than the bytes left")
    val out = LinkedHashMap<String, Any?>(length)
    repeat(length) {
      val key = read(depth + 1)
      out[key as? String ?: key.toString()] = read(depth + 1)
    }
    return out
  }

  private fun length32(): Int {
    val length = unsigned(4)
    if (length > Int.MAX_VALUE) throw MsgPackException("a length past what fits")
    return length.toInt()
  }

  fun read(depth: Int): Any? {
    if (depth > MSGPACK_MAX_DEPTH) throw MsgPackException("nested too deeply")
    val tag = byte()
    return when {
      tag <= 0x7f -> tag.toLong()
      tag in 0x80..0x8f -> map(tag and 0x0f, depth)
      tag in 0x90..0x9f -> array(tag and 0x0f, depth)
      tag in 0xa0..0xbf -> text(tag and 0x1f)
      tag >= 0xe0 -> (tag - 256).toLong()
      else -> when (tag) {
        0xc0 -> null
        0xc2 -> false
        0xc3 -> true
        0xc4 -> binary(unsigned(1).toInt())
        0xc5 -> binary(unsigned(2).toInt())
        0xc6 -> binary(length32())
        0xca -> { need(4); Float.fromBits(unsigned(4).toInt()).toDouble() }
        0xcb -> { need(8); Double.fromBits(unsigned(8)) }
        0xcc -> unsigned(1)
        0xcd -> unsigned(2)
        0xce -> unsigned(4)
        0xcf -> unsigned(8).let { if (it >= 0) it else it.toULong().toDouble() }
        0xd0 -> signed(1)
        0xd1 -> signed(2)
        0xd2 -> signed(4)
        0xd3 -> signed(8)
        0xd9 -> text(unsigned(1).toInt())
        0xda -> text(unsigned(2).toInt())
        0xdb -> text(length32())
        0xdc -> array(unsigned(2).toInt(), depth)
        0xdd -> array(length32(), depth)
        0xde -> map(unsigned(2).toInt(), depth)
        0xdf -> map(length32(), depth)
        else -> throw MsgPackException("the extension or reserved type 0x${tag.toString(16)} is not read")
      }
    }
  }
}

/**
 * A stored `nodes` field as the tree it holds: a plain map is the tree
 * already; bytes (base64 text or raw) are decoded; anything else, or bytes
 * that do not decode to a map, is null. Never throws: a document that cannot
 * be read is skipped, as the console's `decodeStoredNodes` does.
 */
@OptIn(ExperimentalEncodingApi::class)
fun decodeStoredNodes(raw: Any?): Map<String, Any?>? {
  @Suppress("UNCHECKED_CAST")
  return when (raw) {
    is Map<*, *> -> raw as Map<String, Any?>
    is ByteArray -> runCatching { decodeMsgPack(raw) as? Map<String, Any?> }.getOrNull()
    is String -> runCatching { decodeMsgPack(Base64.decode(raw)) as? Map<String, Any?> }.getOrNull()
    else -> null
  }
}
