// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

/// The light or dark a window is drawn in: the account's Appearance (Light, Dark or System), with Night always dark.
///
/// SwiftUI's `preferredColorScheme` cannot be trusted to go back to System: once it has set Dark, a later `nil` leaves
/// the override it wrote on the window and its hosting controller in place, so the app stayed dark on a light device
/// (AGL-4010). The shells apply this instead, and System clears every override back to the platform's own.
public enum AglynAppearance: Equatable, Sendable {
  case system, light, dark

  /// The appearance for an account's choice: `appearance` is the contract's raw value (`light`, `dark`, `system`;
  /// anything else, an older or newer value, follows the system), `forcesDark` a theme that is dark in both (Night).
  public init(appearance raw: String, forcesDark: Bool) {
    if forcesDark {
      self = .dark
      return
    }
    switch raw {
    case "light": self = .light
    case "dark": self = .dark
    default: self = .system
    }
  }

  /// The SwiftUI scheme, nil for the system's.
  public var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }

  #if os(iOS)
    /// The window override: `.unspecified` hands the window back to the device's setting.
    public var userInterfaceStyle: UIUserInterfaceStyle {
      switch self {
      case .system: .unspecified
      case .light: .light
      case .dark: .dark
      }
    }
  #endif

  #if os(macOS)
    /// The app's appearance name; nil follows the system.
    public var appearanceName: NSAppearance.Name? {
      switch self {
      case .system: nil
      case .light: .aqua
      case .dark: .darkAqua
      }
    }
  #endif
}

extension View {
  /// Draws this scene's window, and everything presented in it (sheets, popovers, full-screen covers), in
  /// `appearance`. On iOS it sets the window's own override and clears any a view controller in it still holds; on the
  /// Mac it sets the app's appearance and clears each window's, so System always reaches the device's setting.
  /// `apply: false` leaves the platform alone (a debug launch that pins an appearance for screenshots).
  public func aglynWindowAppearance(_ appearance: AglynAppearance, apply: Bool = true) -> some View {
    background(AglynWindowAppearanceProbe(appearance: appearance, apply: apply).frame(width: 0, height: 0))
  }
}

#if os(iOS)
  private struct AglynWindowAppearanceProbe: UIViewRepresentable {
    let appearance: AglynAppearance
    let apply: Bool

    func makeUIView(context: Context) -> ProbeView {
      let view = ProbeView()
      view.isUserInteractionEnabled = false
      view.isHidden = true
      return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
      view.style = apply ? appearance.userInterfaceStyle : nil
    }

    final class ProbeView: UIView {
      var style: UIUserInterfaceStyle? {
        didSet { applyStyle() }
      }

      override func didMoveToWindow() {
        super.didMoveToWindow()
        applyStyle()
      }

      private func applyStyle() {
        guard let style, let window else { return }
        // After SwiftUI's update pass, so the trait change it causes lands as its own update.
        DispatchQueue.main.async { AglynWindowAppearanceApplier.apply(style, to: window) }
      }
    }
  }

  @MainActor
  enum AglynWindowAppearanceApplier {
    /// The window carries the style; every view controller in it (the hosting controller, what it presents, their
    /// children) is cleared, so none keeps a Dark it was given earlier.
    static func apply(_ style: UIUserInterfaceStyle, to window: UIWindow) {
      if window.overrideUserInterfaceStyle != style { window.overrideUserInterfaceStyle = style }
      var seen = Set<ObjectIdentifier>()
      var stack: [UIViewController] = window.rootViewController.map { [$0] } ?? []
      while let controller = stack.popLast() {
        guard seen.insert(ObjectIdentifier(controller)).inserted else { continue }
        if controller.overrideUserInterfaceStyle != .unspecified { controller.overrideUserInterfaceStyle = .unspecified }
        stack.append(contentsOf: controller.children)
        if let presented = controller.presentedViewController { stack.append(presented) }
      }
    }
  }
#elseif os(macOS)
  private struct AglynWindowAppearanceProbe: NSViewRepresentable {
    let appearance: AglynAppearance
    let apply: Bool

    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ view: NSView, context: Context) {
      guard apply else { return }
      let name = appearance.appearanceName
      DispatchQueue.main.async {
        let next = name.flatMap(NSAppearance.init(named:))
        if NSApp.appearance?.name != next?.name { NSApp.appearance = next }
        for window in NSApp.windows where window.appearance != nil { window.appearance = nil }
      }
    }
  }
#endif
