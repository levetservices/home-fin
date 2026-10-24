import HomeFinKit
import SwiftUI

/// Home Fin's look: Netflix's charcoal, red wordmark and white primary buttons.
enum Theme {
    static let background = Color(hex: "#141414")
    static let surface = Color(hex: "#1c1c1c")
    static let raised = Color(hex: "#2f2f2f")
    static let brand = Color(hex: "#e50914")
    static let text = Color(hex: "#e5e5e5")
    static let secondary = Color(hex: "#a3a3a3")
    static let cardRadius: CGFloat = 8
    static let gutter: CGFloat = 16

    /// Quick, slightly springy: the motion used throughout.
    static let spring = Animation.spring(response: 0.35, dampingFraction: 0.85)
}

extension Color {
    /// "#rrggbb" (as the accounts service sends avatar colours).
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255,
            opacity: 1
        )
    }
}

/// The red HOMEFIN wordmark.
struct Wordmark: View {
    var size: CGFloat = 26

    var body: some View {
        Text("HOMEFIN")
            .font(.system(size: size, weight: .black))
            .tracking(-size * 0.05)
            .foregroundStyle(Theme.brand)
            .scaleEffect(x: 1, y: 1.18)
            .accessibilityLabel("Home Fin")
    }
}

/// A profile avatar: the preset emoji on its gradient, or the profile's initial.
struct AvatarView: View {
    var preset: AvatarPreset?
    var name: String
    var size: CGFloat = 64

    var body: some View {
        ZStack {
            if let preset {
                LinearGradient(colors: [Color(hex: preset.from), Color(hex: preset.to)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Text(preset.emoji).font(.system(size: size * 0.55))
            } else {
                Theme.brand
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.12, style: .continuous))
    }
}

/// Netflix UK's age rating: a coloured circle in BBFC colours (US ratings mapped onto them).
struct RatingBadge: View {
    var rating: String?

    private static let bands: [String: String] = [
        "U": "u", "UC": "u", "PG": "pg", "12": "12", "12A": "12", "15": "15", "18": "18", "R18": "18",
        "G": "u", "PG-13": "12", "R": "15", "NC-17": "18",
        "TV-Y": "u", "TV-Y7": "u", "TV-Y7-FV": "u", "TV-G": "u", "TV-PG": "pg", "TV-14": "15", "TV-MA": "18"
    ]
    private static let colours: [String: String] = ["u": "#00a54f", "pg": "#fbb900", "12": "#f47d20", "15": "#e5007d", "18": "#dc0a14"]

    var body: some View {
        if let rating, !rating.isEmpty {
            let label = rating.replacingOccurrences(of: #"^(GB|UK|US)[-:\s]"#, with: "", options: [.regularExpression, .caseInsensitive]).uppercased()
            let band = Self.bands[label]
            Text(label)
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(.white)
                .padding(.horizontal, label.count > 3 ? 6 : 0)
                .frame(minWidth: 22, minHeight: 22)
                .background {
                    if let band, let colour = Self.colours[band] {
                        Capsule().fill(Color(hex: colour))
                    } else {
                        Capsule().stroke(Theme.secondary, lineWidth: 1)
                    }
                }
        }
    }
}

/// Remote artwork that fades in, on a grey placeholder. Images come through URLCache (set up at launch).
struct Artwork: View {
    var url: URL?
    var contentMode: ContentMode = .fill
    var placeholder: String?

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.35))) { phase in
            switch phase {
            case .success(let image):
                image.resizable().aspectRatio(contentMode: contentMode).transition(.opacity)
            default:
                ZStack {
                    LinearGradient(colors: [Theme.raised, Theme.surface], startPoint: .top, endPoint: .bottom)
                    if let placeholder, phase.error != nil || url == nil {
                        Text(placeholder)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.secondary)
                            .multilineTextAlignment(.center)
                            .padding(8)
                    }
                }
            }
        }
    }
}

/// White pill: Netflix's Play button.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .bold))
            .padding(.vertical, 10)
            .padding(.horizontal, 22)
            .foregroundStyle(.black)
            .background(Capsule().fill(.white.opacity(configuration.isPressed ? 0.75 : 1)))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Theme.spring, value: configuration.isPressed)
    }
}

/// Translucent grey pill: More Info.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .bold))
            .padding(.vertical, 10)
            .padding(.horizontal, 22)
            .foregroundStyle(.white)
            .background(Capsule().fill(Color(white: 0.43).opacity(configuration.isPressed ? 0.5 : 0.7)))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Theme.spring, value: configuration.isPressed)
    }
}

/// Red full-width button for sign-in forms.
struct BrandButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .bold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(.white)
            .background(RoundedRectangle(cornerRadius: 6).fill(Theme.brand.opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Theme.spring, value: configuration.isPressed)
    }
}

/// Cards shrink a touch when pressed and grow a touch under a Mac pointer.
struct CardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        CardBody(configuration: configuration)
    }

    private struct CardBody: View {
        let configuration: Configuration
        @State private var hovering = false

        var body: some View {
            configuration.label
                .scaleEffect(configuration.isPressed ? 0.96 : (hovering ? 1.04 : 1))
                .shadow(color: .black.opacity(hovering ? 0.5 : 0), radius: 12, y: 6)
                .animation(Theme.spring, value: configuration.isPressed)
                .animation(Theme.spring, value: hovering)
                .onHover { hovering = $0 }
        }
    }
}

/// A form field in the sign-in style: dark box, grey label.
struct FieldBox<Content: View>: View {
    var label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.footnote).foregroundStyle(Theme.secondary)
            content
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.55)))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.white.opacity(0.25), lineWidth: 1))
        }
    }
}

/// An amber note under a form when something went wrong.
struct ErrorNote: View {
    var message: String?

    var body: some View {
        if let message {
            Text(message)
                .font(.callout)
                .foregroundStyle(.black)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(hex: "#e87c03")))
                .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

extension View {
    /// The app's dark canvas behind a screen.
    func homeFinBackground() -> some View {
        background(Theme.background.ignoresSafeArea())
    }

    /// Hide the navigation bar's background on iOS (Home floats over artwork); no-op on the Mac.
    @ViewBuilder func transparentNavigationBar() -> some View {
        #if os(iOS)
        toolbarBackground(.hidden, for: .navigationBar)
        #else
        self
        #endif
    }

    @ViewBuilder func inlineNavigationTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }
}
