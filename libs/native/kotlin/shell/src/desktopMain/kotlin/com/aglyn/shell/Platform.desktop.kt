package com.aglyn.shell

internal actual val isMacPlatform: Boolean = System.getProperty("os.name").orEmpty().startsWith("Mac")
