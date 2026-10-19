package com.aglyn.shell

internal actual val isMacPlatform: Boolean = System.getProperty("os.name").orEmpty().startsWith("Mac")
internal actual val hasMenuBar: Boolean = true
internal actual val appSetsTextSize: Boolean = true
