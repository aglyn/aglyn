// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

/*
 * Where a font preview comes from (the fonts plugin's `font-preview-url.ts`, AGL-3656): Google's CSS2 API asked for only the
 * letters a preview draws, and the font files that stylesheet names. Replayed from the console's own cases; the shared font
 * loader (`com.aglyn.ui.WebFontLoader`) fetches them. The Swift kit's FontPreviewURL.swift holds the same.
 */

/** The letters one preview may ask for; Google refuses a very long `text=`. */
const val FONT_PREVIEW_MAX_LETTERS = 160

/**
 * `previewLetters`: the distinct letters of a text, in order, whitespace runs read as one space, capped (in UTF-16 units, as
 * the console's string slice counts them).
 */
fun fontPreviewLetters(text: String): String {
  val collapsed = text.replace(Regex("\\s+"), " ")
  val seen = mutableSetOf<Int>()
  val out = StringBuilder()
  var index = 0
  while (index < collapsed.length) {
    val codePoint = collapsed.codePointAtCompat(index)
    val width = if (codePoint > 0xFFFF) 2 else 1
    if (seen.add(codePoint)) out.append(collapsed, index, index + width)
    index += width
  }
  return if (out.length > FONT_PREVIEW_MAX_LETTERS) out.substring(0, FONT_PREVIEW_MAX_LETTERS) else out.toString()
}

private fun String.codePointAtCompat(index: Int): Int {
  val high = this[index]
  if (high.isHighSurrogate() && index + 1 < length) {
    val low = this[index + 1]
    if (low.isLowSurrogate()) return ((high.code - 0xD800) shl 10) + (low.code - 0xDC00) + 0x10000
  }
  return high.code
}

/** JavaScript's `encodeURIComponent`, over UTF-8. */
private fun uriComponent(value: String): String {
  val out = StringBuilder()
  for (byte in value.encodeToByteArray()) {
    val char = (byte.toInt() and 0xff).toChar()
    if (char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char in "-_.!~*'()") out.append(char)
    else out.append('%').append((byte.toInt() and 0xff).toString(16).uppercase().padStart(2, '0'))
  }
  return out.toString()
}

/** `previewSheetUrl`: Google's stylesheet URL for some letters of one face of a family. */
fun fontPreviewSheetUrl(family: String, weight: Int, italic: Boolean, text: String): String {
  val axis = if (italic) "ital,wght@1,$weight" else "wght@$weight"
  val name = uriComponent(family.trim()).replace("%20", "+")
  return "https://fonts.googleapis.com/css2?family=$name:$axis&text=${uriComponent(fontPreviewLetters(text))}&display=swap"
}

private val FONT_FILE_URL = Regex("""src:\s*url\((['"]?)(https://fonts\.gstatic\.com/[^)'"]+)\1\)""")

/** `previewFileUrls`: the file URLs a CSS2 stylesheet names, in order (only Google's own font host). */
fun fontPreviewFileUrls(css: String): List<String> = FONT_FILE_URL.findAll(css).map { it.groupValues[2] }.toList()
