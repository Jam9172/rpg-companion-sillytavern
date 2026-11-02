"""Builds the Arcane Forge icon CSS block and appends it to style.css.

Each icon is an original 24x24 line drawing used as a CSS mask, so it takes
the colour of the text around it. Usage: python3 forge_icons.py <style.css>
"""
import sys
from urllib.parse import quote

ICONS = {
    # Panel title and tabs
    'fa-dice-d20': 'M12 2.5l8.5 4.9v9.2L12 21.5l-8.5-4.9V7.4z M12 7l4.5 7.8h-9z M12 2.5V7 M20.5 7.4l-4 7.4 M3.5 7.4l4 7.4 M7.5 14.8L12 21.5l4.5-6.7',
    'fa-dice': 'M4 7.5L12 3l8 4.5v9L12 21l-8-4.5z M4 7.5l8 4.5 8-4.5 M12 12v9',
    'fa-chart-simple': 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z M7.5 11.5H10l1.2-2.5 1.8 5 1.2-2.5h2.3',
    'fa-box': 'M5 9h14l-1 11H6z M9 9V7a3 3 0 0 1 6 0v2 M5 13h14 M11 13v2h2v-2',
    'fa-scroll': 'M8 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8 M8 4a2 2 0 0 0-2 2v1h2 M8 4v16 M8 20a2 2 0 0 1-2-2v-1h2 M11 9h5 M11 12.5h5 M11 16h3',
    # Actions
    'fa-plus': 'M12 5v14 M5 12h14',
    'fa-times': 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
    'fa-check': 'M5 12.5l4.5 4.5L19 7.5',
    'fa-edit': 'M20 4c-6 1-10 5-12 11l-2 5 5-2c6-2 10-6 11-12z M8.5 15.5l5-5',
    'fa-sync': 'M19 8.5a7.5 7.5 0 0 0-13.4-2 M5.5 3.5v3.5H9 M5 15.5a7.5 7.5 0 0 0 13.4 2 M18.5 20.5V17H15',
    'fa-sliders': 'M13 3.5l7.5 7.5-2.5 2.5L10.5 6z M12 7.5L4 15.5a1.8 1.8 0 0 0 2.5 2.5l8-8',
    'fa-gear': 'M12 3v2.5 M12 18.5V21 M3 12h2.5 M18.5 12H21 M5.6 5.6l1.8 1.8 M16.6 16.6l1.8 1.8 M5.6 18.4l1.8-1.8 M16.6 7.4l1.8-1.8 M12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12z M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
    'fa-trash': 'M4.5 7h15 M9.5 7V4.5h5V7 M6.5 7l1 13h9l1-13 M10.5 11v5.5 M13.5 11v5.5',
    'fa-chevron-right': 'M9.5 5.5l6.5 6.5-6.5 6.5',
    'fa-chevron-down': 'M5.5 9.5l6.5 6.5 6.5-6.5',
    # Feature toggles
    'fa-code': 'M8.5 7l-5 5 5 5 M15.5 7l5 5-5 5 M13.5 5l-3 14',
    'fa-palette': 'M14.5 4.5l5 5-7.5 7.5-5-5z M7 12l-2.5 2.5c-1 1-.5 4 2 4.5 2 .3 3-.5 4-1.5L13 15',
    'fa-masks-theater': 'M3 8c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v2.5c0 4-3 6.5-5.5 6.5-1.8 0-2.8-1-3.5-2.5-.7 1.5-1.7 2.5-3.5 2.5C6 17 3 14.5 3 10.5z M7 11h2.5 M14.5 11H17',
    'fa-eye-slash': 'M3 11c2.5 3.5 5.5 5 9 5s6.5-1.5 9-5 M6 14.5l-1.5 2 M12 16v2.5 M18 14.5l1.5 2',
    'fa-list-ol': 'M6 21V11a4 4 0 0 1 4-4h9 M16 4l3 3-3 3 M6 15a4 4 0 0 0 4 4h4',
    'fa-spotify': 'M9 18V5.5l10-2V16 M9 9.5l10-2 M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
    'fa-cloud-sun-rain': 'M7 15h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.5 1.5A3.3 3.3 0 0 0 7 15z M8 18l-1 2.5 M12 18l-1 2.5 M16 18l-1 2.5',
    'fa-book-open': 'M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z M12 6.5v13',
    'fa-user-plus': 'M4 5h11v14H4z M9.5 8.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M6 17c.8-2 2-3 3.5-3s2.7 1 3.5 3 M19 8v6 M16 11h6',
    # Collapsed strip widgets
    'fa-calendar': 'M4.5 6h15v14h-15z M4.5 10h15 M8.5 3.5v4 M15.5 3.5v4',
    'fa-location-dot': 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
    # Settings, Tracker editor and Prompts editor popups
    'fa-file-lines': 'M6 3h9l4 4v14H6z M15 3v4h4 M9 12h7 M9 15.5h7 M9 19h4',
    'fa-rotate-left': 'M4 4v5h5 M4.5 9A8 8 0 1 1 4 14',
    'fa-comment-dots': 'M4 5h16v11H9l-5 4z M9 10.5h.01 M12 10.5h.01 M15 10.5h.01',
    'fa-forward': 'M4 6l7 6-7 6z M13 6l7 6-7 6z',
    'fa-user-circle': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 7.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M6.5 18a6.5 6.5 0 0 1 11 0',
    'fa-list-check': 'M4 6l1.5 1.5L8 5 M4 12l1.5 1.5L8 11 M4 18l1.5 1.5L8 17 M11 6.5h9 M11 12.5h9 M11 18.5h9',
    'fa-arrow-right': 'M4 12h16 M14 6l6 6-6 6',
    'fa-fire': 'M12 21c-4 0-7-2.8-7-6.5 0-3.5 3-5.5 4-9 2 1.5 3 3.5 3 5.5 1-1 1.5-2.5 1.5-3.5 3 2 5.5 4.5 5.5 7.5 0 3.7-3 6.5-7 6.5z',
    'fa-save': 'M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6',
    'fa-cloud': 'M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.5 1.5A3.3 3.3 0 0 0 7 18z',
    'fa-eye': 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
    'fa-plug': 'M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4',
    'fa-arrows-rotate': 'M19 8.5a7.5 7.5 0 0 0-13.4-2 M5.5 3.5v3.5H9 M5 15.5a7.5 7.5 0 0 0 13.4 2 M18.5 20.5V17H15',
    'fa-star': 'M12 3l2.6 5.6 6 .6-4.5 4 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.5-4 6-.6z',
    'fa-heart-pulse': 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z M7.5 11.5H10l1.2-2.5 1.8 5 1.2-2.5h2.3',
    'fa-info-circle': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 11v6 M12 7.5h.01',
    'fa-users': 'M9 4.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M3.5 19a5.5 5.5 0 0 1 11 0 M16 5a2.6 2.6 0 0 1 0 5.2 M17.5 13.5A4.6 4.6 0 0 1 21 18',
    'fa-clock-rotate-left': 'M4 4v5h5 M4.5 9A8 8 0 1 1 4 14 M12 8v4l3 2',
    'fa-file-export': 'M6 3h9l4 4v6 M15 3v4h4 M6 3v18h8 M15 17h6 M18 14l3 3-3 3',
    'fa-file-import': 'M6 3h9l4 4v14H6z M15 3v4h4 M3 14h9 M9 11l3 3-3 3',
    'fa-face-smile': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M8.5 14a4.5 4.5 0 0 0 7 0 M9 9.5h.01 M15 9.5h.01',
    'fa-heart': 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    'fa-list': 'M8 6.5h12 M8 12h12 M8 17.5h12 M4 6.5h.01 M4 12h.01 M4 17.5h.01',
    'fa-arrow-up': 'M12 20V4 M6 10l6-6 6 6',
    'fa-arrow-down': 'M12 4v16 M6 14l6 6 6-6',
    'fa-chart-bar': 'M4 20h16 M7 20v-6 M12 20V8 M17 20v-10',
}

LOCK_OPEN = 'M6 11h12v9H6z M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2 M12 14.5v2.5'
LOCK_CLOSED = 'M6 11h12v9H6z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11 M12 14.5v2.5'

SCOPE = '.rpg-panel[data-theme="forge"]'
# Icons also apply inside these popups (and the phone panel toggle) when they carry the Forge theme
ICON_SCOPES = [
    SCOPE,
    '.rpg-settings-popup[data-theme="forge"]',
    '#rpg-tracker-editor-popup[data-theme="forge"]',
    '#rpg-prompts-editor-popup[data-theme="forge"]',
    '.rpg-mobile-toggle[data-theme="forge"]',
]


def data_uri(path_d):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" '
           'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'
           f'<path d="{path_d}"/></svg>')
    return 'url("data:image/svg+xml,' + quote(svg, safe='') + '")'


def build():
    names = sorted(ICONS)
    selector_list = ',\n'.join(f'    {s} i.{n}::before' for s in ICON_SCOPES for n in names)
    lines = [
        '',
        '/* ==========================================================================',
        '   Arcane Forge icon set',
        '   Original line icons drawn for this theme replace the stock Font Awesome',
        '   icons and lock emoji. Each is a mask, so it takes the surrounding colour.',
        '   (Generated from forge_icons.py; edit the paths there and regenerate.)',
        '   ========================================================================== */',
        f'{selector_list} {{',
        "    content: '';",
        '    display: inline-block;',
        '    width: 1.15em;',
        '    height: 1.15em;',
        '    vertical-align: -0.2em;',
        '    background-color: currentColor;',
        '    -webkit-mask: var(--forge-icon) center / contain no-repeat;',
        '    mask: var(--forge-icon) center / contain no-repeat;',
        '}',
        '',
    ]
    for n in names:
        lines.append(f"{', '.join(f'{s} i.{n}' for s in ICON_SCOPES)} {{ --forge-icon: {data_uri(ICONS[n])}; }}")
    lines += [
        '',
        '/* Lock emoji become drawn padlocks; brass when locked */',
        f'{SCOPE} .rpg-section-lock-icon {{',
        '    font-size: 0 !important;',
        '    line-height: 0;',
        '}',
        '',
        f'{SCOPE} .rpg-section-lock-icon::before {{',
        "    content: '';",
        '    display: inline-block;',
        '    width: 0.875rem;',
        '    height: 0.875rem;',
        '    background-color: var(--forge-muted);',
        f'    -webkit-mask: {data_uri(LOCK_OPEN)} center / contain no-repeat;',
        f'    mask: {data_uri(LOCK_OPEN)} center / contain no-repeat;',
        '}',
        '',
        f'{SCOPE} .rpg-section-lock-icon.locked::before {{',
        '    background-color: var(--forge-brass);',
        f'    -webkit-mask-image: {data_uri(LOCK_CLOSED)};',
        f'    mask-image: {data_uri(LOCK_CLOSED)};',
        '}',
        '',
    ]
    return '\n'.join(lines)


if __name__ == '__main__':
    path = sys.argv[1]
    marker = 'Arcane Forge icon set'
    text = open(path, encoding='utf-8').read()
    block = build()
    if marker in text:
        # Replace the existing block: from its banner comment to the next banner comment (or end of file)
        banner = '\n/* ' + '=' * 74
        start = text.rfind(banner, 0, text.index(marker))
        assert start != -1, 'could not find the start of the icon block'
        end = text.find(banner, text.index(marker))
        end = len(text) if end == -1 else end
        text = text[:start] + block.rstrip('\n') + '\n' + text[end:]
        open(path, 'w', encoding='utf-8').write(text)
        action = 'replaced'
    else:
        with open(path, 'a', encoding='utf-8') as f:
            f.write(block)
        action = 'appended'
    after = open(path, encoding='utf-8').read()
    assert after.count(marker) == 1 and block.strip() in after
    print(f'{action} {len(ICONS)} icons + 2 locks across {len(ICON_SCOPES)} scopes')
