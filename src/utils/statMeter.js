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

// Words describing each tier [full, good, hurt, danger, empty], so the AI reads a condition, not just a number
const STAT_WORDS = {
    health: ['healthy', 'lightly hurt', 'wounded', 'critically wounded', 'near death'],
    satiety: ['well fed', 'fed', 'hungry', 'starving', 'famished'],
    hunger: ['well fed', 'fed', 'hungry', 'starving', 'famished'],
    energy: ['well rested', 'alert', 'tired', 'exhausted', 'spent'],
    stamina: ['fresh', 'steady', 'winded', 'exhausted', 'spent'],
    hygiene: ['clean', 'presentable', 'grubby', 'filthy', 'reeking'],
    mana: ['brimming', 'steady', 'waning', 'drained', 'empty']
};
const DEFAULT_WORDS = ['very high', 'high', 'low', 'very low', 'empty'];
const TIER_ORDER = ['full', 'good', 'hurt', 'danger', 'empty'];

/**
 * A short condition word for a stat (e.g. "hungry"), or '' for neutral stats where low is not bad.
 * @param {string} statName - Stat id or name
 * @param {number} percentage - Value as a percentage of its maximum
 * @returns {string}
 */
export function getStatWord(statName, percentage) {
    const { tier, tone } = getStatMeter(statName, percentage);
    if (tone === 'neutral') return '';
    const words = STAT_WORDS[String(statName).toLowerCase()] || DEFAULT_WORDS;
    return words[TIER_ORDER.indexOf(tier)];
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
