/**
 * The regex scripts RPG Companion keeps in SillyTavern's Regex extension (global scripts, so they show
 * up in its list and can be edited or disabled there).
 *
 *  - Tracker JSON: in Together mode the reply's tracker block stays in the message; these scripts hide it
 *    from the chat and keep it out of later prompts. They match tracker blocks only, never other code.
 *  - Clean HTML: keeps HTML the model wrote (Immersive HTML) out of later prompts, except the tags
 *    RPG Companion's own prompts tell the model to reuse or read back.
 */

// A fenced block (```json, ```markdown or bare) that holds tracker JSON: it starts with { or [, has one
// of the tracker keys, and never runs past its own closing fence into another block
const TRACKER_KEYS = 'userStats|infoBox|characters|characterThoughts|presentCharacters';
const NOT_A_FENCE = '(?:(?!```)[\\s\\S])*?';
const TRACKER_BLOCK = `/\`\`\`(?:json|markdown)?\\s*[{\\[]${NOT_A_FENCE}"(?:${TRACKER_KEYS})"\\s*:${NOT_A_FENCE}\`\`\`/gi`;

// An HTML tag (a letter right after "<" or "</", so "x < 5 and y > 3" is left alone), but not a comment
// and not <font> (Dialogue Coloring), <lie> (Deception) or <ofilter> (Omniscience Filter)
const HTML_TAG = '/\\s?<(?!\\/?(?:font|lie|ofilter)\\b)\\/?[a-zA-Z](?:"[^"]*"|\'[^\']*\'|[^\'">])*>/g';

/**
 * @typedef {object} ScriptDefinition
 * @property {string} scriptName
 * @property {string} findRegex
 * @property {string[]|null} replaces - earlier default patterns to update from; null = the pattern is
 *   always ours (the script was never meant to be edited)
 * @property {boolean} markdownOnly - runs on what the chat shows
 * @property {boolean} promptOnly - runs on what is sent to the model
 * @property {boolean} [onlyWhileEnabled] - off while RPG Companion is turned off
 */
/** @type {ScriptDefinition[]} */
export const REGEX_SCRIPTS = [
    {
        scriptName: 'Clean HTML (From Outgoing Prompt)',
        findRegex: HTML_TAG,
        replaces: ['/\\s?<(?!\\!--)(?:"[^"]*"|\'[^\']*\'|[^\'">])*>/g'],
        markdownOnly: false,
        promptOnly: true,
        onlyWhileEnabled: true,
    },
    {
        scriptName: 'Clean RPG Trackers (From Outgoing Prompt)',
        findRegex: TRACKER_BLOCK,
        replaces: ['/```json\\s*\\n\\{[\\s\\S]*?(?:"userStats"|"infoBox"|"characters")[\\s\\S]*?\\}\\s*\\n```/gm'],
        markdownOnly: false,
        promptOnly: true,
    },
    {
        scriptName: 'RPG Companion - Remove Tracker JSON (Together Mode)',
        findRegex: TRACKER_BLOCK,
        replaces: null,
        markdownOnly: true,
        promptOnly: true,
    },
];

// Set on a script RPG Companion switched off itself, so it only switches back on what it switched off
const PAUSED = 'rpgCompanionPaused';

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Brings SillyTavern's regex list in line with REGEX_SCRIPTS: adds the scripts that are missing, updates a
 * pattern that is still an earlier default, and switches the "only while enabled" scripts off and back on
 * with the extension. A script the user disabled or rewrote is left as they set it.
 *
 * @param {object} st_extension_settings - SillyTavern's extension settings
 * @param {Function} saveSettingsDebounced
 * @param {{enabled: boolean}} options - whether RPG Companion is turned on
 * @returns {boolean} whether anything changed
 */
export function syncRegexScripts(st_extension_settings, saveSettingsDebounced, { enabled }) {
    if (!st_extension_settings || typeof st_extension_settings !== 'object') return false;
    if (!Array.isArray(st_extension_settings.regex)) st_extension_settings.regex = [];
    const scripts = st_extension_settings.regex;
    let changed = false;

    for (const definition of REGEX_SCRIPTS) {
        const paused = !!definition.onlyWhileEnabled && !enabled;
        let script = scripts.find((s) => s && s.scriptName === definition.scriptName);

        if (!script) {
            script = {
                id: uuidv4(),
                scriptName: definition.scriptName,
                findRegex: definition.findRegex,
                replaceString: '',
                trimStrings: [],
                placement: [2], // AI output
                disabled: false,
                markdownOnly: definition.markdownOnly,
                promptOnly: definition.promptOnly,
                runOnEdit: true,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null,
            };
            scripts.push(script);
            changed = true;
        } else if (script.findRegex !== definition.findRegex
            && (definition.replaces === null || definition.replaces.includes(script.findRegex))) {
            script.findRegex = definition.findRegex;
            changed = true;
        }

        if (paused && !script.disabled) {
            script.disabled = true;
            script[PAUSED] = true;
            changed = true;
        } else if (!paused && script[PAUSED]) {
            script.disabled = false;
            delete script[PAUSED];
            changed = true;
        }
    }

    if (changed && typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
    return changed;
}
