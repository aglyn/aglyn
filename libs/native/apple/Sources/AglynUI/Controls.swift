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
    HStack(alignment: .firstTextBaseline) {
      Text(title).foregroundStyle(emphasized ? .primary : .secondary)
      Spacer(minLength: AglynSpace.one)
      Text(amount).monospacedDigit().foregroundStyle(tone?.color ?? .primary)
    }
    .font(emphasized ? AglynFont.title2 : AglynFont.body)
    .accessibilityElement(children: .combine)
  }
}

/// A one-line message in a tinted band: an error, a warning, a success or a note.
public struct AglynNotice: View {
  let message: String
  let tone: AglynTone
  let onDismiss: (() -> Void)?

  public init(_ message: String, tone: AglynTone, onDismiss: (() -> Void)? = nil) {
    self.message = message
    self.tone = tone
    self.onDismiss = onDismiss
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
      if let onDismiss {
        Button(action: onDismiss) { Image(systemName: "xmark").imageScale(.small) }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Dismiss")
      }
    }
    .padding(AglynSpace.oneAndHalf)
    .background(tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
    .accessibilityElement(children: .combine)
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
          Group {
            if let imageURL {
              AsyncImage(url: imageURL) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { monogram }
              }
            } else {
              monogram
            }
          }
          .frame(maxWidth: .infinity)
          .aspectRatio(4 / 3, contentMode: .fit)
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
