package com.aglyn.ui

import androidx.compose.runtime.Composable

/** macOS's Reduce motion (System Settings › Accessibility › Display), read once; other desktops have no such switch. */
private val systemReducesMotion: Boolean by lazy {
  if (!System.getProperty("os.name").orEmpty().startsWith("Mac")) return@lazy false
  runCatching {
    val process = ProcessBuilder("defaults", "read", "com.apple.universalaccess", "reduceMotion").redirectErrorStream(true).start()
    val out = process.inputStream.bufferedReader().readText().trim()
    process.waitFor()
    out == "1"
  }.getOrDefault(false)
}

@Composable
actual fun reduceMotion(): Boolean = System.getProperty("aglyn.reduceMotion")?.toBoolean() ?: systemReducesMotion
