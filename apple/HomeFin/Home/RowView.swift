import HomeFinKit
import SwiftUI

/// A titled, horizontally scrolling row of cards.
struct RowView: View {
    var row: HomeRow
    @Environment(\.isCompactLayout) private var compact

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(row.title)
                .font(.system(size: compact ? 19 : 22, weight: .bold))
                .foregroundStyle(Theme.text)
                .padding(.horizontal, Theme.gutter)
            ScrollView(.horizontal) {
                LazyHStack(spacing: row.kind == .top10 ? 4 : 8) {
                    ForEach(Array(row.items.enumerated()), id: \.element.id) { index, item in
                        card(item, index: index)
                    }
                }
                .scrollTargetLayout()
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 6)
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
        }
    }

    @ViewBuilder private func card(_ item: Item, index: Int) -> some View {
        switch row.kind {
        case .top10:
            NavigationLink(value: item) { Top10Card(item: item, rank: index + 1) }
                .buttonStyle(CardButtonStyle())
        case .progress:
            ContinueCard(item: item)
        case .landscape:
            NavigationLink(value: item) {
                if compact { PosterCard(item: item) } else { LandscapeCard(item: item) }
            }
            .buttonStyle(CardButtonStyle())
        }
    }
}

/// 2:3 poster (phones).
struct PosterCard: View {
    var item: Item
    var width: CGFloat = 112
    @Environment(AppModel.self) private var model

    var body: some View {
        Artwork(url: model.jellyfin?.posterURL(item) ?? model.jellyfin?.landscapeURL(item), placeholder: item.seriesName ?? item.name)
            .frame(width: width, height: width * 1.5)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .accessibilityLabel(item.name ?? "")
    }
}

/// 16:9 card with the title treatment (iPad, Mac).
struct LandscapeCard: View {
    var item: Item
    var width: CGFloat = 260
    var showProgress = false
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Artwork(url: model.jellyfin?.landscapeURL(item, preferEpisodeStill: showProgress), placeholder: item.seriesName ?? item.name)
            LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 6) {
                if let logo = model.jellyfin?.logoURL(item, maxWidth: 300), !showProgress {
                    Artwork(url: logo, contentMode: .fit).frame(maxWidth: width * 0.55, maxHeight: width * 0.16, alignment: .leading)
                } else {
                    Text(showProgress ? (item.seriesName ?? item.name ?? "") : (item.name ?? ""))
                        .font(.system(size: 14, weight: .heavy))
                        .lineLimit(1)
                    if showProgress, let code = item.episodeCode {
                        Text("\(code) \(item.name ?? "")").font(.system(size: 12)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                    }
                }
                if showProgress, let progress = item.progress { ProgressBar(value: progress) }
            }
            .padding(10)
        }
        .frame(width: width, height: width * 9 / 16)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .foregroundStyle(.white)
    }
}

/// Continue Watching: plays straight away; the info button opens the title.
struct ContinueCard: View {
    var item: Item
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { model.play(item) } label: {
                ZStack {
                    if compact {
                        PosterCard(item: item)
                            .overlay(alignment: .bottom) {
                                VStack(spacing: 6) {
                                    Image(systemName: "play.circle")
                                        .font(.system(size: 34, weight: .light))
                                        .shadow(radius: 4)
                                    if let progress = item.progress { ProgressBar(value: progress) }
                                }
                                .padding(.bottom, 0)
                            }
                    } else {
                        LandscapeCard(item: item, showProgress: true)
                    }
                }
            }
            .buttonStyle(CardButtonStyle())
            if compact {
                HStack {
                    NavigationLink(value: item) { Image(systemName: "info.circle") }
                    Spacer()
                    if let code = item.episodeCode { Text(code).font(.caption2).foregroundStyle(Theme.secondary) }
                }
                .font(.system(size: 18))
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
                .frame(width: 112)
                .background(Theme.surface)
                .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: Theme.cardRadius, bottomTrailingRadius: Theme.cardRadius))
            }
        }
    }
}

/// Netflix's Top 10: a huge outlined number behind the poster.
struct Top10Card: View {
    var item: Item
    var rank: Int
    @Environment(\.isCompactLayout) private var compact

    var body: some View {
        let height: CGFloat = compact ? 160 : 220
        HStack(alignment: .bottom, spacing: compact ? -18 : -28) {
            OutlinedNumber(text: "\(rank)", size: height * 0.85)
            PosterCard(item: item, width: height / 1.5)
        }
        .frame(height: height)
    }
}

/// A number drawn as an outline (white edge, dark fill), like Netflix's Top 10 ranks.
struct OutlinedNumber: View {
    var text: String
    var size: CGFloat

    var body: some View {
        let label = Text(text).font(.system(size: size, weight: .black)).tracking(-size * 0.08)
        ZStack {
            label.foregroundStyle(Color(white: 0.55)).offset(x: -1.5)
            label.foregroundStyle(Color(white: 0.55)).offset(x: 1.5)
            label.foregroundStyle(Color(white: 0.55)).offset(y: -1.5)
            label.foregroundStyle(Color(white: 0.55)).offset(y: 1.5)
            label.foregroundStyle(Theme.background)
        }
        .fixedSize()
        .offset(y: size * 0.12)
    }
}

/// The thin red watched-so-far bar.
struct ProgressBar: View {
    var value: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.3))
                Capsule().fill(Theme.brand).frame(width: proxy.size.width * max(0, min(1, value)))
            }
        }
        .frame(height: 3)
    }
}
