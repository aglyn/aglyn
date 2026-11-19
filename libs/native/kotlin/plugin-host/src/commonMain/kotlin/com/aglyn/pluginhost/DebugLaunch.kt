package com.aglyn.pluginhost

/**
 * Debug builds only: launch extras the app copies in from its launch intent, under `BuildConfig.DEBUG`, for a plugin to
 * read (a settled Assist answer to drive an answer's controls without starting a run). Nothing writes it in a release
 * build, so there it is always empty.
 */
object DebugLaunch {
  /** The settled Assist exchange to open the panel on (`--es assistSettledAnswer <exchangeId>`). */
  var assistSettledAnswer: String? = null
}
