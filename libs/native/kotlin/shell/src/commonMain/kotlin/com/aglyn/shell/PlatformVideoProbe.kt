package com.aglyn.shell

import com.aglyn.ui.VideoProbe

/** The film upload path's decoder on this platform: Android's media retriever; the desktop has none and says so. */
expect fun platformVideoProbe(): VideoProbe
