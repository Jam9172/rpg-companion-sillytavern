# Changelog

Changes in this fork of [RPG Companion](https://github.com/SpicyMarinara/rpg-companion-sillytavern), newest first. Each entry is one update published to GitHub. The original extension's history before the fork is in the git log.

## 2026-11-01: NPCs keep their own looks

- Present Characters: NPCs no longer borrow the character card's looks or personality. The tracker prompt now says each card belongs only to its own character, and each entry must be described from what the story says about that character.

## 2026-11-01: Arcane Forge by default

- New installs start on the Arcane Forge theme.
- Existing installs still on the stock "Default" theme switch to Arcane Forge once. Anyone who picked another theme keeps it.
- README: fork notice updated, install link points to this fork, Arcane Forge added to the themes list, and this changelog.

## 2026-11-01: Phones and polish

- Arcane Forge on phones: stat rings, portrait banner, attribute tiles, text-style info box and Forge-coloured floating widgets.
- Phones: full character cards, tighter inventory rows and one-line quests.
- Inventory filters are an equal-width bar with a sliding highlight.
- The "is thinking" Whisper pill stays inside the chat column, so side panels never cover it.
- Info box labels and values line up.

## 2026-11-01: First public release

Arcane Forge theme:
- Ember palette, wedge-ring stats, portrait cards and per-stat status words.
- Text-style info section, ornamental dividers and an original icon set (including inside the Settings, Tracker and Prompts popups).
- Ledger-style inventory with an "All" filter, and journal-style quests.
- Whisper-style floating thoughts.
- Full-size character portraits with a crop-focus picker.
- User portrait banner, character stat rings and clearer feature toggles on one scrolling row.
- Panel top joins SillyTavern's top bar.

Everything else:
- Character stats from Present Characters are sent to the main model, and included in history.
- User stats in context show what changed, e.g. "Health: 42 (was 40)".
- Uploaded character avatars are shrunk before saving.
- The side panel is one readable scroll area with full-width stats.
- Dice display is off by default.
- The deprecation popup is removed.
