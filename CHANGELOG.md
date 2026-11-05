# Changelog

Changes in this fork of [RPG Companion](https://github.com/SpicyMarinara/rpg-companion-sillytavern), newest first. Changes collect under "Unreleased" and ship together in the next release. The original extension's history before the fork is in the git log.

## Unreleased (next release: 1.1.0)

- Cast now keeps only each character's own memory, written in first person and kept short: **Doing now** (what I'm doing right now, one short sentence) and **What happened** (a short timeline for continuity, not every detail: one short sentence per finished activity, and past five entries everything but the newest three is retold as one summary of a sentence or two). Looks, personality, relationships, goals and locations are no longer tracked: the background model reads them from the character cards, the Status tab and the story. Both lists can be edited in place in the Cast tab. Characters who are here with you are not tracked (the story shows what they do): Doing now runs only while they are away, everything tracked is marked off-screen, and when they come back nothing new is written for them: what they were last doing (only the latest step) is kept, as it was, in What happened.
- Clearer Cast instructions for the background model. It now answers with who is **here** and what the **away** characters did, instead of one mixed list, so characters who never left are no longer moved to away and characters standing in the scene no longer get off-screen entries. The instructions talk to the model directly and only the memory itself is in first person, the ledger groups characters by here and away (not by who was mentioned), and the reply uses the same names as the Cast tab (Doing now, What happened).
- The main model now always knows what every away character is doing right now, not only the ones mentioned in the latest messages (one line each, under "Elsewhere right now"). It is told to bring them into the story only when it fits naturally, and not to have them come looking for you, step in for you without a reason of their own, or become fixated on you.
- **Forget this character** now forgets them for good: later updates never add them back (by full or short name), undoing an update with a swipe, delete or Refresh never restores them, and the main model's notes drop them at once. Forgotten characters are listed under the Cast list, and clicking one tracks them again from scratch.
- New **Tidy** button in the Cast tab: the background model compresses every character's memory (merges and shortens What happened, cuts Doing now down to what is true right now) and fixes mistakes such as repeats, contradictions with the story, misspelled names and entries in third person. It never makes anything up. The fixes it made are listed under the buttons, and **Undo tidy** puts everything back until the next update. Locked characters are left alone.
- Cast's background model is tuned for speed and cost (tested on DeepSeek V4.1 Flash 1017). A new **Background model** section in the Cast tab picks the **Connection** (RPG Companion's, or any Connection Profile, so Cast can use its own model), **Reasoning** (Off by default: the model's hidden thinking was most of each update's cost) and **Strict JSON** (replies have to match Cast's format; a connection that refuses it is retried without). Updates now cost about half as much, with the same results in testing. Tidy always thinks at least a little, since it misses contradictions without it.
- Cast's instructions were rewritten to be shorter, with one worked example, and ordered so the parts that stay the same between updates come first and can be served from the model's prompt cache (cheaper, and much cheaper in Whole story mode).
- **Meanwhile** under each reply: a small fold with what changed off-screen during it (who left the scene or came back, and what the away characters started and finished), so scrolling up reads as a timeline of the background story. It follows swipes, deletes and Refresh, and can be turned off in the Cast tab's Settings ("Show Meanwhile under replies"). The Cast tab's "Background model" fold is now called Settings.
- **Archive**: when a character's What happened gets long, the oldest entries are no longer lost in the summary. They move to the character's archive (a fold on their Cast card), tagged with the people, places and things in them, and when one of those comes up in the story, Cast brings the memory back into the main model's notes. Keywords can be edited in place, and an archived memory can be removed. Undoing a reply undoes what it archived. Summaries of off-screen entries are now marked off-screen too.
- **Story so far**: each reply adds a one-sentence story beat, and every 20 beats are retold as a chapter (after 8 chapters, the oldest 4 become one "Earlier" part). It is shown in the Cast tab, where every line can be edited, and sent to the main model as a short "Story so far" note near the end of the prompt, next to Cast's notes, which can be turned off in Settings ("Send Story so far to the main model").
- Summing up old memories and writing chapters now happen in a small follow-up call (about once every 20 replies) instead of inside the regular update, which got them wrong when it had to do everything at once.
- Cast no longer adds characters that are not in the story: a new name from the background model is only added when the messages Cast read, or the Status tab, name them, and a narrator or game master card is not tracked. Replies are labelled "Story" for the background model instead of with the card's name, which it was blending into character names. A garbled "who is here" list moves nobody out of the scene, and characters the Status tab lists as present stay present.
- Cast reads the story's date and time from the Info Box and tells the background model how much time passed since the last update ("about 3 hours"), so away characters move along by the right amount. It understands made-up calendars (14 → 17 Frostfall), weekdays and 12-hour times, and says nothing when the Info Box can't tell.
- **Elsewhere** button at the top right of the chat (with how many characters are away): it opens what every away character is doing right now, their earlier steps, what they last finished and how long since you saw them. A centred overlay on desktop, a full-screen sheet on phones; it closes with ×, Escape or a click outside. It only shows while someone is away, and can be turned off in Cast Settings.
- **Key memories**: the background model flags a finished activity a character will carry for a long time (a death, a betrayal, a promise, a big win or loss, a secret). Key memories are never summed up or archived, the main model gets them ("Never forget") whenever the character is here or mentioned, Tidy keeps them as their own entries, and Meanwhile marks them with a star. Any What happened entry can be starred or unstarred in the Cast tab (up to 5 per character), and a starred entry keeps its star when edited.
- The Meanwhile fold ends before the swipe arrows and counter instead of running under them.
- Cache friendly: everything RPG Companion adds to the main prompt now sits near the end. "Story so far" used to go in with the main prompt, before the chat, and changed after every reply, so a provider's prompt cache had to read the whole chat again each time; now the main prompt, the cards and nearly all of the chat stay exactly the same from one reply to the next and can come from the cache (cheaper and faster on providers that cache).
- History Persistence is cache friendly too: its window of past notes now moves in steps. Before, the oldest note dropped off on every reply, so everything after it had to be read again; now the notes stay on the same messages and the oldest ones drop off together once every that many replies (with 5, the prompt only changes near the end on 4 replies out of 5). It sends between the set number of notes and almost twice that; turn off **Cache friendly** in the History Persistence tab to always send exactly that many.
- Cast's **What happened** stays short. Before, each entry was two or three sentences, ten entries could pile up before any were summed up, and a character coming back glued every step of their last activity into one long entry. Existing long memories are summed up on the next updates; press **Tidy** to shorten a chat's memory at once (it now aims for at most four entries of one short sentence each).
- Cast's **Reasoning** setting now works on every External API, not only OpenRouter: NanoGPT and other OpenAI-style APIs get it too (before, Off, Low and Model default all sent the same request there). On a NanoGPT Connection Profile, Off no longer fails in TauriTavern, and Low on a DeepSeek profile now actually thinks a little. A connection that turns the reasoning setting down is retried once with the model's default, and TauriTavern now reports Cast's failed requests as errors instead of handing back the error as the reply.
- Cast ignores junk names in a reply, so a garbled answer can no longer move characters out of the scene.
- The edit outline around **Time** and **Location** in the Info Box is no longer cut off at the edges (desktop and phone).
- Editing the Info Box no longer redraws it under you: clicking from one field into another used to rebuild the whole box and drop what you typed next. Saves still happen right away; the box redraws once you leave it (also when a background tracker update finishes while you are typing).
- Arcane Forge: the edit outline around a Recent Events line is no longer cut off at the top and right edge.
- Phones: the panel's tab bar fits every tab (icon over a short label), so Cast and Quests are no longer pushed off the edge.
- Phones (Arcane Forge, "Thoughts Button" on): the thought icon opens every character's thought card as a full-screen sheet that scrolls, with a pinned "Thoughts" header and × to close, instead of the narrow column.
- **Cast (character memory)**, on by default. After each reply, a background request on your tracker model (External API, or the main API in Separate and Together modes) keeps a lasting record of the story's major characters (named characters who matter to the story; passing extras are left out): role, what they want, looks, personality, how they feel about you, where they were last seen, and what they did. Their lives go on while you are elsewhere: when story time passes, characters who are away get one plausible off-screen development that follows from their goal ("finished the commission for the baron"), marked as off-screen so the story knows you have not seen it. Away characters reach the background model with their full entry (looks, relationship, background and every event), and each off-screen development builds on their earlier ones, so their own story keeps moving. "Doing now" runs the whole time a character is away: every away character always has a current off-screen activity, moved along with the story's time, and each finished activity goes into "What happened" as the next one starts. When they are back in a scene with you, whatever they were still doing is folded into "What happened". Away characters act on their own: they chase their goals, make plans, deal with other people and the fallout of what they did, and get new goals when old ones are reached. They never idle or wait around for you. Deaths, meeting you and walking into your scene stay with the main story. Memory stays short in three levels: steps for what a character is doing now, events once an activity is over ("went to the store and got 10 eggs"), and a short background once events pile up. Before each reply, characters in the scene or mentioned in the last two messages are sent to the main model in full, and everyone else as a one-line roster. Each update is tied to its message, so deleting or swiping that message undoes it. A new **Cast** tab lists everyone: edit any field in place, remove events, lock a character so the background model leaves them alone, or forget them. A **Reads** picker at the top of the Cast tab sets how much of the story the background model reads on each update: the last 4, 10, 25, 50 or 100 messages, a custom number, or the whole story (best memory, most tokens). The newest two messages are what it records; anything earlier is context. It also reads the characters on the Status tab (Present Characters: details, relationship and thoughts), treats them as in the scene, and adds any major character it is missing. A **Refresh** button redoes the update for the latest message: whatever that message changed is undone, then it is read again. A status line shows when the cast last updated, or why the last update failed. Turn it off with "Cast (Character Memory)" in the settings. Adds one request per reply.
- Dialogue that opens with “ and closes with " (common at the end of a reply), or the other way round, is now coloured. New replies get the marks paired (“…”) before they are shown and saved, so the line no longer stays plain, and narration between two such lines is no longer coloured by mistake. On by default; "Fix Mismatched Quotes" in the settings turns it off. Earlier messages are not changed.

## 1.0.0 (2026-11-02): RPG Companion Arcane

- The fork is renamed **RPG Companion Arcane** and starts its own version numbers at 1.0.0. This release comes after 3.9.0; the lower number is on purpose.
- The What's New popup is updated for 1.0.0 (shown once after updating).
- The panel title, Extensions entry and settings now say RPG Companion Arcane. In Arcane Forge the panel title stays on one line.
- The Recommended Models note no longer shows stray ** marks.
- New Thoughts button (Arcane Forge, desktop, on by default): one "Thoughts" button with a count at the top left of the chat opens every character's thought card in a centred overlay that scrolls. Close it with ×, Escape or a click outside. Turn off "Thoughts Button (Arcane Forge)" in the settings to get the column of cards back.
- Arcane Forge thoughts (Whisper) on desktop: with several cards open, the column is a little taller than one card (so one always fits), starts below any bar above the chat (such as Top Info Bar, which Memory Books uses) and stops above the message box, with room at both ends. The other cards scroll: an always-visible brass scrollbar and arrow buttons at the top and bottom edge show there is more, scrolling it does not move the chat, and opening a card slides it into view.
- The main reply no longer starts printing "Context for the scene:" with the tracker data. History Persistence's notes now go on your messages instead of the AI's own, so the AI stops copying them. Existing settings and tracker presets are moved over once. The notes are also tagged as hidden, and the scene context always tells the model never to repeat it, even with a custom instructions prompt.

## 3.9.0 (2026-11-02)

- The What's New popup is rewritten for this fork (shown once after updating).
- Arcane Forge follows Arcane Forge UI's colour pickers when that extension is on, floating widgets included.
- Phones: Whisper thoughts open from a Forge whisper icon and close with their own button; the panel toggle gets the Forge d20.
- The chat window can be moved again with SillyTavern's MovingUI (a forced margin from the original extension pinned it).
- Keyboard focus ring in the Forge panel.
- Fonts are bundled, so the Forge theme works offline and nothing loads from Google.

## 3.8.0 (2026-11-01)

First release of this fork. It includes every change listed below. The Arcane Forge UI is an early, slow-moving beta.

## 2026-11-01: README rewrite

- README rewritten for this fork: install, features, themes, generation modes (including External), how to use and troubleshooting are up to date.
- Removed the original author's Discord, Ko-fi and deprecation notice so support for this fork comes here. Her copyright, the AGPL licence notice and credits to her and the contributors are kept.

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
