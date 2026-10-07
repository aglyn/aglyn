// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreText
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// The console's typeface, bundled in AglynUI's resources.
public enum AglynFonts {
  /// Registers the bundled Roboto Flex for this process. Call once at launch,
  /// before the first view draws; until then `Font.custom` falls back to the system face.
  @MainActor
  public static func register() {
    guard !registered,
      let url = Bundle.module.url(forResource: "RobotoFlex-Variable", withExtension: "ttf", subdirectory: "Fonts")
    else { return }
    registered = true
    CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    #if os(iOS)
      styleNavigationBars()
    #endif
  }

  @MainActor private static var registered = false

  #if os(iOS)
    /// Navigation bar titles are the one place SwiftUI takes its face from
    /// UIKit. The bar reads its title fonts from its `UINavigationBarAppearance`
    /// objects (the legacy `largeTitleTextAttributes` is ignored once one is
    /// set), so the face goes on each: the standard and compact bars keep the
    /// system's default background, the scroll-edge bar its transparent one.
    @MainActor
    static func styleNavigationBars() {
      let large = AglynTokens.Typography.h3
      let inline = AglynTokens.Typography.h6
      guard let largeFace = UIFont(name: AglynTokens.fontPostScriptName, size: large.size),
        let inlineFace = UIFont(name: AglynTokens.fontPostScriptName, size: inline.size)
      else { return }
      let largeTitle: [NSAttributedString.Key: Any] = [
        .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: largeFace.withWeight(700))
      ]
      let title: [NSAttributedString.Key: Any] = [
        .font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: inlineFace.withWeight(600))
      ]
      let standard = UINavigationBarAppearance()
      standard.configureWithDefaultBackground()
      let edge = UINavigationBarAppearance()
      edge.configureWithTransparentBackground()
      for appearance in [standard, edge] {
        appearance.largeTitleTextAttributes = largeTitle
        appearance.titleTextAttributes = title
      }
      let bar = UINavigationBar.appearance()
      bar.standardAppearance = standard
      bar.compactAppearance = standard
      bar.scrollEdgeAppearance = edge
      bar.compactScrollEdgeAppearance = edge
      bar.largeTitleTextAttributes = largeTitle
      bar.titleTextAttributes = title
    }
  #endif
}

#if canImport(UIKit)
  extension UIFont {
    /// The variable face at a `wght` axis value.
    fileprivate func withWeight(_ wght: CGFloat) -> UIFont {
      // 'wght' as a four-character axis tag.
      let axis = 0x7767_6874
      let descriptor = fontDescriptor.addingAttributes([
        UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [axis: wght]
      ])
      return UIFont(descriptor: descriptor, size: pointSize)
    }
  }
#endif

/// The app's text styles, each a step of the console's type scale (Roboto
/// Flex, scaled with Dynamic Type), named for where SwiftUI uses them.
public enum AglynFont {
  public typealias Scale = AglynTokens.Typography
  public static var largeTitle: Font { Scale.h1.font }
  public static var title: Font { Scale.h3.font }
  public static var title2: Font { Scale.h5.font }
  public static var headline: Font { Scale.h6.font }
  public static var body: Font { Scale.body1.font }
  public static var subheadline: Font { Scale.body2.font }
  public static var strongSubheadline: Font { Scale.subtitle2.font }
  public static var caption: Font { Scale.caption.font }
  public static var button: Font { Scale.button.font }
  /// A big figure on a dashboard card.
  public static var figure: Font { Scale.h2.font }
}

/// The brand artwork from the console's brand kit (generated into Brand.xcassets), with dark appearances.
public enum AglynArtwork {
  /// The mark alone.
  public static var mark: Image { Image("AglynMark", bundle: .module) }
  /// The mark with the wordmark.
  public static var logo: Image { Image("AglynLogo", bundle: .module) }
  /// The wordmark alone.
  public static var wordmark: Image { Image("AglynWordmark", bundle: .module) }
}
