/**
 * Stat meter helper
 * Splits a 0-100 stat into 8 wedges (12.5% each) and names a tier from how many
 * wedges are left, so themes can draw stats as segmented rings.
 */

// Stats where a low value is not bad (they keep one colour instead of warning colours)
const NEUTRAL_STATS = ['arousal'];

/**
 * @param {string} statName - Stat id or name (e.g. "health", "Arousal")
 * @param {number} percentage - Value as a percentage of its maximum
 * @returns {{pct: number, wedges: number, tier: string, tone: string}}
 */
export function getStatMeter(statName, percentage) {
    const pct = Math.max(0, Math.min(100, Number(percentage) || 0));
    const wedges = Math.ceil(pct / 12.5);
    const tier = wedges >= 7 ? 'full' : wedges >= 5 ? 'good' : wedges >= 3 ? 'hurt' : wedges >= 1 ? 'danger' : 'empty';
    const tone = NEUTRAL_STATS.includes(String(statName).toLowerCase()) ? 'neutral' : 'meter';
    return { pct, wedges, tier, tone };
}

/**
 * Attributes to put on a stat element: data-tier, data-tone and the --rpg-pct / --rpg-wedges variables.
 * @param {string} statName
 * @param {number} percentage
 * @returns {string}
 */
export function statMeterAttributes(statName, percentage) {
    const { pct, wedges, tier, tone } = getStatMeter(statName, percentage);
    return `data-tier="${tier}" data-tone="${tone}" style="--rpg-pct: ${pct}; --rpg-wedges: ${wedges}"`;
}
