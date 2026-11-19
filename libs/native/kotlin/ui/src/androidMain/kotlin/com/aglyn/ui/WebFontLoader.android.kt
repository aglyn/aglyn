// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.ui

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.Font
import java.io.File
import java.security.MessageDigest

/** The JVM's temporary directory, which on Android is the app's own cache directory. */
private val fontDirectory: File by lazy { File(System.getProperty("java.io.tmpdir"), "aglyn-fonts").apply { mkdirs() } }

/** A cache file name for a key: a digest, so a family name or letters never become a path. */
private fun fileOf(key: String): File =
  File(fontDirectory, MessageDigest.getInstance("SHA-256").digest(key.encodeToByteArray()).joinToString("") { "%02x".format(it) } + ".font")

internal actual val webFontCache: WebFontCache = object : WebFontCache {
  override fun read(key: String): ByteArray? = fileOf(key).takeIf { it.isFile }?.readBytes()
  override fun write(key: String, bytes: ByteArray) {
    runCatching { fileOf(key).writeBytes(bytes) }
  }
}

internal actual fun webFontFamilyOf(key: String, bytes: ByteArray, weight: Int, italic: Boolean): FontFamily? = runCatching {
  val file = fileOf(key)
  if (!file.isFile) file.writeBytes(bytes)
  FontFamily(Font(file, FontWeight(weight.coerceIn(1, 1000)), if (italic) FontStyle.Italic else FontStyle.Normal))
}.getOrNull()
