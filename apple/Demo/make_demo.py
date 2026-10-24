#!/usr/bin/env python3
"""Makes the demo library the app shows with `-demo` (Debug builds): a catalogue in Jellyfin's
JSON shape, generated artwork, and a short clip for the player. Used for simulator screenshots.

    python3 apple/Demo/make_demo.py      # writes apple/HomeFin/DemoContent/

Needs Pillow and ffmpeg. Everything is made up; titles match the local test library.
"""
import json
import math
import os
import random
import shutil
import subprocess
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'HomeFin', 'DemoContent')
NOW = datetime(2026, 10, 24, 19, 30, tzinfo=timezone.utc)
TICKS = 10_000_000
FONTS = {
    'black': '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf',
    'thin': '/usr/share/fonts/opentype/inter/InterDisplay-Thin.otf',
    'light': '/usr/share/fonts/opentype/inter/InterDisplay-Light.otf',
    'serif': '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
}

# name, type, genres, year, rating, score, minutes, logo style, palette, overview
TITLES = [
    ('Blackwater County', 'Series', ['Crime', 'Thriller'], 2023, '15', 8.4, 52, 'serif', 'teal',
     'When a body surfaces in the reservoir, a disgraced detective returns home to a county that would rather forget.'),
    ('Deep Orbit', 'Series', ['Sci-Fi', 'Action'], 2025, '12', 8.1, 48, 'thin', 'space',
     'Six engineers wake early on a colony ship and find the course has been changed. By one of them.'),
    ('Harbour Street', 'Series', ['Drama'], 2022, '12', 7.6, 58, 'serif', 'amber',
     "Three generations run the last fish shop on a street that's being sold off one door at a time."),
    ('Little Lanterns', 'Series', ['Animation', 'Family'], 2024, 'U', 7.9, 22, 'black', 'candy',
     "A family of lantern-makers lights up a sleepy seaside town, one wish at a time."),
    ('The Office Party', 'Series', ['Comedy'], 2026, '15', 7.4, 28, 'black', 'sunny',
     'The worst Christmas party in company history, told one awkward hour at a time.'),
    ('Remains', 'Series', ['Crime', 'Drama'], 2026, '18', 8.7, 55, 'thin', 'cold',
     'A forensic archaeologist is called to a building site where the bones are newer than anyone says.'),
    ('Cold Ledger', 'Movie', ['Crime', 'Thriller'], 2024, '15', 7.2, 112, 'serif', 'teal',
     "An accountant finds one line in the books that someone will kill to keep hidden."),
    ('Emberfall', 'Movie', ['Animation', 'Action', 'Family'], 2025, 'PG', 7.8, 96, 'black', 'fire',
     'A young dragon who is afraid of fire has to save the village that never believed in her.'),
    ('A Fine Mess', 'Movie', ['Comedy', 'Family'], 2023, 'PG', 6.9, 101, 'black', 'sunny',
     'Two rival grandparents, one wedding cake, and a weekend that gets completely out of hand.'),
    ('Glasshouse', 'Movie', ['Sci-Fi', 'Thriller'], 2026, '15', 7.7, 118, 'thin', 'space',
     'In a city under glass, a botanist discovers the air is running out faster than they are being told.'),
    ('Harbour Lights', 'Movie', ['Drama', 'Family'], 2021, '12', 7.3, 109, 'serif', 'amber',
     'A lighthouse keeper and his estranged daughter have one winter to put things right.'),
    ('Iron Meridian', 'Movie', ['Action', 'Sci-Fi'], 2024, '15', 7.0, 127, 'black', 'fire',
     'The last train across a frozen continent carries a cargo three armies want.'),
    ('The Long Night', 'Movie', ['Thriller', 'Drama'], 2026, '15', 8.0, 104, 'thin', 'night',
     'A storm cuts off a mountain hotel, and every guest has a reason to be there.'),
    ('Midnight Static', 'Movie', ['Sci-Fi', 'Thriller'], 2025, '15', 7.1, 99, 'thin', 'night',
     'A late-night radio host starts taking calls from tomorrow.'),
    ('Northern Wolves', 'Movie', ['Crime', 'Drama'], 2022, '18', 7.9, 121, 'serif', 'cold',
     'Brothers on opposite sides of the law, one long winter in the north.'),
    ('Paper Crowns', 'Movie', ['Comedy'], 2023, '12', 6.8, 94, 'black', 'candy',
     "A school's drama club stages Macbeth with no money, no stage and no idea."),
    ('The Quiet Hours', 'Movie', ['Drama'], 2024, '12', 7.5, 106, 'serif', 'amber',
     'A night nurse and a patient who cannot sleep share the hours no one else sees.'),
    ('Redline Run', 'Movie', ['Action', 'Thriller'], 2025, '15', 6.9, 103, 'black', 'fire',
     'A getaway driver has one night, one car and one chance to get out.'),
    ('Starlight Express Delivery', 'Movie', ['Animation', 'Family', 'Comedy'], 2024, 'U', 7.2, 88, 'black', 'space',
     "Santa's newest delivery driver is a robot who has never seen snow."),
    ('The Witness Tree', 'Movie', ['Crime', 'Drama'], 2021, '15', 7.6, 115, 'serif', 'cold',
     'An old oak at the edge of a village is the only witness to a crime fifty years old.'),
]

PALETTES = {
    'teal': [(12, 38, 44), (32, 92, 96), (214, 128, 58)],
    'space': [(8, 10, 32), (46, 30, 104), (82, 190, 255)],
    'amber': [(42, 22, 10), (152, 82, 32), (255, 196, 110)],
    'candy': [(54, 20, 72), (220, 92, 140), (255, 214, 120)],
    'sunny': [(70, 40, 10), (232, 150, 40), (255, 236, 160)],
    'cold': [(14, 20, 28), (70, 92, 112), (210, 226, 236)],
    'fire': [(30, 6, 6), (170, 40, 18), (255, 170, 60)],
    'night': [(4, 6, 16), (24, 34, 72), (150, 160, 255)],
}

CAST = ['Ava Marsh', 'Tom Keel', 'Priya Lal', 'Owen Hart', 'Maya Okafor', 'Jon Reid', 'Elena Cruz', 'Sam Whitlock',
        'Nadia Sorensen', 'Rory Byrne', 'Grace Adeyemi', 'Luke Thorne', 'Isla Murray', 'Dev Patel-Shaw']
EPISODE_NAMES = ['Pilot', 'The Reservoir', 'Old Debts', 'Low Tide', 'The Search Line', 'What the River Kept',
                 'Night Shift', 'Signals', 'Homecoming', 'Fault Lines', 'Open Water', 'The Long Way Round']


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def scene(w, h, palette, rng, figures=True):
    """A cinematic still: sky gradient, a glow, layered hills or a skyline, silhouettes, haze, grain."""
    dark, mid, light = PALETTES[palette]
    img = Image.new('RGB', (w, h))
    px = ImageDraw.Draw(img)
    horizon = rng.uniform(0.5, 0.68)
    for y in range(h):
        t = y / h
        colour = lerp(dark, mid, min(1, t / horizon)) if t < horizon else lerp(mid, dark, min(1, (t - horizon) / (1 - horizon)))
        px.line([(0, y), (w, y)], fill=colour)
    glow = Image.new('L', (w, h), 0)
    gx, gy, r = rng.uniform(0.25, 0.75) * w, horizon * h * rng.uniform(0.7, 0.95), min(w, h) * rng.uniform(0.18, 0.3)
    ImageDraw.Draw(glow).ellipse((gx - r, gy - r, gx + r, gy + r), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(r * 0.8))
    img.paste(Image.new('RGB', (w, h), light), (0, 0), glow.point(lambda v: v * 0.8))
    layers = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(layers)
    for depth in range(3):
        shade = lerp(dark, mid, 0.5 - depth * 0.2) + (255,)
        base = h * (horizon + depth * 0.06)
        if palette in ('space', 'night', 'cold') and depth == 1:
            x = 0
            while x < w:
                bw, bh = rng.uniform(0.04, 0.09) * w, rng.uniform(0.08, 0.3) * h
                d.rectangle((x, base - bh, x + bw, h), fill=shade)
                x += bw + rng.uniform(0, 0.02) * w
        else:
            points = [(0, h)]
            for i in range(9):
                points.append((i * w / 8, base - rng.uniform(0, 0.12) * h))
            points.append((w, h))
            d.polygon(points, fill=shade)
    if figures:
        count = rng.choice([1, 2, 3])
        for i in range(count):
            fx = w * (0.5 + (i - (count - 1) / 2) * rng.uniform(0.16, 0.22))
            fh = h * rng.uniform(0.34, 0.46)
            fw = fh * 0.3
            top = h * 0.98 - fh
            d.rounded_rectangle((fx - fw / 2, top + fw * 0.55, fx + fw / 2, h * 1.02), radius=fw * 0.35, fill=(6, 6, 8, 255))
            d.ellipse((fx - fw * 0.22, top, fx + fw * 0.22, top + fw * 0.5), fill=(6, 6, 8, 255))
    img = Image.alpha_composite(img.convert('RGBA'), layers.filter(ImageFilter.GaussianBlur(1.2))).convert('RGB')
    haze = Image.new('L', (w, h), 0)
    ImageDraw.Draw(haze).rectangle((0, h * (horizon - 0.05), w, h * (horizon + 0.1)), fill=120)
    img.paste(Image.new('RGB', (w, h), light), (0, 0), haze.filter(ImageFilter.GaussianBlur(h * 0.06)).point(lambda v: v * 0.25))
    vignette = Image.new('L', (w, h), 0)
    ImageDraw.Draw(vignette).ellipse((-w * 0.25, -h * 0.25, w * 1.25, h * 1.25), fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(min(w, h) * 0.2))
    img = Image.composite(img, Image.new('RGB', (w, h), (0, 0, 0)), vignette)
    noise = Image.effect_noise((w, h), 24).convert('RGB')
    return Image.blend(img, noise, 0.05)


def logo(name, style, width=900):
    """A title treatment as a transparent PNG."""
    text = name.upper() if style != 'serif' else name
    size = 150
    font = ImageFont.truetype(FONTS[style], size)
    tracking = {'black': -2, 'thin': 18, 'serif': 0, 'light': 10}[style]
    words = text.split()
    lines = [' '.join(words)] if len(text) <= 14 or len(words) == 1 else [' '.join(words[:len(words) // 2]), ' '.join(words[len(words) // 2:])]

    def measure(line):
        return sum(font.getlength(c) + tracking for c in line) - tracking

    widest = max(measure(line) for line in lines)
    scale = min(1, (width - 40) / widest)
    font = ImageFont.truetype(FONTS[style], int(size * scale))
    tracking = int(tracking * scale)
    line_h = int(size * scale * 1.05)
    img = Image.new('RGBA', (width, line_h * len(lines) + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for row, line in enumerate(lines):
        line_w = sum(font.getlength(c) + tracking for c in line) - tracking
        x = (width - line_w) / 2
        for c in line:
            d.text((x, 20 + row * line_h), c, font=font, fill=(255, 255, 255, 255))
            x += font.getlength(c) + tracking
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    shadow.putalpha(img.split()[3].filter(ImageFilter.GaussianBlur(6)).point(lambda v: v * 0.5))
    out = Image.alpha_composite(shadow, img)
    return out.crop(out.getbbox())


def poster(name, style, palette, rng):
    img = scene(400, 600, palette, rng)
    mark = logo(name, style, 360)
    mark.thumbnail((340, 170))
    img = img.convert('RGBA')
    img.alpha_composite(mark, ((400 - mark.width) // 2, int(600 * 0.7 - mark.height / 2)))
    d = ImageDraw.Draw(img)
    d.text((14, 8), 'H', font=ImageFont.truetype(FONTS['black'], 40), fill=(229, 9, 20, 255))
    return img.convert('RGB')


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S.0000000Z')


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(os.path.join(OUT, 'img'))
    items = []
    rng_master = random.Random(7)

    def save(img, item_id, kind, png=False):
        path = os.path.join(OUT, 'img', f'{item_id}-{kind}.{"png" if png else "jpg"}')
        if png:
            img.save(path, optimize=True)
        else:
            img.save(path, quality=80, optimize=True)

    for index, (name, kind, genres, year, rating, score, minutes, style, palette, overview) in enumerate(TITLES):
        rng = random.Random(name)
        item_id = f'{kind[0].lower()}{index:02d}' + 'a' * 29
        tag = f't{index:02d}'
        created = NOW - timedelta(days=[2, 40, 120, 8, 1, 4, 200, 5, 300, 3, 150, 90, 6, 60, 400, 30, 250, 12, 9, 500][index])
        cast = rng.sample(CAST, 5)
        item = {
            'Id': item_id, 'Name': name, 'Type': kind, 'Overview': overview, 'ProductionYear': year,
            'OfficialRating': rating, 'CommunityRating': score, 'Genres': genres,
            'ImageTags': {'Primary': tag, 'Logo': tag}, 'BackdropImageTags': [tag],
            'DateCreated': iso(created), 'PremiereDate': iso(datetime(year, 3, 1, tzinfo=timezone.utc)),
            'People': [{'Name': n, 'Type': 'Actor', 'Role': ''} for n in cast] + [{'Name': rng.choice(CAST), 'Type': 'Creator' if kind == 'Series' else 'Director'}],
            'UserData': {'PlaybackPositionTicks': 0, 'Played': False, 'IsFavorite': name in ('Remains', 'Glasshouse', 'Harbour Street', 'The Long Night', 'Deep Orbit'),
                         'Likes': True if name in ('Blackwater County', 'Cold Ledger', 'Northern Wolves', 'Emberfall') else None},
            'MediaSources': [{'Id': item_id, 'Container': 'mp4', 'Size': 2_400_000_000,
                              'MediaStreams': [{'Type': 'Video', 'Codec': 'hevc', 'Index': 0, 'Width': 3840 if score > 8 else 1920, 'Height': 2160 if score > 8 else 1080,
                                                'VideoRangeType': 'DOVIWithHDR10' if score > 8.3 else 'SDR'},
                                               {'Type': 'Audio', 'Codec': 'eac3', 'Index': 1, 'Language': 'eng', 'DisplayTitle': 'English - Dolby Digital+ 5.1', 'IsDefault': True},
                                               {'Type': 'Audio', 'Codec': 'aac', 'Index': 2, 'Language': 'eng', 'DisplayTitle': 'English - Audio Description'},
                                               {'Type': 'Subtitle', 'Codec': 'subrip', 'Index': 3, 'Language': 'eng', 'DisplayTitle': 'English'},
                                               {'Type': 'Subtitle', 'Codec': 'subrip', 'Index': 4, 'Language': 'eng', 'DisplayTitle': 'English [CC]'}],
                              'DefaultAudioStreamIndex': 1}],
        }
        backdrop = scene(1280, 720, palette, rng)
        save(backdrop, item_id, 'Backdrop')
        save(poster(name, style, palette, random.Random(name + 'p')), item_id, 'Primary')
        save(logo(name, style), item_id, 'Logo', png=True)

        if kind == 'Movie':
            item['RunTimeTicks'] = minutes * 60 * TICKS
            if name in ('Glasshouse', 'The Long Night', 'Midnight Static'):
                watched = {'Glasshouse': 0.38, 'The Long Night': 0.72, 'Midnight Static': 0.15}[name]
                item['UserData'].update(PlaybackPositionTicks=int(item['RunTimeTicks'] * watched), PlayedPercentage=watched * 100,
                                        LastPlayedDate=iso(NOW - timedelta(hours=index)))
            items.append(item)
            continue

        seasons = 2 if name in ('Blackwater County', 'Harbour Street', 'Deep Orbit') else 1
        item['ChildCount'] = seasons
        item['Status'] = 'Ended' if name == 'Remains' else 'Continuing'
        item['DateLastMediaAdded'] = iso(NOW - timedelta(days=3 if name in ('Blackwater County', 'Deep Orbit') else 60))
        items.append(item)
        progress_ep = {'Blackwater County': (2, 3), 'Deep Orbit': (1, 4), 'Harbour Street': (2, 2), 'Remains': (1, 2)}.get(name)
        for season in range(1, seasons + 1):
            season_id = f'{item_id[:3]}s{season}' + 'b' * 28
            items.append({'Id': season_id, 'Name': f'Season {season}', 'Type': 'Season', 'SeriesId': item_id, 'SeriesName': name,
                          'IndexNumber': season, 'ChildCount': 6, 'ImageTags': {}, 'UserData': {}})
            for episode in range(1, 7):
                ep_id = f'{item_id[:3]}e{season}{episode}' + 'c' * 26
                ep_rng = random.Random(f'{name}{season}{episode}')
                save(scene(480, 270, palette, ep_rng), ep_id, 'Primary')
                watched = progress_ep and (season, episode) < progress_ep
                current = progress_ep == (season, episode)
                ep_minutes = minutes + ep_rng.randint(-4, 4)
                ep = {
                    'Id': ep_id, 'Name': EPISODE_NAMES[(season * 6 + episode + index) % len(EPISODE_NAMES)], 'Type': 'Episode',
                    'SeriesId': item_id, 'SeriesName': name, 'SeasonId': season_id, 'IndexNumber': episode, 'ParentIndexNumber': season,
                    'Overview': ep_rng.choice([
                        'A discovery at first light changes everything, and someone is already covering their tracks.',
                        'Old loyalties are tested when a witness finally talks, but not to the police.',
                        'The search widens. A phone call in the night points somewhere no one wanted to look.',
                        'Everyone has an alibi. Only one of them is lying, and it is not the one you think.',
                    ]),
                    'RunTimeTicks': ep_minutes * 60 * TICKS, 'ImageTags': {'Primary': f'e{season}{episode}'},
                    'SeriesPrimaryImageTag': tag, 'ParentBackdropItemId': item_id, 'ParentBackdropImageTags': [tag],
                    'ParentLogoItemId': item_id, 'ParentLogoImageTag': tag, 'DateCreated': item['DateCreated'],
                    'UserData': {'Played': bool(watched), 'PlaybackPositionTicks': int(ep_minutes * 60 * TICKS * 0.42) if current else 0,
                                 'PlayedPercentage': 42 if current else None,
                                 'LastPlayedDate': iso(NOW - timedelta(hours=index)) if current or watched else None},
                    'MediaSources': item['MediaSources'],
                }
                items.append(ep)

    with open(os.path.join(OUT, 'catalog.json'), 'w') as f:
        json.dump(items, f, separators=(',', ':'))
    with open(os.path.join(OUT, 'household.json'), 'w') as f:
        json.dump({
            'serverName': 'Home Fin',
            'account': {'id': 1, 'email': 'hayden@example.com', 'name': 'Hayden', 'isAdmin': True, 'disabled': False},
            'profiles': [
                {'id': 1, 'name': 'Hayden', 'avatar': 'parrot', 'maturity': 'adult', 'locked': False, 'jellyfinUserId': 'demo-hayden'},
                {'id': 2, 'name': 'Dad', 'avatar': 'fox', 'maturity': 'adult', 'locked': True, 'jellyfinUserId': 'demo-dad'},
                {'id': 3, 'name': 'Alana', 'avatar': 'unicorn', 'maturity': 'kids', 'locked': False, 'jellyfinUserId': 'demo-alana'},
                {'id': 4, 'name': 'Mason', 'avatar': 'rhino', 'maturity': 'kids', 'locked': False, 'jellyfinUserId': 'demo-mason'},
                {'id': 5, 'name': 'Nan & Pa', 'avatar': 'bear', 'maturity': 'adult', 'locked': False, 'jellyfinUserId': 'demo-nan'},
            ],
            'avatars': [
                {'key': 'parrot', 'emoji': '🦜', 'from': '#1e3a5f', 'to': '#0b1a2e'},
                {'key': 'fox', 'emoji': '🦊', 'from': '#e50914', 'to': '#7a0410'},
                {'key': 'unicorn', 'emoji': '🦄', 'from': '#8e44ad', 'to': '#3b0f57'},
                {'key': 'rhino', 'emoji': '🦏', 'from': '#f5b400', 'to': '#8a5a12'},
                {'key': 'bear', 'emoji': '🐻‍❄️', 'from': '#2f9e6e', 'to': '#0b4d33'},
            ],
            'trending': {'days': 7,
                         'series': [{'id': i['Id'], 'viewers': 5 - n, 'plays': 20 - n} for n, i in enumerate(x for x in items if x['Type'] == 'Series')][:4],
                         'movies': [{'id': i['Id'], 'viewers': 5 - n % 5, 'plays': 15 - n} for n, i in enumerate(x for x in items if x['Type'] == 'Movie')][:6]},
        }, f, ensure_ascii=False, indent=1)

    # A 20-second clip for the player: the Remains backdrop drifting slowly, with a quiet tone.
    clip = os.path.join(OUT, 'clip.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', os.path.join(OUT, 'img', 's05' + 'a' * 29 + '-Backdrop.jpg'),
                    '-f', 'lavfi', '-i', 'sine=frequency=110:sample_rate=44100',
                    '-filter_complex', "[0:v]scale=1600:900,zoompan=z='min(zoom+0.0006,1.15)':d=500:s=1280x720:fps=25,format=yuv420p[v]",
                    '-map', '[v]', '-map', '1:a', '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
                    '-c:a', 'aac', '-b:a', '48k', '-af', 'volume=0.05', '-movflags', '+faststart', clip], check=True)
    total = sum(os.path.getsize(os.path.join(root, f)) for root, _, files in os.walk(OUT) for f in files)
    print(f'{len(items)} items, {total / 1e6:.1f} MB in {OUT}')


if __name__ == '__main__':
    main()
