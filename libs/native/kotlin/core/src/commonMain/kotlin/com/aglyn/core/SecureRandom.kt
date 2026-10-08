package com.aglyn.core

/** [count] bytes from the platform's cryptographically secure generator. */
expect fun secureRandomBytes(count: Int): ByteArray

/** [count] secure random bytes as lowercase hex: a webhook secret, as the console's `crypto.getRandomValues` makes one. */
fun secureRandomHex(count: Int): String = secureRandomBytes(count).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

private const val URL_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"

/** A document id the console's `createResourceUid` would mint: [length] characters of nanoid's URL alphabet. */
fun createResourceUid(length: Int = 10): String =
  secureRandomBytes(length).joinToString("") { URL_ALPHABET[it.toInt() and 63].toString() }
