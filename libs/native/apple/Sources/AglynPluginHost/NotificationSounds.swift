// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AVFoundation
import AglynContracts
import Foundation

/// One pickable notification sound (the shared contract's `NotificationSound`).
public typealias AglynNotificationSound = NotificationSound

/// The notification sounds a person picks from (AGL-3890): the shared list
/// (`NOTIFICATION_SOUNDS`, Xylophone first and the default), each a `.caf` in
/// both Apple apps' bundles that the APNs payload names.
public enum AglynNotificationSounds {
  public static var all: [NotificationSound] { ContractValues.shared.notificationSounds }
  public static var defaultID: String { ContractValues.shared.defaultNotificationSound }
  /// `users/{uid}.notificationSound`: the picked sound's id.
  public static var field: String { ContractValues.shared.notificationSoundField }

  /// The sound a stored value names, else the default (the server reads it the same way).
  public static func sound(for value: Any?) -> NotificationSound? {
    let id = value as? String
    return all.first { $0.id == id } ?? all.first { $0.id == defaultID } ?? all.first
  }

  /// The bundled file a sound plays from.
  public static func url(_ sound: NotificationSound, in bundle: Bundle = .main) -> URL? {
    let name = (sound.apple as NSString).deletingPathExtension
    let ext = (sound.apple as NSString).pathExtension
    return bundle.url(forResource: name, withExtension: ext.isEmpty ? "caf" : ext)
  }
}

/// Plays a picked sound once, for the picker's preview.
@MainActor
public final class AglynNotificationSoundPlayer {
  private var player: AVAudioPlayer?

  public init() {}

  /// Plays the sound's bundled file (nothing when this build does not ship it).
  public func play(_ sound: NotificationSound) {
    guard let url = AglynNotificationSounds.url(sound) else { return }
    player?.stop()
    #if os(iOS)
      // A preview plays with the ringer switch's say, as a notification would.
      try? AVAudioSession.sharedInstance().setCategory(.ambient)
    #endif
    player = try? AVAudioPlayer(contentsOf: url)
    player?.play()
  }
}
