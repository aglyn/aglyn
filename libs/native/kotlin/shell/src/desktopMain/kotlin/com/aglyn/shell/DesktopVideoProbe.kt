package com.aglyn.shell

import com.aglyn.ui.PickedFile
import com.aglyn.ui.VideoProbe
import com.aglyn.ui.VideoProbeResult

actual fun platformVideoProbe(): VideoProbe = DesktopVideoProbe

/** The JVM has no video decoder, so a film uploaded from the desktop says so and goes without a poster, as a browser that cannot decode one does. */
object DesktopVideoProbe : VideoProbe {
  override suspend fun probe(file: PickedFile): VideoProbeResult = VideoProbeResult(reason = "this device has no video decoder")
}
