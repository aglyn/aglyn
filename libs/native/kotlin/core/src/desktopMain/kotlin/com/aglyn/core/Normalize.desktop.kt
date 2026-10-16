package com.aglyn.core

import java.text.Normalizer

internal actual fun stripMarks(value: String): String =
  Normalizer.normalize(value, Normalizer.Form.NFKD).replace(Regex("[\\u0300-\\u036f]"), "")

internal actual fun sha256(bytes: ByteArray): ByteArray = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
