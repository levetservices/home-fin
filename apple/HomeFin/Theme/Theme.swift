import HomeFinKit
import SwiftUI

/// Home Fin's look: the Netflix app's black, red brand mark, white Play and glass everywhere else.
enum Theme {
    static let background = Color.black
    /// Card footers, settings rows.
    static let surface = Color(hex: "#1c1c1c")
    /// Sheets, pressed rows, the season menu.
    static let raised = Color(hex: "#2a2a2a")
    static let brand = Color(hex: "#e50914")
    static let text = Color(hex: "#e5e5e5")
    static let secondary = Color(hex: "#a3a3a3")
    static let tertiary = Color(hex: "#6d6d6d")
    static let cardRadius: CGFloat = 6
    static let gutter: CGFloat = 16

    /// Quick, slightly springy: the motion used throughout.
    static let spring = Animation.spring(response: 0.35, dampingFraction: 0.85)
    /// Bigger moves (sheets of content, the billboard).
    static let glide = Animation.spring(response: 0.55, dampingFraction: 0.9)
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

/// The red HOMEFIN wordmark (sign-in, launch).
struct Wordmark: View {
    var size: CGFloat = 26

    var body: some View {
        Text("HOMEFIN")
            .font(.system(size: size, weight: .black).width(.condensed))
            .tracking(-size * 0.02)
            .foregroundStyle(Theme.brand)
            .scaleEffect(x: 1, y: 1.12)
            .accessibilityLabel("Home Fin")
    }
}

/// The red "H" that sits where Netflix puts its N, before "Home" in the header.
struct BrandMark: View {
    var size: CGFloat = 34

    var body: some View {
        Text("H")
            .font(.system(size: size, weight: .black).width(.compressed))
            .foregroundStyle(
                LinearGradient(colors: [Color(hex: "#ff1f2c"), Theme.brand, Color(hex: "#b20710")], startPoint: .top, endPoint: .bottom)
            )
            .shadow(color: .black.opacity(0.35), radius: 2, y: 1)
            .accessibilityHidden(true)
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
                Text(preset.emoji).font(.system(size: size * 0.58))
            } else {
                LinearGradient(colors: [Color(hex: "#e50914"), Color(hex: "#7a0410")], startPoint: .topLeading, endPoint: .bottomTrailing)
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.16, style: .continuous))
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
                .font(.system(size: 10, weight: .heavy))
                .foregroundStyle(.white)
                .padding(.horizontal, label.count > 3 ? 6 : 0)
                .frame(minWidth: 20, minHeight: 20)
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

/// HD / 4K, HDR, Dolby Vision and subtitles, after the rating on a title page.
struct QualityBadges: View {
    var badges: VideoBadges

    var body: some View {
        HStack(spacing: 6) {
            if badges.dolbyVision {
                VStack(alignment: .leading, spacing: -2) {
                    Text("Dolby").font(.system(size: 10, weight: .bold))
                    Text("VISION").font(.system(size: 6, weight: .semibold)).tracking(1)
                }
            }
            if let resolution = badges.resolution { boxed(resolution) }
            if badges.hdr { boxed("HDR") }
            if badges.subtitles {
                Image(systemName: "captions.bubble").font(.system(size: 14))
            }
        }
        .foregroundStyle(Theme.secondary)
    }

    private func boxed(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Theme.secondary, lineWidth: 1))
    }
}

/// The small red "TOP 10" square in a poster's corner.
struct Top10Badge: View {
    var scale: CGFloat = 1

    var body: some View {
        VStack(spacing: -1 * scale) {
            Text("TOP").font(.system(size: 6 * scale, weight: .heavy))
            Text("10").font(.system(size: 11 * scale, weight: .black))
        }
        .foregroundStyle(.white)
        .frame(width: 19 * scale, height: 23 * scale)
        .background(Theme.brand)
        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 2 * scale, topTrailingRadius: 2 * scale))
        .accessibilityLabel("Top 10")
    }
}

/// "New Episodes", "Recently Added": the red ribbon at the bottom of a poster.
struct Ribbon: View {
    var text: String

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Theme.brand, in: UnevenRoundedRectangle(topLeadingRadius: 2, topTrailingRadius: 2))
    }
}

/// Remote (or downloaded) artwork that fades in, on a grey placeholder. Images come through
/// URLCache (set up at launch).
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
                    if contentMode == .fill {
                        LinearGradient(colors: [Color(hex: "#2b2b2b"), Color(hex: "#181818")], startPoint: .top, endPoint: .bottom)
                    }
                    if let placeholder, phase.error != nil || url == nil {
                        Text(placeholder)
                            .font(.system(size: 14, weight: .heavy))
                            .foregroundStyle(Theme.secondary)
                            .multilineTextAlignment(.center)
                            .padding(8)
                    }
                }
            }
        }
    }
}

/// The thin red watched-so-far bar.
struct ProgressBar: View {
    var value: Double
    var height: CGFloat = 3

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle().fill(Color.white.opacity(0.28))
                Rectangle().fill(Theme.brand).frame(width: proxy.size.width * max(0, min(1, value)))
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
    }
}

/// The circled play glyph on Continue Watching posters and episode stills.
struct PlayCircle: View {
    var size: CGFloat = 44

    var body: some View {
        Image(systemName: "play.fill")
            .font(.system(size: size * 0.38))
            .foregroundStyle(.white)
            .offset(x: size * 0.03)
            .frame(width: size, height: size)
            .background(Circle().fill(.black.opacity(0.35)))
            .overlay(Circle().stroke(.white, lineWidth: max(1.5, size * 0.045)))
            .shadow(color: .black.opacity(0.4), radius: 6)
    }
}

/// White pill: Netflix's Play.
struct PrimaryButtonStyle: ButtonStyle {
    var height: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .labelStyle(TightLabelStyle())
            .padding(.horizontal, 22)
            .frame(minHeight: height)
            .foregroundStyle(.black)
            .background(Capsule().fill(.white.opacity(configuration.isPressed ? 0.75 : 1)))
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Theme.spring, value: configuration.isPressed)
    }
}

/// Glass pill: My List, Download, More Info.
struct GlassPillButtonStyle: ButtonStyle {
    var height: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .labelStyle(TightLabelStyle())
            .padding(.horizontal, 22)
            .frame(minHeight: height)
            .foregroundStyle(.white)
            .glass(in: Capsule(), interactive: true)
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Theme.spring, value: configuration.isPressed)
    }
}

/// Red button for sign-in forms (Continue).
struct BrandButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .bold))
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .foregroundStyle(.white)
            .background(RoundedRectangle(cornerRadius: 5).fill(Color(hex: "#d42f27").opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)))
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

/// Icon and title close together, as on Netflix's buttons.
struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.icon
            configuration.title
        }
    }
}

/// A Netflix sign-in field: dark box, grey border, placeholder inside.
struct FieldBox<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .textFieldStyle(.plain)
            .font(.system(size: 17))
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 5).fill(Color(hex: "#161616").opacity(0.85)))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.white.opacity(0.35), lineWidth: 1))
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
    /// The app's black canvas behind a screen.
    func homeFinBackground() -> some View {
        background(Theme.background.ignoresSafeArea())
    }

    /// Screens draw their own header; hide the system navigation bar on iPhone and iPad.
    @ViewBuilder func hideNavigationBar() -> some View {
        #if os(iOS)
        toolbar(.hidden, for: .navigationBar)
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

extension Double {
    /// "1h 52m", "57m".
    var runtimeText: String {
        let minutes = Int(self / 60)
        if minutes < 60 { return "\(max(1, minutes))m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    /// "1:02:03" / "4:05" for the player.
    var clockText: String {
        let total = Int(max(0, self))
        let hours = total / 3600, minutes = (total % 3600) / 60, seconds = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, seconds) : String(format: "%d:%02d", minutes, seconds)
    }
}

extension Item {
    var runtimeSeconds: Double { Double(runTimeTicks ?? 0) / ticksPerSecond }
}
