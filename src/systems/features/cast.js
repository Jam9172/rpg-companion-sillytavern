/**
 * Cast: character persistence for the whole story.
 *
 * A ledger of the story's major characters, saved in the chat's metadata so it lasts the whole story.
 * It keeps only each character's own memory, written in first person:
 *   Doing now     - what I am doing right now; it never stops for characters who are away
 *   What happened - each finished activity in a few sentences; the oldest fold into one summary
 * Looks, personality and relationships are not tracked: they come from the character cards and the story.
 *
 * After each reply a background model updates the characters involved and moves the ones who are away
 * along off-screen. Before each reply the characters in the scene or recently mentioned are fed to the
 * main model, with a list of everyone else's names. Every update remembers the message that caused it, so
 * deleting or swiping that message undoes it.
 */

import {
    chat,
    chat_metadata,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    saveChatDebounced,
    setExtensionPrompt,
} from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { extensionSettings, isGenerating, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { generateWithExternalAPI } from '../generation/apiClient.js';
import { getCharacterCardsInfo } from '../generation/promptBuilder.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

const PROMPT_KEY = 'rpg-companion-cast';
const METADATA_KEY = 'rpg_cast';

// Limits that keep each character short
const MAX_STEPS = 6;          // more than this and the activity is folded into an event
const MAX_EVENTS = 10;        // more than this and the oldest are folded into one summary
const EVENTS_TO_FOLD = 6;     // how many of the oldest events go into that summary at once
const EVENTS_IN_PROMPT = 3;   // recent events shown to the main model per character
const CARDS_LIMIT = 6000;     // characters of card descriptions sent to the background model
const MAX_JOURNAL = 200;      // undo entries kept (older ones can no longer be rolled back)

const listeners = [];
let updateQueue = Promise.resolve();

// The background update's state, shown in the Cast tab
const castStatus = { running: false, lastOk: null, lastError: null };

/** @returns {{running: boolean, lastOk: number|null, lastError: string|null}} */
export function getCastStatus() {
    return { ...castStatus };
}

function notify() {
    listeners.forEach((fn) => {
        try { fn(); } catch (e) { console.error('[RPG Companion] Cast listener failed:', e); }
    });
}

/* ---------- Ledger ---------- */

/**
 * The current chat's cast ledger, created on first use.
 * @returns {{version: number, characters: Object<string, Object>, journal: Array}}
 */
export function getCast() {
    if (!chat_metadata[METADATA_KEY] || typeof chat_metadata[METADATA_KEY] !== 'object') {
        chat_metadata[METADATA_KEY] = { version: 1, characters: {}, journal: [] };
    }
    const cast = chat_metadata[METADATA_KEY];
    cast.characters ??= {};
    cast.journal ??= [];
    return cast;
}

/** @returns {string} A stable key for a character name */
export function castKey(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function newCharacter(name) {
    return {
        name: String(name).trim(),
        aliases: [],
        status: 'present',
        events: [],
        steps: [],
        locked: false,
        firstSeen: chat.length - 1,
        lastSeen: chat.length - 1,
    };
}

/** Finds a character by name or alias. */
export function findCharacter(cast, name) {
    const key = castKey(name);
    if (!key) return null;
    if (cast.characters[key]) return cast.characters[key];
    const characters = Object.values(cast.characters);
    const byAlias = characters.find((c) => (c.aliases || []).some((a) => castKey(a) === key));
    if (byAlias) return byAlias;
    // A shorter or longer form of a known name ("Mira" for "Mira Ashdown", or the other way round),
    // when it fits exactly one character
    const words = key.split(' ');
    const partial = characters.filter((c) => {
        const known = castKey(c.name).split(' ');
        const [shorter, longer] = words.length <= known.length ? [words, known] : [known, words];
        return shorter.every((w) => longer.includes(w));
    });
    return partial.length === 1 ? partial[0] : null;
}

/** All characters, the most recently seen first. */
export function listCharacters() {
    return Object.values(getCast().characters).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

function saveCast() {
    saveChatDebounced();
    notify();
}

/** Calls fn whenever the cast changes (used by the Cast tab). */
export function onCastChanged(fn) {
    listeners.push(fn);
}

/* ---------- Editing from the Cast tab ---------- */

/**
 * Changes a character's fields by hand. Hand edits are not tied to a message, so they are never rolled back.
 * @param {string} name - The character
 * @param {Object} fields - Fields to set
 */
export function editCharacter(name, fields) {
    const cast = getCast();
    const character = findCharacter(cast, name);
    if (!character) return;
    Object.assign(character, fields);
    saveCast();
}

/** Removes a character from the cast by hand. */
export function deleteCharacter(name) {
    const cast = getCast();
    const character = findCharacter(cast, name);
    if (!character) return;
    delete cast.characters[castKey(character.name)];
    saveCast();
}

/* ---------- Message identity (for rollback) ---------- */

function messageSignature(index) {
    const message = chat[index];
    if (!message) return null;
    return `${message.send_date ?? ''}|${message.swipe_id ?? 0}`;
}

/**
 * Undoes updates whose message is gone: deleted, swiped to another reply, or cut off by going back.
 * Newest updates are undone first, so earlier ones stay intact.
 */
export function reconcileCast() {
    if (!chat_metadata?.[METADATA_KEY]) return;
    const cast = getCast();
    let changed = false;
    while (cast.journal.length) {
        const entry = cast.journal[cast.journal.length - 1];
        if (messageSignature(entry.messageIndex) === entry.signature) break;
        // An earlier message was deleted and this one moved up: follow it instead of undoing
        const movedTo = chat.findIndex((_, i) => messageSignature(i) === entry.signature);
        if (movedTo >= 0) {
            cast.journal.forEach((e) => {
                const at = chat.findIndex((_, i) => messageSignature(i) === e.signature);
                if (at >= 0) e.messageIndex = at;
            });
            changed = true;
            break;
        }
        for (const [key, before] of Object.entries(entry.before)) {
            if (before === null) delete cast.characters[key];
            else cast.characters[key] = before;
        }
        cast.journal.pop();
        changed = true;
    }
    if (changed) {
        saveCast();
        refreshCastPrompt();
    }
}

/* ---------- Background update ---------- */

/** A character's ledger entry as the background model sees it: their own memory only. */
function compact(character) {
    const out = { name: character.name, status: character.status };
    if (character.aliases?.length) out.aliases = character.aliases;
    if (character.events?.length) out.what_happened = character.events;
    if (character.steps?.length) out.doing_now = character.steps;
    return out;
}

function messageText(message) {
    return String(message?.mes ?? '').replace(/<[^>]*>/g, '').trim();
}

/**
 * How many messages the background model reads per update: 0 means the whole story.
 * @returns {number}
 */
export function castReadRange() {
    const value = Number(extensionSettings.castUpdateDepth ?? 4);
    if (!Number.isFinite(value) || value < 0) return 4;
    return value === 0 ? 0 : Math.max(2, Math.round(value));
}

/** The in-story date, time and place from RPG Companion's Info Box, if it has one. */
function sceneInfo() {
    const info = lastGeneratedData?.infoBox || committedTrackerData?.infoBox;
    if (!info) return '';
    return String(info).replace(/\s+/g, ' ').slice(0, 500);
}

/**
 * The characters on RPG Companion's Status tab (Present Characters), as short lines: who the tracker
 * says is in the scene now, with their details, relationship and thoughts.
 */
export function statusPanelCharacters() {
    const raw = lastGeneratedData?.characterThoughts || committedTrackerData?.characterThoughts;
    if (!raw) return '';
    try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.characters) ? parsed.characters : null);
        if (list) {
            return list.filter((c) => c?.name).map((c) => {
                const parts = [];
                for (const [key, value] of Object.entries(c.details || {})) {
                    if (value) parts.push(`${key.replace(/_/g, ' ')}: ${value}`);
                }
                const relationship = c.relationship?.status || c.relationship;
                if (relationship && typeof relationship === 'string') parts.push(`relationship: ${relationship}`);
                const thoughts = c.thoughts?.content || (typeof c.thoughts === 'string' ? c.thoughts : '');
                if (thoughts) parts.push(`thinking: ${thoughts}`);
                return `- ${c.name}${parts.length ? `: ${parts.join('; ')}` : ''}`;
            }).join('\n').slice(0, 3000);
        }
    } catch {
        // Older text format: pass it on as it is
    }
    return String(raw).slice(0, 3000);
}

/**
 * A character who is away gets their whole memory (every event and step), so their off-screen story
 * has everything it needs to continue, plus how long it has been since they were last seen.
 */
function awayEntry(character, messageIndex) {
    return {
        ...compact(character),
        replies_since_seen: Math.max(0, messageIndex - (character.lastSeen ?? messageIndex)),
    };
}

/**
 * Builds the background model's request: the character cards (for who everyone is), the ledger, the
 * latest messages, and the rules for major characters, first-person memory and off-screen lives.
 */
async function buildUpdatePrompt(messageIndex) {
    const cast = getCast();
    const context = getContext();
    const userName = context.name1 || 'User';
    // How far back the model reads (0 = the whole story). The last two messages are what to record;
    // anything before them is context only.
    const range = castReadRange();
    const first = range === 0 ? 0 : Math.max(0, messageIndex - range + 1);
    const recent = chat.slice(first, messageIndex + 1).filter((m) => !m.is_system);
    const earlier = recent.slice(0, -2);
    const latest = recent.slice(-2);
    const recentText = latest.map((m) => messageText(m)).join('\n');

    const characters = Object.values(cast.characters);
    const inScene = characters.filter((c) => c.status === 'present' || isMentioned(c, recentText));
    const away = characters.filter((c) => !inScene.includes(c) && c.status !== 'dead');
    const needsSummary = characters.filter((c) => (c.events?.length || 0) > MAX_EVENTS).map((c) => c.name);
    // Away characters with nothing in "Doing now" must be given an activity this time
    const idle = away.filter((c) => !c.steps?.length).map((c) => c.name);
    const scene = sceneInfo();
    const statusPanel = statusPanelCharacters();
    let cards = '';
    try {
        cards = String(await getCharacterCardsInfo() || '').trim().slice(0, CARDS_LIMIT);
    } catch {
        // No card info: the story itself is the context
    }

    const system = `You keep the cast ledger for an ongoing roleplay story: the lasting memory of its major characters (everyone except ${userName}), kept for the whole story. For each character it holds only two things, both written by the character in FIRST PERSON:
- "Doing now": what I am doing right now.
- "What happened": what I have done and been through, one entry per finished activity.
Do not track looks, personality, relationships or anything else: the character cards, the status panel and the story already describe who everyone is. Read them for context. You never write story text, only the requested JSON.

Who belongs in the ledger:
- Only MAJOR characters: named characters who matter to the story. They interact with ${userName} in a meaningful way, keep coming back, or affect the plot. The main character of the story always counts.
- Leave out minor characters: passing extras, waiters, guards, crowds, one-line strangers. Add one later only if they become important.
- Use the exact name already in the ledger for known characters (match nicknames and titles to them). Never record ${userName}.

Characters who are here (status "present", in the scene with ${userName}): do not track their actions. The story itself shows what they do. For them, only report "status" when it changes (for example "away" when they leave the scene, and from then on they get "Doing now"). Never give them a "step", and no "finish" except the one when they come back from off-screen.

How to write for characters who are away, always in the character's own voice ("I", "me", "my"), fleshed out rather than bare notes:
- "step": what I am doing right now, present tense, one or two sentences with the detail that matters: what I am doing, how, and why or how I feel about it. ("I'm hauling crates off the barge at the docks, counting every one twice because the Vey's man is watching.") Only for a NEW development: do not repeat a step that is still true; ten turns of shopping is one step.
- "finish": when an activity is over (I left, the scene moved on, or it reached its result), what happened in two or three sentences, past tense: what I did, how it turned out, and what it means for me. ("I went to the store and got ten eggs. The old man at the till tried to short-change me and I let it go; I wasn't in the mood for a fight.") It replaces my steps. If I have ${MAX_STEPS} or more steps, finish now.
- "status": "present" when I am in the current scene, "away" when I am not, "dead" if I died. Only when it changes.
- Match each character's own voice and way of speaking, as the cards and the story show it.
${needsSummary.length ? `- "summary": for ${needsSummary.join(', ')}, retell my ${EVENTS_TO_FOLD} oldest "What happened" entries as one first-person paragraph (three to five sentences) that keeps what still matters to me. It replaces them.\n` : ''}
${statusPanel ? `The status panel (Present Characters tracker) lists who is in the scene right now. Treat its major characters as present, and add any major character from it who is missing from the ledger.

` : ''}Off-screen lives (characters under "away"): my life keeps going the whole time ${userName} is elsewhere. I am the lead of my own story, with my own plans, not an extra waiting in the wings for ${userName}.
- "Doing now" never stops: every away character always has a current off-screen activity, until they are back in a scene with ${userName}. Mark every off-screen change with "offscreen": true.
- Be proactive. Each activity pushes my own story forward: I chase what I want, make and carry out plans, take risks, seek people out, make deals, pick fights, follow leads, and deal with the consequences of what I did before. When I get what I wanted, or it falls through, I go after something new.
- No idling: never "waiting for ${userName}", "thinking about ${userName}", "resting", "passing time" or "going about my day". Sleep, meals and travel only when the story's time calls for them, and even then something can happen. Thinking about ${userName} only counts when it drives an action (going to look for them, getting something ready for them).
- My world has other people in it: I can meet, help or clash with other characters from the ledger and with people of my own (a rival, a boss, a lover, a creditor). Keep them inside my activity, not as new ledger entries, unless they become major.
- Move each away character along in proportion to the story time that passed in the NEW messages. A few minutes: the same activity continues, or the next small move in my plan. Longer: "finish" the activity AND give the next "step" in the same entry, so "Doing now" is never empty and my story keeps going.
${idle.length ? `- These away characters have nothing in "Doing now" yet; give each one a purposeful activity now: ${idle.join(', ')}.\n` : ''}- Build on my whole memory and on who I am in the cards and the story: continue my earlier off-screen steps and entries, so my story moves forward one believable piece at a time.
- Big moves are fine when they follow from who I am and what I want (a new job, a betrayal, a debt paid off, a move to another town). Off limits: deaths, meeting ${userName}, and arriving in ${userName}'s scene, which only the main story decides.
- When an away character comes back into a scene with ${userName}, set "status": "present" and "finish" the off-screen activity with what I was up to.

Reply with JSON only:
{"characters": [{"name": "Name", "status": "away", "step": "I'm ...", "finish": "I ...", "offscreen": false, "summary": "..."}]}
Leave out keys you do not need. Use {"characters": []} if nothing changed.`;

    const ledger = {
        in_scene_or_mentioned: inScene.map((c) => compact(c)),
        away: away.map((c) => awayEntry(c, messageIndex)),
    };

    const format = (messages) => messages.map((m) => `${m.is_user ? userName : (m.name || 'Narrator')}: ${messageText(m)}`).join('\n\n');
    const story = earlier.length
        ? `${range === 0 ? 'The story so far' : 'Earlier messages'} (context only; the ledger already holds what mattered):\n<earlier>\n${format(earlier)}\n</earlier>\n\n`
        : '';

    return [
        { role: 'system', content: system },
        { role: 'user', content: `${cards ? `Character cards (who everyone is):\n<cards>\n${cards}\n</cards>\n\n` : ''}Current ledger:\n${JSON.stringify(ledger)}\n${scene ? `\nCurrent scene info: ${scene}\n` : ''}${statusPanel ? `\nStatus panel, characters in the scene now:\n${statusPanel}\n` : ''}\n${story}NEW messages (record these; the last one is the newest):\n<messages>\n${format(latest)}\n</messages>\n\nUpdate the ledger. JSON only.` },
    ];
}

function parseUpdate(text) {
    if (typeof text !== 'string') return null;
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const data = JSON.parse(cleaned.slice(start, end + 1));
        return Array.isArray(data?.characters) ? data.characters : null;
    } catch {
        return null;
    }
}

const STATUSES = ['present', 'away', 'dead'];
export const OFFSCREEN_PREFIX = '(off-screen) ';

/**
 * Applies the background model's changes, recording each touched character's previous state so the
 * update can be undone with its message.
 * @returns {number} How many characters changed
 */
export function applyCastUpdate(updates, messageIndex) {
    const cast = getCast();
    const userKey = castKey(getContext().name1);
    const before = {};
    let changed = 0;

    for (const update of updates) {
        const name = String(update?.name || '').trim();
        if (!name || castKey(name) === userKey) continue;

        let character = findCharacter(cast, name);
        if (character?.locked) continue;
        if (character && castKey(character.name) !== castKey(name) && !(character.aliases || []).some((a) => castKey(a) === castKey(name))) {
            if (!(castKey(character.name) in before)) before[castKey(character.name)] = structuredClone(character);
            character.aliases = [...(character.aliases || []), name];
        }
        const key = character ? castKey(character.name) : castKey(name);
        if (!(key in before)) before[key] = character ? structuredClone(character) : null;
        if (!character) {
            character = newCharacter(name);
            cast.characters[key] = character;
        }

        // Status may come at the top level or, from older replies, inside "set"
        const status = String(update.status ?? update.set?.status ?? '').trim().toLowerCase();
        if (STATUSES.includes(status)) character.status = status;

        // Characters who are here are not tracked: the story shows what they do. The one exception is
        // coming back from off-screen, when what they were up to is closed into "What happened".
        const wasHere = before[key] ? before[key].status === 'present' : true;
        const isHere = character.status === 'present';
        const rejoining = isHere && !wasHere;
        // Everything tracked happens away from the user, so it is always marked off-screen
        const offscreen = !isHere || rejoining;
        const mark = (text) => (offscreen ? OFFSCREEN_PREFIX : '') + text.trim();
        if (!isHere || rejoining) {
            if (typeof update.finish === 'string' && update.finish.trim()) {
                character.events.push(mark(update.finish));
                character.steps = [];
            }
            if (!isHere && typeof update.step === 'string' && update.step.trim() && character.steps.at(-1) !== mark(update.step)) {
                character.steps.push(mark(update.step));
            }
        }
        // Back in the scene with off-screen steps still open: fold them into one off-screen event
        if (rejoining && character.steps.length) {
            const open = character.steps.map((step) => step.replace(OFFSCREEN_PREFIX, ''));
            character.events.push(OFFSCREEN_PREFIX + open.join(' Then '));
        }
        // Nothing is "Doing now" while they are here
        if (isHere) character.steps = [];
        // The model forgot to finish a long activity: keep only the latest steps
        if (character.steps.length > MAX_STEPS) character.steps = character.steps.slice(-MAX_STEPS);

        // The oldest entries retold as one summary, which takes their place
        const summary = typeof update.summary === 'string' ? update.summary.trim() : '';
        if (summary && character.events.length > MAX_EVENTS) {
            character.events = [summary, ...character.events.slice(EVENTS_TO_FOLD)];
        }

        if (offscreen && !isHere) {
            // Something happened to them elsewhere, so they are not in this scene
            if (character.status === 'present') character.status = 'away';
        } else {
            character.lastSeen = messageIndex;
        }
        changed++;
    }

    // When the model names who is in the scene, everyone else who was present has stepped out of it
    const touched = new Set(Object.keys(before));
    const sceneReported = updates.some((u) => String(u?.status ?? u?.set?.status ?? '').toLowerCase() === 'present');
    for (const [key, character] of Object.entries(cast.characters)) {
        if (!sceneReported || touched.has(key) || character.locked || character.status !== 'present') continue;
        before[key] = structuredClone(character);
        character.status = 'away';
    }

    if (Object.keys(before).length) {
        cast.journal.push({ messageIndex, signature: messageSignature(messageIndex), before });
        if (cast.journal.length > MAX_JOURNAL) cast.journal.splice(0, cast.journal.length - MAX_JOURNAL);
        saveCast();
    }
    return changed;
}

async function requestUpdate(messages) {
    if (extensionSettings.generationMode === 'external') {
        return await generateWithExternalAPI(messages);
    }
    return await safeGenerateRaw({ prompt: messages, quietToLoud: false });
}

async function waitForTrackers(maxMs = 120000) {
    // Give RPG Companion's own tracker update a moment to start, then wait for it to finish
    await new Promise((r) => setTimeout(r, 1000));
    const started = Date.now();
    while (isGenerating && Date.now() - started < maxMs) {
        await new Promise((r) => setTimeout(r, 500));
    }
}

/**
 * Updates the cast from the message at messageIndex. Runs one at a time, after RPG Companion's own
 * tracker update so the two requests never overlap.
 * @param {number} messageIndex - The message to record
 * @param {{force?: boolean}} [options] - force: also run for the user's own message (Refresh)
 */
export function updateCastFromMessage(messageIndex, { force = false } = {}) {
    updateQueue = updateQueue.then(async () => {
        if (!extensionSettings.enabled || extensionSettings.castEnabled === false) return;
        const message = chat[messageIndex];
        if (!message || message.is_system || (message.is_user && !force)) return;

        castStatus.running = true;
        notify();
        try {
            await waitForTrackers();
            const chatId = getContext().chatId;
            const signature = messageSignature(messageIndex);

            let response;
            try {
                response = await requestUpdate(await buildUpdatePrompt(messageIndex));
            } catch (error) {
                console.warn('[RPG Companion] Cast update failed:', error);
                castStatus.lastError = error?.message || String(error);
                return;
            }
            // The chat or the message changed while we waited: drop this result
            if (getContext().chatId !== chatId || messageSignature(messageIndex) !== signature) return;

            const updates = parseUpdate(response);
            if (!updates) {
                console.warn('[RPG Companion] Cast update: could not read the reply as JSON');
                castStatus.lastError = 'The model did not reply with the cast in the right format.';
                return;
            }
            applyCastUpdate(updates, messageIndex);
            castStatus.lastOk = Date.now();
            castStatus.lastError = null;
            refreshCastPrompt();
        } finally {
            castStatus.running = false;
            notify();
        }
    }).catch((error) => console.error('[RPG Companion] Cast update error:', error));
    return updateQueue;
}

/**
 * Refresh (Cast tab): redoes the update for the latest message. Whatever that message already changed is
 * undone first, so the cast goes back to its last update before it and is rebuilt from the latest
 * message.
 */
export function refreshCast() {
    let latest = chat.length - 1;
    while (latest >= 0 && chat[latest]?.is_system) latest--;
    if (latest < 0) return Promise.resolve();

    const cast = getCast();
    const signature = messageSignature(latest);
    let undone = false;
    while (cast.journal.length && cast.journal.at(-1).signature === signature) {
        const entry = cast.journal.pop();
        for (const [key, before] of Object.entries(entry.before)) {
            if (before === null) delete cast.characters[key];
            else cast.characters[key] = before;
        }
        undone = true;
    }
    if (undone) saveCast();
    return updateCastFromMessage(latest, { force: true });
}

/* ---------- Feeding the main model ---------- */

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether a character's name, first name or an alias appears in the text. */
export function isMentioned(character, text) {
    if (!text) return false;
    const names = [character.name, ...(character.aliases || [])];
    const first = String(character.name).split(/\s+/)[0];
    if (first && first.length >= 3 && first !== character.name) names.push(first);
    return names.some((n) => n && new RegExp(`(^|[^\\p{L}])${escapeRegex(n)}($|[^\\p{L}])`, 'iu').test(text));
}

function describe(character) {
    const parts = [];
    const events = (character.events || []).slice(-EVENTS_IN_PROMPT);
    if (events.length) parts.push(`What happened: ${events.join(' ')}`);
    if (character.steps?.length) parts.push(`Doing now: ${character.steps.join(' Then: ')}`);
    if (character.status === 'dead') parts.push('(dead)');
    return `- ${character.name}${parts.length ? `: ${parts.join(' | ')}` : ''}`;
}

/**
 * The cast notes for the main model: each relevant character's own memory (what happened to them and
 * what they are doing now) for characters in the scene or mentioned in the latest messages, and the
 * names of everyone else.
 */
export function buildCastNotes() {
    const characters = Object.values(getCast().characters);
    if (!characters.length) return '';
    const userName = getContext().name1 || 'User';
    const lookback = chat.slice(-2).map(messageText).join('\n');

    const relevant = characters.filter((c) => c.status === 'present' || isMentioned(c, lookback));
    const others = characters.filter((c) => !relevant.includes(c) && c.status !== 'dead');

    let notes = `<cast_notes>\nLasting memory of this story's characters, each in their own words (first person), for consistency. Use it quietly: never quote or list these notes in the reply. Lines marked (off-screen) happened where ${userName} could not see: characters may bring them up, but ${userName} does not know them yet.\n`;
    if (relevant.length) notes += relevant.map(describe).join('\n') + '\n';
    if (others.length) notes += `Also in the story: ${others.map((c) => c.name).join(', ')}\n`;
    notes += '</cast_notes>';
    return notes;
}

/** Puts the current cast notes in the main prompt (or clears them). */
export function refreshCastPrompt() {
    const enabled = extensionSettings.enabled && extensionSettings.castEnabled !== false;
    const notes = enabled ? buildCastNotes() : '';
    const depth = Math.max(0, Number(extensionSettings.castPromptDepth ?? 2));
    setExtensionPrompt(PROMPT_KEY, notes, extension_prompt_types.IN_CHAT, depth, false, extension_prompt_roles.SYSTEM);
}

/* ---------- Events ---------- */

export function initCast() {
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageIndex, type) => {
        if (type === 'impersonate') return;
        updateCastFromMessage(messageIndex);
    });
    // Notes follow the user's newest message (for who is mentioned) and every generation start
    eventSource.on(event_types.MESSAGE_SENT, refreshCastPrompt);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, (_type, _options, dryRun) => {
        if (!dryRun) refreshCastPrompt();
    });
    eventSource.on(event_types.MESSAGE_DELETED, reconcileCast);
    eventSource.on(event_types.MESSAGE_SWIPED, reconcileCast);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        reconcileCast();
        refreshCastPrompt();
        listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    });
}
