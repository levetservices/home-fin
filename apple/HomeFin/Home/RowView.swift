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
                .foregroundStyle(.white)
                .padding(.horizontal, Theme.gutter)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: row.kind == .top10 ? 2 : 8) {
                    ForEach(Array(row.items.enumerated()), id: \.element.id) { index, item in
                        card(item, index: index)
                    }
                }
                .scrollTargetLayout()
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
        }
    }

    @ViewBuilder private func card(_ item: Item, index: Int) -> some View {
        switch row.kind {
        case .top10:
            Top10Card(item: item, rank: index + 1)
        case .progress:
            ContinueCard(item: item)
        case .landscape:
            if compact { ShowCard(item: item) } else { LandscapeCard(item: item) }
        }
    }
}

/// A poster that opens the title page.
struct ShowCard: View {
    var item: Item
    var width: CGFloat? = 112
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { model.show(item) } label: { PosterCard(item: item, width: width) }
            .buttonStyle(CardButtonStyle())
            .contextMenu { TitleMenu(item: item) }
    }
}

/// 2:3 poster with Netflix's badges: TOP 10 in the corner, a red ribbon along the bottom.
struct PosterCard: View {
    var item: Item
    /// nil fills the width it's given (grids).
    var width: CGFloat? = 112
    var showsRibbon = true
    @Environment(AppModel.self) private var model

    var body: some View {
        Artwork(url: model.jellyfin?.posterURL(item) ?? model.jellyfin?.landscapeURL(item), placeholder: item.seriesName ?? item.name)
            .frame(width: width, height: width.map { $0 * 1.5 })
            .aspectRatio(2 / 3, contentMode: .fit)
            .overlay(alignment: .topLeading) {
                if model.top10Ids.contains(item.isEpisode ? (item.seriesId ?? item.id) : item.id) { Top10Badge() }
            }
            .overlay(alignment: .bottom) {
                if showsRibbon, let ribbon = item.ribbon() { Ribbon(text: ribbon) }
            }
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
        Button {
            if showProgress { model.play(item) } else { model.show(item) }
        } label: {
            ZStack(alignment: .bottomLeading) {
                Artwork(url: model.jellyfin?.landscapeURL(item, preferEpisodeStill: showProgress), placeholder: item.seriesName ?? item.name)
                LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                if showProgress {
                    PlayCircle(size: 40).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
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
            .overlay(alignment: .topLeading) {
                if model.top10Ids.contains(item.id) { Top10Badge() }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .foregroundStyle(.white)
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { TitleMenu(item: item) }
    }
}

/// Continue Watching on phones: poster with a play circle and progress, then ⓘ and ⋯ beneath.
struct ContinueCard: View {
    var item: Item
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact

    var body: some View {
        if compact {
            VStack(spacing: 0) {
                Button { model.play(item) } label: {
                    PosterCard(item: item, width: 112, showsRibbon: false)
                        .clipShape(UnevenRoundedRectangle(topLeadingRadius: Theme.cardRadius, topTrailingRadius: Theme.cardRadius))
                        .overlay { PlayCircle(size: 46) }
                        .overlay(alignment: .bottom) {
                            VStack(spacing: 0) {
                                if let ribbon = item.isEpisode ? nil : item.ribbon() { Ribbon(text: ribbon) }
                                ProgressBar(value: item.progress ?? 0.02, height: 3)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 6)
                                    .background(Color.black.opacity(0.55))
                            }
                        }
                }
                .buttonStyle(CardButtonStyle())
                HStack(spacing: 0) {
                    Button { model.show(item) } label: {
                        Image(systemName: "info.circle").frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .accessibilityLabel("More info")
                    Rectangle().fill(Color.white.opacity(0.18)).frame(width: 1, height: 20)
                    Menu {
                        TitleMenu(item: item, inContinueWatching: true)
                    } label: {
                        Image(systemName: "ellipsis").rotationEffect(.degrees(90))
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .contentShape(Rectangle())
                    }
                    .menuStyle(.button)
                    .accessibilityLabel("More")
                }
                .buttonStyle(.plain)
                .font(.system(size: 19))
                .foregroundStyle(.white)
                .frame(width: 112)
                .background(Theme.surface)
                .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: Theme.cardRadius, bottomTrailingRadius: Theme.cardRadius))
            }
        } else {
            LandscapeCard(item: item, showProgress: true)
        }
    }
}

/// The long-press / ⋯ menu for a title.
struct TitleMenu: View {
    var item: Item
    var inContinueWatching = false
    @Environment(AppModel.self) private var model

    var body: some View {
        Button("Play", systemImage: "play.fill") { model.play(item) }
        Button("Details & More", systemImage: "info.circle") { model.show(item) }
        if inContinueWatching {
            Button("Mark as Watched", systemImage: "checkmark.circle") {
                Task {
                    try? await model.jellyfin?.setPlayed(item.id, true)
                    model.homeRevision += 1
                }
            }
            Button("Remove From Row", systemImage: "minus.circle", role: .destructive) {
                Task {
                    try? await model.jellyfin?.removeFromContinueWatching(item)
                    model.homeRevision += 1
                }
            }
        } else {
            let listed = item.userData?.isFavorite == true
            Button(listed ? "Remove From My List" : "Add to My List", systemImage: listed ? "checkmark" : "plus") {
                Task {
                    try? await model.jellyfin?.setFavourite(item.id, !listed)
                    model.homeRevision += 1
                }
            }
        }
    }
}

/// Netflix's Top 10: a huge outlined number behind the poster.
struct Top10Card: View {
    var item: Item
    var rank: Int
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact

    var body: some View {
        let height: CGFloat = compact ? 160 : 220
        Button { model.show(item) } label: {
            HStack(alignment: .bottom, spacing: compact ? -18 : -28) {
                OutlinedNumber(text: "\(rank)", size: height * 0.85)
                PosterCard(item: item, width: height / 1.5, showsRibbon: true)
            }
            .frame(height: height)
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { TitleMenu(item: item) }
    }
}

/// A number drawn as an outline (grey edge, black fill), like Netflix's Top 10 ranks.
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
            label.foregroundStyle(Color.black)
        }
        .fixedSize()
        .offset(y: size * 0.12)
    }
}
