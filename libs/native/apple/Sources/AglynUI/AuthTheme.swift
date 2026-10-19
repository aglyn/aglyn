// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

/// One sign-in theme color, light and dark, as `0xRRGGBBAA` (AuthTheme.generated.swift).
public struct AglynAuthColor: Sendable {
  public let light: UInt32
  public let dark: UInt32

  public init(light: UInt32, dark: UInt32) {
    self.light = light
    self.dark = dark
  }

  /// The color that follows the appearance.
  public var color: Color { AglynColor.adaptive(light: Self.make(light), dark: Self.make(dark)) }

  /// The color for one appearance, for drawing that reads the scheme itself (a `Canvas`).
  public func resolved(dark isDark: Bool) -> Color { Self.make(isDark ? dark : light) }

  static func make(_ rgba: UInt32) -> Color {
    Color(
      .sRGB, red: Double((rgba >> 24) & 0xFF) / 255, green: Double((rgba >> 16) & 0xFF) / 255,
      blue: Double((rgba >> 8) & 0xFF) / 255, opacity: Double(rgba & 0xFF) / 255)
  }
}

/// How strong each Facets layer is in one appearance.
public struct AglynFacetsOpacity: Sendable {
  public let softLight: CGFloat
  public let top: CGFloat
  public let band: CGFloat
  public let corner: CGFloat
  public let accent: CGFloat
}

/// The sign-in screens' type steps (Figma text styles), in the bundled Roboto Flex and scaled with Dynamic Type. The
/// face is variable, and SwiftUI's `.weight` does not move its `wght` axis, so each step sets the axis itself.
public enum AglynAuthFont {
  private static func face(_ size: CGFloat, _ wght: CGFloat, _ style: Font.TextStyle) -> Font {
    #if canImport(UIKit)
      let textStyle: UIFont.TextStyle =
        switch style {
        case .title: .title1
        case .headline: .headline
        case .subheadline: .subheadline
        case .footnote: .footnote
        case .caption: .caption1
        default: .body
        }
      guard let base = UIFont(name: AglynTokens.fontPostScriptName, size: size) else {
        return .system(size: size, weight: weight(wght))
      }
      let descriptor = base.fontDescriptor.addingAttributes([
        UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wghtAxis: wght]
      ])
      return Font(UIFontMetrics(forTextStyle: textStyle).scaledFont(for: UIFont(descriptor: descriptor, size: size)))
    #else
      guard let base = NSFont(name: AglynTokens.fontPostScriptName, size: size) else {
        return .system(size: size, weight: weight(wght))
      }
      let descriptor = base.fontDescriptor.addingAttributes([
        NSFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wghtAxis: wght]
      ])
      return Font(NSFont(descriptor: descriptor, size: size) ?? base)
    #endif
  }

  /// 'wght' as a four-character axis tag.
  private static let wghtAxis = 0x7767_6874

  private static func weight(_ wght: CGFloat) -> Font.Weight {
    wght >= 700 ? .bold : wght >= 600 ? .semibold : wght >= 500 ? .medium : .regular
  }

  /// Phone/Title, 28/34 bold: a screen's heading.
  public static var title: Font { face(28, 700, .title) }
  /// Body/Regular, 14/20: the line under a heading.
  public static var body: Font { face(14, 400, .body) }
  /// Phone/Body, 17/22: a field's value.
  public static var value: Font { face(17, 400, .body) }
  /// Phone/Headline, 17/22 semibold: a large button's label.
  public static var headline: Font { face(17, 600, .headline) }
  /// Body/Strong, 14/20 semibold: a medium button's label.
  public static var strong: Font { face(14, 600, .subheadline) }
  /// Body/Small, 13/18: footer lines and the "or" divider.
  public static var small: Font { face(13, 400, .footnote) }
  /// Body/Small Strong, 13/18 semibold: field labels and text links.
  public static var smallStrong: Font { face(13, 600, .footnote) }
  /// Caption/Regular, 12/16: field messages and the legal line.
  public static var caption: Font { face(12, 400, .caption) }
  /// Roboto Medium 15/20, Google's button label (Google Identity branding).
  public static var google: Font { face(15, 500, .subheadline) }
}

extension AglynAuthTokens.Colors {
  /// The brand gradient's stops as SwiftUI stops.
  public static var gradientStops: [Gradient.Stop] {
    AglynAuthTokens.gradientStops.map { stop in
      Gradient.Stop(color: AglynAuthColor.make(stop.rgb << 8 | 0xFF), location: stop.at)
    }
  }
}
