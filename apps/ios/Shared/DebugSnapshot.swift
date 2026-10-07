// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if DEBUG && os(macOS)
  import AppKit

  /// Debug builds on the Mac: `-AglynSnapshot <path.png>` writes the key
  /// window's contents to a PNG after `-AglynSnapshotDelay` seconds (default
  /// 8), then quits. It draws the app's own window, so it needs no
  /// screen-recording permission; used for the README screenshots.
  enum DebugSnapshot {
    @MainActor
    static func scheduleIfAsked() {
      let defaults = UserDefaults.standard
      guard let path = defaults.string(forKey: "AglynSnapshot"), !path.isEmpty else { return }
      let delay = defaults.double(forKey: "AglynSnapshotDelay")
      DispatchQueue.main.asyncAfter(deadline: .now() + (delay > 0 ? delay : 8)) {
        for window in NSApp.windows {
          print("Aglyn snapshot: window \(window.title) \(window.frame) visible=\(window.isVisible) \(String(describing: window.contentView))")
        }
        guard let window = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil }),
          let view = window.contentView?.superview ?? window.contentView
        else { return NSApp.terminate(nil) }
        let scale = window.backingScaleFactor
        let size = view.bounds.size
        guard
          let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0),
          let context = NSGraphicsContext(bitmapImageRep: rep)
        else { return NSApp.terminate(nil) }
        rep.size = size
        let cg = context.cgContext
        cg.scaleBy(x: scale, y: scale)
        // The window's layer tree, drawn the way the compositor sees it.
        if let layer = view.layer {
          cg.translateBy(x: 0, y: size.height)
          cg.scaleBy(x: 1, y: -1)
          layer.render(in: cg)
        } else {
          NSGraphicsContext.current = context
          view.displayIgnoringOpacity(view.bounds, in: context)
        }
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
        NSApp.terminate(nil)
      }
    }
  }
#endif
