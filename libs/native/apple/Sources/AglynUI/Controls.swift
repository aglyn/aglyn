// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A selectable capsule for a short filter or choice ("All", "Quick keys", a category).
public struct AglynChoiceChip: View {
  let title: String
  let systemImage: String?
  let selected: Bool
  let action: () -> Void

  public init(_ title: String, systemImage: String? = nil, selected: Bool, action: @escaping () -> Void) {
    self.title = title
    self.systemImage = systemImage
    self.selected = selected
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: AglynSpace.half) {
        if let systemImage { Image(systemName: systemImage).imageScale(.small) }
        Text(title).lineLimit(1)
      }
      .font(AglynFont.subheadline.weight(selected ? .semibold : .regular))
      .padding(.horizontal, AglynSpace.oneAndHalf)
      .padding(.vertical, AglynSpace.one)
      .foregroundStyle(selected ? AglynColor.primaryContrast : Color.primary)
      .background(selected ? AglynColor.primary : AglynColor.paper, in: Capsule())
      .overlay(Capsule().strokeBorder(selected ? Color.clear : AglynColor.divider))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// Minus, a count, plus. At `minimum` the minus becomes a remove button
/// when `onRemove` is given, so a line never sits at zero.
public struct AglynQuantityStepper: View {
  let value: Int
  let range: ClosedRange<Int>
  let onChange: (Int) -> Void
  let onRemove: (() -> Void)?

  public init(
    value: Int, range: ClosedRange<Int> = 1...99, onChange: @escaping (Int) -> Void, onRemove: (() -> Void)? = nil
  ) {
    self.value = value
    self.range = range
    self.onChange = onChange
    self.onRemove = onRemove
  }

  private var atFloor: Bool { value <= range.lowerBound }

  public var body: some View {
    HStack(spacing: 0) {
      Button {
        if atFloor { onRemove?() } else { onChange(value - 1) }
      } label: {
        Image(systemName: atFloor && onRemove != nil ? "trash" : "minus")
          .frame(width: 32, height: 32)
          .contentShape(Rectangle())
      }
      .disabled(atFloor && onRemove == nil)
      .accessibilityLabel(atFloor && onRemove != nil ? "Remove" : "Decrease")
      Text("\(value)")
        .font(AglynFont.body.monospacedDigit().weight(.semibold))
        .frame(minWidth: 28)
        .accessibilityHidden(true)
      Button {
        onChange(value + 1)
      } label: {
        Image(systemName: "plus").frame(width: 32, height: 32).contentShape(Rectangle())
      }
      .disabled(value >= range.upperBound)
      .accessibilityLabel("Increase")
    }
    .buttonStyle(.plain)
    .foregroundStyle(AglynColor.tint)
    .background(AglynColor.page, in: Capsule())
    .overlay(Capsule().strokeBorder(AglynColor.divider))
    .sensoryFeedback(.selection, trigger: value)
    .accessibilityElement(children: .contain)
    .accessibilityValue("\(value)")
  }
}

/// A label and an amount on one line, for totals; `emphasized` for the grand total.
public struct AglynAmountRow: View {
  @Environment(\.aglynPlainRecord) private var plain
  let title: String
  let amount: String
  let emphasized: Bool
  let tone: AglynTone?

  public init(_ title: String, amount: String, emphasized: Bool = false, tone: AglynTone? = nil) {
    self.title = title
    self.amount = amount
    self.emphasized = emphasized
    self.tone = tone
  }

  public var body: some View {
    if plain {
      // A detail column's totals (Figma 13:483): the same 14-point rows as the items, the total in semibold.
      HStack(alignment: .firstTextBaseline) {
        Text(title).foregroundStyle(AglynColor.textPrimary)
        Spacer(minLength: AglynSpace.one)
        Text(amount).monospacedDigit().foregroundStyle(tone?.color ?? AglynColor.textPrimary)
      }
      .font(.system(size: 14, weight: emphasized ? .semibold : .regular))
      .padding(.vertical, 10)
      .accessibilityElement(children: .combine)
    } else {
      HStack(alignment: .firstTextBaseline) {
        Text(title).foregroundStyle(emphasized ? .primary : .secondary)
        Spacer(minLength: AglynSpace.one)
        Text(amount).monospacedDigit().foregroundStyle(tone?.color ?? .primary)
      }
      .font(emphasized ? AglynFont.title2 : AglynFont.body)
      .accessibilityElement(children: .combine)
    }
  }
}

/// A one-line message in a tinted band: an error, a warning, a success or a note.
public struct AglynNotice: View {
  let message: String
  let tone: AglynTone
  let onDismiss: (() -> Void)?
  let actionTitle: String?
  let action: (() -> Void)?

  /// A trailing closure is `onDismiss`, the notice's close button. It is the
  /// only closure this init takes, so the compiler cannot bind it to another one.
  public init(_ message: String, tone: AglynTone, onDismiss: (() -> Void)? = nil) {
    self.message = message
    self.tone = tone
    self.onDismiss = onDismiss
    self.actionTitle = nil
    self.action = nil
  }

  /// `actionTitle` and `action` add one button beside the message ("Undo"); either
  /// nil leaves it out. Neither has a default, so the first init stays the only
  /// match for a notice that has just a close button.
  public init(
    _ message: String, tone: AglynTone, onDismiss: (() -> Void)? = nil, actionTitle: String?,
    action: (() -> Void)?
  ) {
    self.message = message
    self.tone = tone
    self.onDismiss = onDismiss
    self.actionTitle = actionTitle
    self.action = action
  }

  private var symbol: String {
    switch tone {
    case .error: "exclamationmark.octagon.fill"
    case .warning: "exclamationmark.triangle.fill"
    case .success: "checkmark.circle.fill"
    case .info, .neutral: "info.circle.fill"
    }
  }

  public var body: some View {
    HStack(alignment: .top, spacing: AglynSpace.one) {
      Image(systemName: symbol).foregroundStyle(tone.color).accessibilityHidden(true)
      Text(message).font(AglynFont.subheadline).frame(maxWidth: .infinity, alignment: .leading)
      if let actionTitle, let action {
        Button(actionTitle, action: action)
          .font(AglynFont.subheadline.weight(.semibold))
          .buttonStyle(.borderless)
      }
      if let onDismiss {
        Button(action: onDismiss) { Image(systemName: "xmark").imageScale(.small) }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Dismiss")
      }
    }
    .padding(AglynSpace.oneAndHalf)
    .background(tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
    .accessibilityElement(children: action == nil && onDismiss == nil ? .combine : .contain)
  }
}

/// A product or item tile for a picking grid: an image or monogram, the
/// name, a price line, and a status (sold out) in the corner.
public struct AglynItemTile: View {
  let title: String
  let subtitle: String?
  let imageURL: URL?
  let badge: (text: String, tone: AglynTone)?
  let action: () -> Void

  public init(
    _ title: String, subtitle: String?, imageURL: URL? = nil, badge: (text: String, tone: AglynTone)? = nil,
    action: @escaping () -> Void
  ) {
    self.title = title
    self.subtitle = subtitle
    self.imageURL = imageURL
    self.badge = badge
    self.action = action
  }

  private var monogram: some View {
    ZStack {
      AglynColor.primary.opacity(0.12)
      Text(String(title.prefix(1)).uppercased())
        .font(AglynFont.title.weight(.bold))
        .foregroundStyle(AglynColor.tint)
    }
  }

  public var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        ZStack(alignment: .topTrailing) {
          // The 4:3 box sets the size and the picture fills it as an overlay, so a photo never widens its tile past
          // the ones beside it.
          Color.clear
            .frame(maxWidth: .infinity)
            .aspectRatio(4 / 3, contentMode: .fit)
            .overlay {
              if let imageURL {
                AsyncImage(url: imageURL) { phase in
                  if let image = phase.image { image.resizable().scaledToFill() } else { monogram }
                }
              } else {
                monogram
              }
            }
          .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
          if let badge {
            StatusChip(badge.text, tone: badge.tone)
              .background(AglynColor.paper, in: Capsule())
              .padding(AglynSpace.half)
          }
        }
        Text(title).font(AglynFont.strongSubheadline).lineLimit(2, reservesSpace: true)
          .multilineTextAlignment(.leading)
        if let subtitle {
          Text(subtitle).font(AglynFont.subheadline.monospacedDigit()).foregroundStyle(.secondary)
        }
      }
      .padding(AglynSpace.one)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .aglynCardSurface()
      .contentShape(RoundedRectangle(cornerRadius: AglynRadius.card))
    }
    .buttonStyle(AglynPressableStyle())
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
  }
}

/// A checkbox on every platform (iOS has no checkbox toggle): a ticked square in the accent's fill (the console's
/// MuiCheckbox, `primary.main`), the label beside it, the whole row the target.
public struct AglynCheckboxToggleStyle: ToggleStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      HStack(spacing: 10) {
        Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
          .font(.system(size: 18))
          .foregroundStyle(configuration.isOn ? AglynColor.primary : AglynColor.secondaryText)
        configuration.label.frame(maxWidth: .infinity, alignment: .leading)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
  }
}

extension ToggleStyle where Self == AglynCheckboxToggleStyle {
  public static var aglynCheckbox: AglynCheckboxToggleStyle { AglynCheckboxToggleStyle() }
}

/// Every toggle in the accent's FILL, the brand blue #00B0FF, as the console's MuiSwitch draws it (AGL-3990). A scene's
/// tint is the accent's TEXT shade (#0077AD in light), which a switch's track and a checkbox would otherwise take.
/// Applied at a scene's root (`aglynAppTheme`, `RootView`); the platform's own toggle draws inside it.
public struct AglynToggleStyle: ToggleStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    Toggle(configuration)
      .toggleStyle(.automatic)
      .tint(AglynColor.primary)
  }
}

/// A filled ("prominent") button, Figma Button Kind=Primary: the console's contained MuiButton (AGL-3990). It paints
/// the accent's FILL itself (#00B0FF for the brand blue, its pressed shade #006999 while held), with WHITE text, at the
/// control size it is given (Small 28, Medium 36, Large 48; radius 6 on the Mac, 8 and 12 on touch). It never reads
/// the scene's `.tint`, which is the accent's TEXT shade (#0077AD light, #4DC8FF dark): the platform's
/// `.borderedProminent` fills with that, so every filled button (POS Charge and Take payment among them) read as the
/// wrong blue. A destructive one fills in the error color.
public struct AglynProminentButtonStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    ProminentBody(configuration: configuration)
  }

  private struct ProminentBody: View {
    let configuration: Configuration
    @Environment(\.controlSize) private var controlSize
    @Environment(\.isEnabled) private var enabled
    @State private var hovered = false

    private var fill: Color {
      if configuration.role == .destructive { return AglynColor.intent({ $0.error }, \.main) }
      return configuration.isPressed ? AglynColor.accent(\.pressed) : AglynColor.primary
    }

    var body: some View {
      let m = AglynButtonMetrics(controlSize)
      let shape = RoundedRectangle(cornerRadius: m.radius, style: .continuous)
      configuration.label
        .font(.system(size: m.font, weight: .semibold))
        .foregroundStyle(AglynColor.primaryContrast)
        .tint(AglynColor.primaryContrast)
        .lineLimit(1)
        .padding(.horizontal, m.padding)
        .frame(minHeight: m.height)
        .background(shape.fill(fill))
        // The pointer's hover: the fill a shade deeper, as the console's contained button darkens under the pointer.
        .overlay(shape.fill(Color.black.opacity(hovered && enabled && !configuration.isPressed ? 0.1 : 0)))
        .contentShape(shape)
        .opacity(enabled ? 1 : 0.5)
        .onHover { hovered = $0 }
    }
  }
}

/// A button's size at a control size (Figma Button Size): its height, label size, side padding and corner radius.
struct AglynButtonMetrics {
  let height: CGFloat
  let font: CGFloat
  let padding: CGFloat
  let radius: CGFloat

  init(_ controlSize: ControlSize) {
    #if os(macOS)
      let compact = true
    #else
      let compact = false
    #endif
    let size: (CGFloat, CGFloat, CGFloat, CGFloat) =
      switch controlSize {
      case .mini, .small: (28, 13, 10, compact ? 6 : 8)
      case .large, .extraLarge: (48, 17, 20, compact ? 6 : 12)
      default: (36, 14, 14, compact ? 6 : 8)
      }
    height = size.0
    font = size.1
    padding = size.2
    radius = size.3
  }
}

/// A secondary (outlined) button, Figma Button Kind=Secondary: the surface, a 1-point border/strong outline and primary
/// text, at the control size it is given (Small 28, Medium 36, Large 48; radius 6 on the Mac, 8 and 12 on touch). It
/// stands in for the platform's `.bordered`, whose glass draws a bright rim in dark mode (Zach, 2026-10-19: "weird
/// white borders on dark mode on some buttons"). A destructive one says so in the error color. A `selected` one (a
/// notification channel that is on) is the console's outlined primary: the accent's text shade, outlined in the fill,
/// on the same surface (never the soft wash, under which #0077AD falls short of 4.5:1).
public struct AglynSecondaryButtonStyle: ButtonStyle {
  let selected: Bool

  public init(selected: Bool = false) { self.selected = selected }

  public func makeBody(configuration: Configuration) -> some View {
    SecondaryBody(configuration: configuration, selected: selected)
  }

  private struct SecondaryBody: View {
    let configuration: Configuration
    let selected: Bool
    @Environment(\.controlSize) private var controlSize
    @Environment(\.isEnabled) private var enabled
    @State private var hovered = false

    private var fill: Color {
      if configuration.isPressed { return AglynColor.sunken }
      return hovered && enabled ? AglynColor.hover : AglynColor.paper
    }

    var body: some View {
      let m = AglynButtonMetrics(controlSize)
      let shape = RoundedRectangle(cornerRadius: m.radius, style: .continuous)
      configuration.label
        .font(.system(size: m.font, weight: .semibold))
        .foregroundStyle(
          configuration.role == .destructive ? AglynColor.error : selected ? AglynColor.tint : AglynColor.textPrimary)
        .lineLimit(1)
        .padding(.horizontal, m.padding)
        .frame(minHeight: m.height)
        .background(shape.fill(fill))
        .overlay(shape.strokeBorder(selected ? AglynColor.primary : AglynColor.borderStrong, lineWidth: 1))
        .contentShape(shape)
        .opacity(enabled ? 1 : 0.5)
        .onHover { hovered = $0 }
    }
  }
}

extension ButtonStyle where Self == AglynSecondaryButtonStyle {
  /// A secondary (outlined) button: `AglynSecondaryButtonStyle`.
  public static var aglynSecondary: AglynSecondaryButtonStyle { AglynSecondaryButtonStyle() }
  /// A secondary button that shows it is on: `AglynSecondaryButtonStyle(selected:)`.
  public static func aglynSecondary(selected: Bool) -> AglynSecondaryButtonStyle { AglynSecondaryButtonStyle(selected: selected) }
}

extension ButtonStyle where Self == AglynProminentButtonStyle {
  /// A filled button in the brand blue under white: `AglynProminentButtonStyle`.
  public static var aglynProminent: AglynProminentButtonStyle { AglynProminentButtonStyle() }
}
