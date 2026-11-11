/**
 * Detects regex scripts from the old manual setup that conflict with the extension.
 * (The scripts RPG Companion installs itself are in regexScripts.js.)
 */

/**
 * Detects old manual regex formatters that might conflict with the extension
 * @param {Object} st_extension_settings - SillyTavern extension settings object
 * @returns {Array<string>} Array of conflicting regex script names
 */
export function detectConflictingRegexScripts(st_extension_settings) {
    const conflictingNames = [
        'Format User\'s Stats (Only Output)',
        'Format User\'s Stats (Only Display)',
        'Format Info Box (Only Output)',
        'Format Info Box (Only Display)',
        'Format Character\'s Thoughts (Only Output)',
        'Format Character\'s Thoughts (Only Display)',
        'Format Character Thoughts (Only Output)',
        'Format Character Thoughts (Only Display)'
    ];

    const existingScripts = st_extension_settings?.regex || [];
    const conflicts = [];

    for (const script of existingScripts) {
        if (script && script.scriptName && conflictingNames.some(name =>
            script.scriptName.toLowerCase().includes(name.toLowerCase())
        )) {
            conflicts.push(script.scriptName);
        }
    }

    return conflicts;
}
