// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

// The phone's bold brand look (AGL-3990), as shared pieces a phone screen adopts. Each one draws its bold form only
// while `AglynThemeRuntime.shared.phoneBold` is on (the Aglyn theme, in the brand blue, on a phone) and its everyday
// form otherwise, so an iPad, a Mac and the POS register never change. Figma: the Native App file's Phone page (2:7),
// whose frames carry the Theme mode "Aglyn · phone (bold) 10/19".

/// The brand gradient, 242° #00B0FF → #7A5CF0 at 55% → #E040FB (the Brand Guidelines; Figma `Brand/Gradient 242°`),
/// across whatever box it fills.
public enum AglynBrandGradient {
  /// The gradient's stops, from the generated auth tokens (the same stops the sign-in Facets draw).
  public static var stops: [Gradient.Stop] { AglynAuthTokens.Colors.gradientStops }

  /// How strongly a glow of the gradient shows (Figma "Header glow" and "AI glow"): 30% in light, 42% in dark.
  public static func glowOpacity(dark: Bool) -> Double { dark ? 0.42 : 0.30 }

  /// The gradient across a box, at the brand's angle.
  public static var linear: LinearGradient { gradient(stops) }

  /// The gradient's wash (Figma `Brand/Gradient 242° · Wash`): every stop at 14%, a tint for a quiet surface.
  public static var wash: LinearGradient {
    gradient(stops.map { Gradient.Stop(color: $0.color.opacity(36.0 / 255), location: $0.location) })
  }

  private static func gradient(_ stops: [Gradient.Stop]) -> LinearGradient {
    let line = AglynFacetsLayout.gradientLine(in: CGRect(x: 0, y: 0, width: 1, height: 1))
    return LinearGradient(
      stops: stops, startPoint: UnitPoint(x: line.start.x, y: line.start.y), endPoint: UnitPoint(x: line.end.x, y: line.end.y))
  }
}

/// A phone screen's ground: the page color, and in the bold look the brand's soft glow behind the top bar and the
/// title (Figma "Header glow": a 640 by 300 point ellipse of the gradient centered on the screen's top edge, blurred,
/// at 30% in light and 42% in dark).
public struct AglynPhoneGround: View {
  @Environment(\.colorScheme) private var scheme

  public init() {}

  public var body: some View {
    // The glow is anchored to the SCREEN's top edge, wherever this ground begins: a screen whose ground starts under
    // the navigation bar (Orders) then continues the shell's one glow rather than drawing a second band of its own.
    GeometryReader { proxy in
      AglynColor.page
        .overlay(alignment: .top) {
          if AglynThemeRuntime.shared.phoneBold {
            Ellipse()
              .fill(AglynBrandGradient.linear)
              .frame(width: 640, height: 300)
              .offset(y: -150 - max(0, proxy.frame(in: .global).minY))
              .blur(radius: 40)
              .opacity(AglynBrandGradient.glowOpacity(dark: scheme == .dark))
              .allowsHitTesting(false)
              .accessibilityHidden(true)
          }
        }
        .clipped()
    }
  }
}

extension View {
  /// A phone screen's ground behind everything, under the bars too: `AglynPhoneGround`.
  public func aglynPhoneGround() -> some View {
    background { AglynPhoneGround().ignoresSafeArea() }
  }

  /// The paper panel a phone screen's list sits on under the title. In the bold look its top corners round by 20
  /// points, so the ground and its glow show above it (Figma Menu and Orders, "Content").
  public func aglynPhonePanel() -> some View { modifier(AglynPhonePanel()) }

  /// The scope chip's capsule (Figma Phone/Scope chip): the sunken fill, no border; in the bold look the raised paper
  /// with a hairline, so it stands on the tinted header.
  public func aglynPhoneChip() -> some View { modifier(AglynPhoneChip()) }
}

struct AglynPhoneChip: ViewModifier {
  func body(content: Content) -> some View {
    if AglynThemeRuntime.shared.phoneBold {
      content
        .background(Capsule().fill(AglynColor.paper))
        .overlay(Capsule().strokeBorder(AglynColor.divider, lineWidth: 1))
    } else {
      content.background(Capsule().fill(AglynColor.sunken))
    }
  }
}

struct AglynPhonePanel: ViewModifier {
  func body(content: Content) -> some View {
    if AglynThemeRuntime.shared.phoneBold {
      let shape = UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20, style: .continuous)
      content.background { shape.fill(AglynColor.paper) }.clipShape(shape)
    } else {
      content.background(AglynColor.paper, ignoresSafeAreaEdges: [])
    }
  }
}

/// A phone Menu row's leading icon (Figma Phone/List row). In the bold look: the glyph in the accent's text shade on
/// a 30-point tile of the accent's wash, radius 8. Otherwise the 22-point line icon in the accent.
public struct AglynPhoneRowIcon: View {
  let systemName: String

  public init(systemName: String) { self.systemName = systemName }

  public var body: some View {
    if AglynThemeRuntime.shared.phoneBold {
      Image(systemName: systemName)
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(AglynColor.tint)
        .frame(width: 30, height: 30)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(AglynColor.accentSoft))
    } else {
      Image(systemName: systemName).font(.system(size: 18)).foregroundStyle(AglynColor.accentIcon)
        .frame(width: 22, height: 22)
    }
  }
}

/// The AI entry's sparkle: in the bold look it wears the brand gradient (Figma's ✦ in the top bar and on Menu's AI
/// card); otherwise the accent icon shade.
public struct AglynAIGlyph: View {
  let size: CGFloat

  public init(size: CGFloat = 17) { self.size = size }

  public var body: some View {
    if AglynThemeRuntime.shared.phoneBold {
      Image(systemName: "sparkles").font(.system(size: size)).foregroundStyle(AglynBrandGradient.linear)
    } else {
      Image(systemName: "sparkles").font(.system(size: size)).foregroundStyle(AglynColor.accentIcon)
    }
  }
}

/// The highlight role (Figma `highlight/soft`, `/icon`, `/text`): the brand pink, the theme's secondary intent. Soft is the
/// color at 16%, as the contract's `deriveAccent` makes every soft fill. The AI's context chip and its suggestion marks
/// wear it in the bold look.
public enum AglynHighlight {
  public static let icon = AglynColor.intent({ $0.secondary }, \.main)
  public static let text = AglynColor.secondary
  public static let soft = AglynColor.intent({ $0.secondary }, \.main).opacity(0.16)
}

/// The AI sheet's glow (Figma "AI glow" 283:25261): the brand gradient as a 560 by 220 point ellipse centered on the
/// sheet's top edge, blurred, at the header glow's strength. Drawn only in the bold look; put it behind the sheet's content.
public struct AglynAIGlow: View {
  @Environment(\.colorScheme) private var scheme

  public init() {}

  public var body: some View {
    if AglynThemeRuntime.shared.phoneBold {
      Ellipse()
        .fill(AglynBrandGradient.linear)
        .frame(width: AglynSpace.of(70), height: AglynSpace.of(27.5))
        .offset(y: -AglynSpace.of(13.75))
        .blur(radius: AglynSpace.of(5))
        .opacity(AglynBrandGradient.glowOpacity(dark: scheme == .dark))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }
}

#if os(iOS)
  /// The phone's tab bar (Figma Phone/Tab item). Everyday: a grey line icon and secondary label at rest, the accent icon
  /// and primary label when in use. Bold: the tab in use is a #00B0FF pill with a WHITE icon and its label bold in the
  /// accent's text shade; the rest are muted; Create is the brand gradient.
  @MainActor
  public enum AglynPhoneTabBar {
    /// Styles every tab bar from the theme in force.
    public static func style() {
      let bold = AglynThemeRuntime.shared.phoneBold
      let item = UITabBarItemAppearance()
      item.normal.iconColor = UIColor(AglynColor.textTertiary)
      item.normal.titleTextAttributes = [
        .foregroundColor: UIColor(bold ? AglynColor.textTertiary : AglynColor.secondaryText),
        .font: UIFont.systemFont(ofSize: 10, weight: .medium),
      ]
      item.selected.iconColor = UIColor(AglynColor.primary)
      item.selected.titleTextAttributes = [
        .foregroundColor: UIColor(bold ? AglynColor.tint : AglynColor.textPrimary),
        .font: UIFont.systemFont(ofSize: 10, weight: bold ? .bold : .medium),
      ]
      item.normal.badgeBackgroundColor = UIColor(AglynColor.primary)
      item.normal.badgeTextAttributes = [.foregroundColor: UIColor(AglynColor.primaryContrast)]
      let appearance = UITabBarAppearance()
      appearance.configureWithDefaultBackground()
      appearance.stackedLayoutAppearance = item
      appearance.inlineLayoutAppearance = item
      appearance.compactInlineLayoutAppearance = item
      UITabBar.appearance().standardAppearance = appearance
      UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    /// Create new's tile: a white "+" on a 48 by 36 point tile, radius 12, on the brand gradient in the bold look and
    /// the accent otherwise.
    public static var createTile: UIImage? {
      let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
      let glyph = Image(systemName: "plus").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white)
        .frame(width: 48, height: 36)
      let tile = Group {
        if AglynThemeRuntime.shared.phoneBold {
          glyph.background(shape.fill(AglynBrandGradient.linear))
        } else {
          glyph.background(shape.fill(AglynColor.primary))
        }
      }
      return render(tile)
    }

    /// The tab in use, in the bold look: its line icon in white on a 52 by 28 point #00B0FF pill; nil otherwise, when
    /// the tab bar tints the icon itself.
    public static func activeIcon(_ systemName: String) -> UIImage? {
      guard AglynThemeRuntime.shared.phoneBold else { return nil }
      let pill = Image(systemName: systemName)
        .symbolVariant(.none)
        .font(.system(size: 18, weight: .medium))
        .foregroundStyle(AglynColor.primaryContrast)
        .frame(width: 52, height: 28)
        .background(Capsule().fill(AglynColor.primary))
      return render(pill)
    }

    private static func render(_ view: some View) -> UIImage? {
      let renderer = ImageRenderer(content: view)
      renderer.scale = 3
      return renderer.uiImage?.withRenderingMode(.alwaysOriginal)
    }
  }
#endif
