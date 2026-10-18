// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

private typealias C = AglynAuthTokens.Colors
private typealias M = AglynAuthTokens.Metrics

/// The button system (Figma "Button" 8:486): one look per kind, three sizes, the hover and pressed fills, 40% when
/// disabled. Sign-in screens use `.large`; a busy button keeps its label and width and swaps its icon for a spinner.
public enum AglynButtonKind: Sendable {
  case primary, secondary, tertiary, destructive
}

public enum AglynButtonSize: Sendable {
  case large, medium, small

  var height: CGFloat {
    switch self {
    case .large: AglynAuthTokens.Metrics.buttonHeight
    case .medium: AglynAuthTokens.Metrics.buttonMediumHeight
    case .small: 28
    }
  }

  var radius: CGFloat {
    self == .large ? AglynAuthTokens.Metrics.buttonRadius : AglynAuthTokens.Metrics.buttonMediumRadius
  }

  var padding: CGFloat {
    switch self {
    case .large: AglynAuthTokens.Metrics.buttonPadding
    case .medium: AglynAuthTokens.Metrics.buttonMediumPadding
    case .small: 10
    }
  }

  var gap: CGFloat {
    switch self {
    case .large: AglynAuthTokens.Metrics.buttonIconGap
    case .medium: 8
    case .small: 6
    }
  }

  var icon: CGFloat {
    switch self {
    case .large: AglynAuthTokens.Metrics.buttonIcon
    case .medium: 16
    case .small: 14
    }
  }

  var font: Font {
    switch self {
    case .large: AglynAuthFont.headline
    case .medium: AglynAuthFont.strong
    case .small: AglynAuthFont.smallStrong
    }
  }
}

public struct AglynButtonStyle: ButtonStyle {
  let kind: AglynButtonKind
  let size: AglynButtonSize
  let fullWidth: Bool

  public init(_ kind: AglynButtonKind, size: AglynButtonSize = .large, fullWidth: Bool = true) {
    self.kind = kind
    self.size = size
    self.fullWidth = fullWidth
  }

  public func makeBody(configuration: Configuration) -> some View {
    StyledButton(configuration: configuration, kind: kind, size: size, fullWidth: fullWidth)
  }

  private struct StyledButton: View {
    let configuration: Configuration
    let kind: AglynButtonKind
    let size: AglynButtonSize
    let fullWidth: Bool
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false

    private var fill: Color {
      let pressed = configuration.isPressed
      switch kind {
      case .primary: return (pressed ? C.primaryPressed : hovering ? C.primaryHover : C.primary).color
      case .secondary: return (pressed ? C.secondaryPressed : hovering ? C.secondaryHover : C.secondaryFill).color
      case .tertiary: return pressed ? C.sunken.color : hovering ? C.hover.color : .clear
      case .destructive:
        return (pressed ? C.destructivePressed : hovering ? C.destructiveHover : C.destructive).color
      }
    }

    private var ink: Color {
      switch kind {
      case .primary, .destructive: C.onPrimary.color
      case .secondary, .tertiary: C.textPrimary.color
      }
    }

    var body: some View {
      let shape = RoundedRectangle(cornerRadius: size.radius, style: .continuous)
      configuration.label
        .font(size.font)
        .foregroundStyle(ink)
        .lineLimit(2)
        .multilineTextAlignment(.center)
        .padding(.horizontal, size.padding)
        .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: size.height)
        .background(fill, in: shape)
        .overlay {
          if kind == .secondary { shape.strokeBorder(C.secondaryStroke.color, lineWidth: 1) }
        }
        .contentShape(shape)
        .opacity(enabled ? 1 : AglynAuthTokens.Metrics.disabledOpacity)
        .onHover { hovering = $0 }
        .environment(\.aglynButtonIconSize, size.icon)
        .environment(\.aglynButtonGap, size.gap)
        .environment(\.aglynButtonInk, ink)
    }
  }
}

extension EnvironmentValues {
  @Entry var aglynButtonIconSize: CGFloat = AglynAuthTokens.Metrics.buttonIcon
  @Entry var aglynButtonGap: CGFloat = AglynAuthTokens.Metrics.buttonIconGap
  @Entry var aglynButtonInk: Color = .primary
}

/// A button's label: its icon (an SF Symbol, or any image) and title. Busy, a spinner the icon's size takes the icon's
/// place and the title stays, so the button keeps its width.
public struct AglynButtonLabel<Icon: View>: View {
  let title: String
  let busy: Bool
  let icon: Icon?
  @Environment(\.aglynButtonIconSize) private var iconSize
  @Environment(\.aglynButtonGap) private var gap
  @Environment(\.aglynButtonInk) private var ink

  public init(_ title: String, busy: Bool = false, @ViewBuilder icon: () -> Icon) {
    self.title = title
    self.busy = busy
    self.icon = icon()
  }

  public var body: some View {
    HStack(spacing: gap) {
      if busy {
        ProgressView()
          .controlSize(.small)
          .tint(ink)
          .frame(width: iconSize, height: iconSize)
          .accessibilityLabel("Working")
      } else if let icon {
        icon.frame(width: iconSize, height: iconSize)
      }
      Text(title)
    }
  }
}

extension AglynButtonLabel where Icon == AnyView {
  /// A title alone (and the spinner beside it while busy).
  public init(_ title: String, busy: Bool = false) {
    self.title = title
    self.busy = busy
    self.icon = nil
  }

  /// A title after an SF Symbol.
  public init(_ title: String, systemImage: String, busy: Bool = false) {
    self.title = title
    self.busy = busy
    self.icon = AnyView(Image(systemName: systemImage).resizable().scaledToFit())
  }
}

/// "Continue with Google" as Google's branding guidelines draw it: the official four-color G (never recolored), Roboto
/// Medium, Google's light button on a light ground and its dark one on a dark ground, at the provider buttons' height,
/// radius and padding.
public struct AglynGoogleButtonStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    GoogleButton(configuration: configuration)
  }

  private struct GoogleButton: View {
    let configuration: Configuration
    @Environment(\.isEnabled) private var enabled

    var body: some View {
      let shape = RoundedRectangle(cornerRadius: AglynAuthTokens.Metrics.buttonRadius, style: .continuous)
      HStack(spacing: AglynAuthTokens.Metrics.buttonIconGap) {
        AglynGoogleGlyph()
          .frame(width: AglynAuthTokens.Metrics.googleGlyph, height: AglynAuthTokens.Metrics.googleGlyph)
        configuration.label.font(AglynAuthFont.google).foregroundStyle(C.googleText.color).lineLimit(1)
      }
      .padding(.horizontal, AglynAuthTokens.Metrics.providerPadding)
      .frame(maxWidth: .infinity, minHeight: AglynAuthTokens.Metrics.buttonHeight)
      .background(C.googleFill.color, in: shape)
      .overlay(shape.strokeBorder(C.googleStroke.color, lineWidth: 1))
      // Pressed: Google's state layer, the label color at 12% over the fill.
      .overlay(shape.fill(C.googleText.color.opacity(configuration.isPressed ? 0.12 : 0)))
      .contentShape(shape)
      .opacity(enabled ? 1 : AglynAuthTokens.Metrics.disabledOpacity)
    }
  }
}

/// Google's official multicolor "G" (the same artwork as the console's `GoogleGlyph`, AGL-873).
public struct AglynGoogleGlyph: View {
  public init() {}

  public var body: some View {
    Image("GoogleG", bundle: .module).resizable().scaledToFit().accessibilityHidden(true)
  }
}

/// The "or" between a form's own action and the provider buttons: a hairline either side of the word.
public struct AglynOrDivider: View {
  let text: String

  public init(_ text: String = "or") {
    self.text = text
  }

  public var body: some View {
    HStack(spacing: 12) {
      Rectangle().fill(AglynAuthTokens.Colors.borderSubtle.color).frame(height: 1)
      Text(text).font(AglynAuthFont.small).foregroundStyle(AglynAuthTokens.Colors.textTertiary.color).fixedSize()
      Rectangle().fill(AglynAuthTokens.Colors.borderSubtle.color).frame(height: 1)
    }
    .accessibilityElement(children: .combine)
  }
}

/// The line under a field (Figma "Field/Text" 28:791): an error with its icon, or a helper in the secondary color. It
/// takes the field's width and wraps to as many lines as it needs; it is never truncated.
public struct AglynFieldMessage: View {
  let text: String
  let isError: Bool

  public init(_ text: String, isError: Bool) {
    self.text = text
    self.isError = isError
  }

  public var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      if isError {
        Image(systemName: "exclamationmark.triangle")
          .font(.system(size: 12, weight: .semibold))
          .frame(width: AglynAuthTokens.Metrics.fieldMessageIcon)
          .accessibilityHidden(true)
      }
      Text(text)
        .font(AglynAuthFont.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
    .foregroundStyle((isError ? AglynAuthTokens.Colors.dangerForeground : AglynAuthTokens.Colors.textSecondary).color)
    .accessibilityElement(children: .combine)
  }
}

/// A sign-in field's frame: its label above, the 48-point input on the surface fill with the strong border, a 2-point
/// accent ring while focused and the danger border on an error, and its message under it.
public struct AglynAuthFieldFrame<Input: View>: View {
  let label: String
  let message: String?
  let supporting: String?
  let focused: Bool
  @ViewBuilder let input: () -> Input

  public init(
    _ label: String, message: String? = nil, supporting: String? = nil, focused: Bool,
    @ViewBuilder input: @escaping () -> Input
  ) {
    self.label = label
    self.message = message
    self.supporting = supporting
    self.focused = focused
    self.input = input
  }

  public var body: some View {
    let shape = RoundedRectangle(cornerRadius: M.fieldRadius, style: .continuous)
    VStack(alignment: .leading, spacing: M.fieldLabelGap) {
      Text(label)
        .font(AglynAuthFont.smallStrong)
        .foregroundStyle(C.textPrimary.color)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityHidden(true)
      input()
        .font(AglynAuthFont.value)
        .foregroundStyle(C.textPrimary.color)
        .padding(.horizontal, M.fieldPadding)
        .frame(minHeight: M.fieldHeight)
        .background(C.surface.color, in: shape)
        .overlay(
          shape.strokeBorder(
            message != nil ? C.dangerForeground.color : C.borderStrong.color, lineWidth: 1)
        )
        .overlay {
          if focused { shape.strokeBorder(C.focusRing.color, lineWidth: M.focusRingWidth) }
        }
      if let message {
        AglynFieldMessage(message, isError: true).padding(.top, M.fieldMessageGap - M.fieldLabelGap)
      } else if let supporting {
        AglynFieldMessage(supporting, isError: false).padding(.top, M.fieldMessageGap - M.fieldLabelGap)
      }
    }
  }
}

/// A notice inside the auth card (signups paused, where single sign-on will take you): an icon and a sentence on the
/// tone's soft fill, wrapping to its full length.
public struct AglynAuthNotice: View {
  public enum Tone: Sendable { case info, warning, danger }

  let text: String
  let systemImage: String
  let tone: Tone

  public init(_ text: String, systemImage: String, tone: Tone) {
    self.text = text
    self.systemImage = systemImage
    self.tone = tone
  }

  public var body: some View {
    let (ink, fill): (AglynAuthColor, AglynAuthColor) =
      switch tone {
      case .info: (C.infoForeground, C.infoBackground)
      case .warning: (C.warningForeground, C.warningBackground)
      case .danger: (C.dangerForeground, C.dangerBackground)
      }
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: systemImage).font(.system(size: 15, weight: .semibold)).accessibilityHidden(true)
      Text(text).font(AglynAuthFont.small).frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
    .foregroundStyle(ink.color)
    .padding(12)
    .background(fill.color, in: RoundedRectangle(cornerRadius: AglynAuthTokens.Metrics.fieldRadius, style: .continuous))
    .accessibilityElement(children: .combine)
  }
}

/// A text link in the auth screens: Body/Small Strong, underlined, in the primary text color.
public struct AglynAuthLinkStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(AglynAuthFont.smallStrong)
      .underline()
      .foregroundStyle(AglynAuthTokens.Colors.textPrimary.color)
      .opacity(configuration.isPressed ? 0.6 : 1)
      .contentShape(Rectangle())
  }
}
