// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0
//
// Apple's "How to Tap" merchant education for Tap to Pay on iPhone (AGL-3618).
// Apple requires it before an app enabling Tap to Pay is approved, and it is
// Apple's own localized content: ProximityReaderDiscovery fetches it and
// presents it over the topmost view controller. iOS 18 and later; earlier
// versions get the app's own fallback screens (the JS side asks isSupported).

import ExpoModulesCore
import ProximityReader
import UIKit

public class TapToPayEducationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TapToPayEducation")

    Function("isSupported") { () -> Bool in
      if #available(iOS 18.0, *) {
        return true
      }
      return false
    }

    AsyncFunction("showHowToTap") { (promise: Promise) in
      guard #available(iOS 18.0, *) else {
        promise.resolve(false)
        return
      }
      Task { @MainActor in
        do {
          let discovery = ProximityReaderDiscovery()
          let content = try await discovery.content(for: .payment(.howToTap))
          guard var top = TapToPayEducationModule.rootViewController() else {
            promise.resolve(false)
            return
          }
          while let presented = top.presentedViewController {
            top = presented
          }
          try await discovery.presentContent(content, from: top)
          promise.resolve(true)
        } catch {
          promise.reject("E_TAP_TO_PAY_EDUCATION", error.localizedDescription)
        }
      }
    }
  }

  @MainActor
  private static func rootViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
    return window?.rootViewController
  }
}
