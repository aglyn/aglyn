package com.aglyn.core

/** SHA-256 of [text]'s UTF-8 bytes as lowercase hex, as the console's `crypto.subtle.digest('SHA-256', …)` hex strings. */
fun sha256Hex(text: String): String = sha256(text.encodeToByteArray()).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
