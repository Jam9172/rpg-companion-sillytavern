/**
 * Clear Inventory and Clear Status (Settings, under Clear Extension Cache): each resets one part of RPG
 * Companion's trackers for the current chat and leaves the rest (the other tab, the quests and Cast).
 *
 * The inventory, the user's stats and the quests are kept together in one "user stats" record, so a reset
 * rewrites that record instead of deleting it, everywhere it is kept: the live data the panel shows, what
 * the model gets as the previous trackers, the chat's saved copy, and every message's swipes. The swipes
 * matter: swiping or regenerating a reply reloads the trackers of the message before it, and History
 * Persistence sends older ones, so a reset that left them would come back on the next swipe.
 */
import { getContext } from '../../../../../../extensions.js';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    clearSessionAvatarPrompts,
    clearThoughtBasedExpressionPortraits,
} from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { repairJSON } from '../../utils/jsonRepair.js';

// What the model writes (arrays) and what the panel keeps (text), both empty
const emptyInventoryRecord = () => ({ onPerson: [], clothing: [], stored: {}, assets: [] });
const emptyInventory = () => ({ version: 2, onPerson: 'None', clothing: 'None', stored: {}, assets: 'None' });

// The old plain-text trackers: the inventory lines and the quest lines
const INVENTORY_LINE = /^\s*(On Person|Clothing|Assets|Inventory)\s*:/i;
const STORED_LINE = /^\s*Stored\s*-/i;
const QUEST_LINE = /^\s*(Main Quests?|Optional Quests)\s*:/i;
const keepsInventoryOrQuests = (line) => INVENTORY_LINE.test(line) || STORED_LINE.test(line) || QUEST_LINE.test(line);

/** A stored user stats record as an object, or null when it is the old plain-text format. */
function readRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        const repaired = repairJSON(trimmed);
        return repaired && typeof repaired === 'object' && !Array.isArray(repaired) ? repaired : null;
    }
}

/** Writes a record back in the form it came in (text stays text, with the same layout). */
function writeRecord(original, record) {
    if (typeof original !== 'string') return record;
    return original.includes('\n') ? JSON.stringify(record, null, 2) : JSON.stringify(record);
}

/** The user stats record with an empty inventory, so the model carries on from nothing. */
export function withoutInventory(value) {
    if (value == null) return value;
    const record = readRecord(value);
    if (record) return 'inventory' in record ? writeRecord(value, { ...record, inventory: emptyInventoryRecord() }) : value;
    if (typeof value !== 'string') return value;
    return value.split('\n')
        .filter((line) => !STORED_LINE.test(line))
        .map((line) => {
            const match = line.match(INVENTORY_LINE);
            return match ? `${match[1]}: None` : line;
        })
        .join('\n');
}

/** The user stats record with only its inventory and quests (null when nothing else is left). */
export function onlyInventoryAndQuests(value) {
    if (value == null) return value;
    const record = readRecord(value);
    if (record) {
        const kept = {};
        if ('inventory' in record) kept.inventory = record.inventory;
        if ('quests' in record) kept.quests = record.quests;
        return Object.keys(kept).length ? writeRecord(value, kept) : null;
    }
    if (typeof value !== 'string') return value;
    const lines = value.split('\n').filter(keepsInventoryOrQuests);
    return lines.length ? lines.join('\n') : null;
}

/**
 * Whether a user stats record has anything for the Status tab (stats, mood and conditions, skills), not
 * just the inventory and quests that Clear Status leaves.
 */
export function hasStatusData(value) {
    if (!value) return false;
    const record = readRecord(value);
    if (record) return Object.keys(record).some((key) => key !== 'inventory' && key !== 'quests');
    if (typeof value !== 'string') return true;
    return value.split('\n').some((line) => line.trim() && !keepsInventoryOrQuests(line));
}

/** Every tracker record kept on the chat's messages: each swipe, in message.extra and in swipe_info (what is saved). */
function storedRecords(chat) {
    const records = new Set();
    const isRecord = (value) => value && typeof value === 'object' && ('userStats' in value || 'infoBox' in value || 'characterThoughts' in value);
    const collect = (store) => {
        if (!store || typeof store !== 'object') return;
        // Older chats keep one record directly; newer ones one per swipe number
        if (isRecord(store)) {
            records.add(store);
            return;
        }
        for (const value of Object.values(store)) {
            if (isRecord(value)) records.add(value);
        }
    };
    for (const message of chat || []) {
        collect(message?.extra?.rpg_companion_swipes);
        if (Array.isArray(message?.swipe_info)) {
            for (const info of message.swipe_info) collect(info?.extra?.rpg_companion_swipes);
        }
    }
    return records;
}

/**
 * Empties the inventory of the current chat (on person, clothing, stored, assets) and its item locks.
 * The stats, info box, present characters, quests and Cast stay as they are.
 */
export function clearInventory() {
    extensionSettings.userStats.inventory = emptyInventory();
    if (extensionSettings.lockedItems) {
        extensionSettings.lockedItems.inventory = { onPerson: [], clothing: [], stored: {}, assets: [] };
    }

    lastGeneratedData.userStats = withoutInventory(lastGeneratedData.userStats);
    committedTrackerData.userStats = withoutInventory(committedTrackerData.userStats);
    for (const record of storedRecords(getContext().chat)) {
        if ('userStats' in record) record.userStats = withoutInventory(record.userStats);
    }

    saveChatData();
    saveSettings();
}

/**
 * Clears the Status tab of the current chat: the user's stats, mood and conditions, skills, attributes and
 * level, the info box, and the present characters (with their thoughts), and the locks on them. The
 * inventory, quests and Cast stay as they are.
 */
export function clearStatus() {
    const inventory = extensionSettings.userStats?.inventory || emptyInventory();
    // The same starting values as Clear Extension Cache, keeping the inventory
    extensionSettings.userStats = {
        health: 100,
        satiety: 100,
        energy: 100,
        hygiene: 100,
        arousal: 0,
        mood: '😐',
        conditions: 'None',
        skills: [],
        inventory,
    };
    extensionSettings.infoBox = {
        date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        weather: '☀️ Clear skies',
        temperature: '20°C',
        time: '00:00 - 00:00',
        location: 'Unknown Location',
        recentEvents: [],
    };
    extensionSettings.characterThoughts = { characters: [] };
    extensionSettings.classicStats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    extensionSettings.level = 1;
    extensionSettings.lockedItems = {
        ...(extensionSettings.lockedItems || {}),
        stats: [],
        skills: [],
        infoBox: { date: false, weather: false, temperature: false, time: false, location: false, recentEvents: false },
        characters: {},
    };

    for (const data of [lastGeneratedData, committedTrackerData]) {
        data.userStats = onlyInventoryAndQuests(data.userStats);
        data.infoBox = null;
        data.characterThoughts = null;
    }
    for (const record of storedRecords(getContext().chat)) {
        if ('userStats' in record) record.userStats = onlyInventoryAndQuests(record.userStats);
        if ('infoBox' in record) record.infoBox = null;
        if ('characterThoughts' in record) record.characterThoughts = null;
    }

    // Portrait prompts and expression pictures picked for the present characters
    clearSessionAvatarPrompts();
    clearThoughtBasedExpressionPortraits();

    saveChatData();
    saveSettings();
}
