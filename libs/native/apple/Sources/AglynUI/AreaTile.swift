// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// One area on the phone's Home and in the area switcher (AGL-4006, Figma Phone/Area tile 282:22072): the area's icon on
/// a 56-point plate, radius 16, its name under it in two lines at most, and its Needs-you count on the plate's corner.
/// Every area gets the same tile, so none looks more important than another.
///
/// In the phone's bold look (`AglynThemeRuntime.shared.phoneBold`) the plate is the raised paper with a hairline and the
/// icon is in the accent's text shade, so it stands on the tinted ground; otherwise the plate is the sunken fill. The
/// area in use (the switcher's) wears the accent ring.
public struct AglynAreaTile: View {
  let title: String
  let systemImage: String
  let badge: Int
  let current: Bool
  let action: () -> Void

  public init(_ title: String, systemImage: String, badge: Int = 0, current: Bool = false, action: @escaping () -> Void) {
    self.title = title
    self.systemImage = systemImage
    self.badge = badge
    self.current = current
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      VStack(spacing: 6) {
        plate
          .overlay(alignment: .topTrailing) {
            if badge > 0 {
              Text(badge > 99 ? "99+" : "\(badge)")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(AglynColor.primaryContrast)
                .padding(.horizontal, 5)
                .frame(minWidth: 18, minHeight: 18)
                .background(Capsule().fill(AglynColor.primary))
                .offset(x: 6, y: -6)
                .accessibilityHidden(true)
            }
          }
        Text(title)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(current ? AglynColor.tint : AglynColor.textPrimary)
          .multilineTextAlignment(.center)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .top)
      .padding(.top, 4)
      .contentShape(Rectangle())
    }
    .buttonStyle(AreaTilePress())
    .accessibilityLabel(badge > 0 ? "\(title), \(badge) waiting" : title)
    .accessibilityAddTraits(current ? .isSelected : [])
  }

  private var plate: some View {
    let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
    let bold = AglynThemeRuntime.shared.phoneBold
    return Image(systemName: systemImage)
      .symbolVariant(.none)
      .font(.system(size: 24, weight: .regular))
      .foregroundStyle(bold ? AglynColor.tint : AglynColor.accentIcon)
      .frame(width: 56, height: 56)
      .background(shape.fill(bold ? AglynColor.paper : AglynColor.sunken))
      .overlay {
        if current {
          shape.strokeBorder(AglynColor.primary, lineWidth: 2)
        } else if bold {
          shape.strokeBorder(AglynColor.divider, lineWidth: 1)
        }
      }
  }
}

/// A tile dims a little under the finger, as the system's own grids do.
private struct AreaTilePress: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
  }
}

/// The phone Home's group heading over a row of tiles (Figma Phone/Section header): the group's name at 13 semibold in
/// the secondary text.
public struct AglynAreaGroupHeader: View {
  let title: String

  public init(_ title: String) { self.title = title }

  public var body: some View {
    Text(title)
      .font(.system(size: 13, weight: .semibold))
      .foregroundStyle(AglynColor.secondaryText)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, 10)
      .padding(.bottom, 4)
      .accessibilityAddTraits(.isHeader)
  }
}
