# RPG Companion (Arcane Forge fork)

An RPG extension for SillyTavern and TauriTavern. It tracks your stats, the scene, the characters around you and what they're thinking, and shows it all in a side panel. It updates automatically and works with any preset.

> **About this fork.** This is a modified version of [RPG Companion](https://github.com/SpicyMarinara/rpg-companion-sillytavern) by Marysia (marinara_spaghetti), maintained by [Jam9172](https://github.com/Jam9172) since October 2026. It is not the official extension and is not endorsed by the original author. Please report problems with this fork here, not to the original author.
>
> Main changes:
> - the Arcane Forge theme, now the default (stat rings, portrait cards, ledger inventory, journal quests, Whisper thoughts and an original icon set),
> - Arcane Forge on phones and in TauriTavern,
> - a full-size portrait crop picker,
> - character stats sent to the main model, and NPCs that keep their own looks,
> - the deprecation popup removed.
>
> Every change is listed with its date in [CHANGELOG.md](CHANGELOG.md).

## 📥 Installation

1. Open SillyTavern or TauriTavern.
2. Open the Extensions tab (cubes icon at the top).
3. Click **Install extension**.
4. Paste this link and install:

   ```
   https://github.com/Jam9172/rpg-companion-sillytavern
   ```

For the Arcane Forge look across the rest of the app, also install [Arcane Forge UI](https://github.com/Jam9172/arcane-forge-ui) the same way.

## ✨ Features

- **📊 User stats**: customizable stats (shown as rings in Arcane Forge), mood, status fields, skills and classic RPG attributes with dice rolls.
- **🌍 Info box**: date, weather, temperature, time, location and recent events.
- **💭 Present Characters**: everyone in the scene, with portraits, custom fields, relationship badges, their own stats and their inner thoughts.
- **📦 Inventory**: what you carry, what you wear, what's stored where, and your assets.
- **📜 Quests**: a main quest and optional ones.
- **✏️ Live editing**: click almost any value to change it.
- **💾 Swipe-aware**: each swipe keeps its own tracker data.
- **🎛️ Tracker editor**: add or remove stats, fields and widgets, and edit the prompts.
- **➡️ Plot progression**: push the story along with a random event or a natural next step.
- **📜 Immersive HTML**: optional HTML/CSS elements inside the roleplay.
- **📱 Phones**: a tabbed layout and floating widgets on small screens.

## 🎨 Themes

- **Arcane Forge** (default): ember and brass, with stat rings, portrait cards, a ledger inventory, a quest journal and Whisper-style thoughts.
- **Default**: the original look.
- **Sci-Fi**, **Fantasy** and **Cyberpunk**.
- **Custom**: pick your own colours.

Change it under RPG Companion → Settings → Theme.

## ⚙️ Generation modes

- **Together**: the trackers come back inside the main reply and are removed from the chat text. One request, but the tracker format can slightly affect the roleplay.
- **Separate**: after each reply, a second request updates the trackers. Cleaner roleplay, one extra request.
- **External**: like Separate, but the trackers use their own OpenAI-compatible connection (base URL, model and key). Handy for a cheaper, faster model while the story keeps your main one.

In Separate and External mode, **Refresh RPG Info** updates the trackers at any time.

## 📝 How to use

1. Turn the extension on in the Extensions tab.
2. Pick a generation mode and which sections to show.
3. Start chatting. The trackers update by themselves.

**Editing:** click a stat, field, item, quest, character detail or thought to edit it. Edits are kept across swipes.

**Locking:** lock an item or field and the AI won't change it.

**Tracker editor:** Edit Trackers lets you change user stats, info box widgets, Present Characters fields, relationship options, character stats and the thoughts label. Everything you add is included in the prompts automatically.

**Guided Generations:** RPG Companion can skip its tracker prompts during guided generations (Settings → Advanced): never, only for impersonation, or for every guided generation.

## 🐛 Troubleshooting

- **Extension doesn't appear:** reload the page or app, and check it's enabled in the Extensions tab.
- **Trackers not updating:** check auto-update is on, try Refresh RPG Info, and check your API is answering. The browser console shows errors.
- **Looks wrong:** reload, then try turning other UI extensions off to find a conflict.

## 📋 Compatibility

- SillyTavern 1.11.0 or newer (tested on 1.19.0) and TauriTavern (tested on 2.4.0).
- Any chat backend.

## 🙏 Credits

Based on [RPG Companion](https://github.com/SpicyMarinara/rpg-companion-sillytavern) by Marysia (SpicyMarinara) and its contributors: Paperboygold, Munimunigamer, Subarashimo, Lilminzyu, Claude, IDeathByte, Chungchandev, Joenunezb, Amauragis, Tomt610 and Jakstein.

## 📜 License

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

Copyright (C) 2024 marinara_spaghetti

Modifications copyright (C) 2026 Jam9172

The full licence text is in [LICENSE](LICENSE).
