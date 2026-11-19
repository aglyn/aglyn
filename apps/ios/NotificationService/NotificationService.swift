// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AudioToolbox
import Foundation
import UserNotifications

/// Plays the person's picked notification sound on the Mac (AGL-4215).
///
/// macOS 26.6 never plays an app's own notification sound: a push naming `aglyn-xylophone.caf` gets the system's
/// built-in sound 22 instead, whether the file is in the app's bundle or its container's `Library/Sounds`. The server
/// marks every Apple push `mutable-content`, so each one passes through here first, with the app in front, behind or
/// quit. When the push names one of Aglyn's sounds and the person has sounds on for Aglyn, this plays that file and
/// hands the banner on without a sound (and without `aps.sound`, so the app in front does not play it again). Anything
/// else goes on unchanged.
final class NotificationService: UNNotificationServiceExtension {
  private let lock = NSLock()
  private var deliver: ((UNNotificationContent) -> Void)?
  private var original: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    lock.withLock {
      deliver = contentHandler
      original = request.content
    }
    guard let file = Self.soundFile(in: request.content.userInfo), let url = Self.url(for: file),
      let content = request.content.mutableCopy() as? UNMutableNotificationContent
    else {
      finish(request.content)
      return
    }
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      // Sounds off for Aglyn in System Settings: the system already plays nothing, so leave it to the system.
      guard settings.soundSetting == .enabled else {
        self.finish(request.content)
        return
      }
      content.sound = nil
      var info = content.userInfo
      if var aps = info["aps"] as? [String: Any] {
        aps.removeValue(forKey: "sound")
        info["aps"] = aps
      }
      content.userInfo = info
      Self.play(url)
      self.finish(content)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    let content = lock.withLock { original }
    if let content { finish(content) }
  }

  /// Hands the banner on once; later calls do nothing.
  private func finish(_ content: UNNotificationContent) {
    let handler = lock.withLock {
      let handler = deliver
      deliver = nil
      return handler
    }
    handler?(content)
  }

  /// The push's `aps.sound` when it names one of Aglyn's sounds (`aglyn-<id>.caf`), else nil.
  static func soundFile(in userInfo: [AnyHashable: Any]) -> String? {
    guard let aps = userInfo["aps"] as? [String: Any], let file = aps["sound"] as? String,
      file.hasPrefix("aglyn-"), !file.contains("/")
    else { return nil }
    return file
  }

  /// The sound's file: copied into this extension's bundle at build time, else the app's own copy beside it.
  static func url(for file: String) -> URL? {
    let name = (file as NSString).deletingPathExtension
    let ext = (file as NSString).pathExtension
    if let own = Bundle.main.url(forResource: name, withExtension: ext) { return own }
    // Aglyn.app/Contents/PlugIns/<extension>.appex → Aglyn.app/Contents/Resources
    let resources = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("Resources").appendingPathComponent(file)
    return FileManager.default.fileExists(atPath: resources.path) ? resources : nil
  }

  /// Plays the file at the system's alert volume. The system sound server plays it, so it finishes even after the
  /// banner is handed on.
  static func play(_ url: URL) {
    var id: SystemSoundID = 0
    guard AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError else { return }
    AudioServicesPlaySystemSoundWithCompletion(id) { AudioServicesDisposeSystemSoundID(id) }
  }
}
