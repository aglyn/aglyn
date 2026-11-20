// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.text.font.FontFamily
import com.aglyn.core.defaultHttpClient
import com.aglyn.core.fontPreviewFileUrls
import com.aglyn.core.fontPreviewLetters
import com.aglyn.core.fontPreviewSheetUrl
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readRawBytes
import io.ktor.http.isSuccess

/**
 * A Google font face drawn in its own letters, as the console's font picker draws each family (the fonts plugin's
 * `loadFontPreview`, AGL-3656): the stylesheet for only the letters asked, from the same Google Fonts source, the file it
 * names fetched on demand and kept in the app's cache, then made a [FontFamily]. Every screen asks this one loader; while a
 * face loads, offline, or when anything fails, the caller draws the system font. The Swift kit's `WebFontLoader`.
 */
object WebFontLoader {
  private val faces = mutableStateMapOf<String, FontFamily>()
  private val loading = mutableSetOf<String>()
  private val http: HttpClient by lazy { defaultHttpClient() }

  /** The key one face of some letters is remembered by. */
  fun key(family: String, weight: Int, italic: Boolean, text: String): String =
    "${family.lowercase()}|$weight|${if (italic) "italic" else "normal"}|${fontPreviewLetters(text)}"

  /** The face to draw [text] in, or null while it loads or when it cannot (draw the system font then). */
  fun face(family: String, weight: Int, italic: Boolean, text: String): FontFamily? = faces[key(family, weight, italic, text)]

  /** Loads the face once; [face] answers it when it lands, and the composition reads it again. */
  suspend fun load(family: String, weight: Int, italic: Boolean, text: String) {
    val key = key(family, weight, italic, text)
    if (key in faces || !loading.add(key)) return
    try {
      val bytes = webFontCache.read(key) ?: fetch(family, weight, italic, text)?.also { webFontCache.write(key, it) } ?: return
      // A failure is forgotten, so the face is asked again the next time it is drawn.
      webFontFamilyOf(key, bytes, weight, italic)?.let { faces[key] = it }
    } catch (error: kotlinx.coroutines.CancellationException) {
      throw error
    } catch (_: Exception) {
    } finally {
      loading.remove(key)
    }
  }

  private suspend fun fetch(family: String, weight: Int, italic: Boolean, text: String): ByteArray? {
    val sheet = http.get(fontPreviewSheetUrl(family, weight, italic, text))
    if (!sheet.status.isSuccess()) return null
    val url = fontPreviewFileUrls(sheet.bodyAsText()).firstOrNull() ?: return null
    val file = http.get(url)
    return if (file.status.isSuccess()) file.readRawBytes() else null
  }
}

/** The face [WebFontLoader] loaded for [text], the system font in the meantime; asking starts the load. */
@Composable
fun rememberWebFontFamily(family: String?, weight: Int, italic: Boolean = false, text: String): FontFamily? {
  if (family.isNullOrBlank() || text.isEmpty()) return null
  LaunchedEffect(family, weight, italic, text) { WebFontLoader.load(family, weight, italic, text) }
  return WebFontLoader.face(family, weight, italic, text)
}

/** Where loaded font files are kept between launches: the platform's cache directory. */
internal interface WebFontCache {
  fun read(key: String): ByteArray?
  fun write(key: String, bytes: ByteArray)
}

internal expect val webFontCache: WebFontCache

/**
 * A font file's bytes as a family Compose draws with, the face named at its own [weight] and style so Compose never
 * synthesizes bold or italic over it; null for bytes the platform cannot read.
 */
internal expect fun webFontFamilyOf(key: String, bytes: ByteArray, weight: Int, italic: Boolean): FontFamily?
