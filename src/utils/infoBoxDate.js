/**
 * Info Box date helpers.
 *
 * The model writes the date as one string, normally "Weekday, Month Day, Year"
 * ("Sunday, March 16, 1247"), but it also writes "Sunday, 16 March 1247", "Sunday",
 * "March 16, 1247", or the date as a bare string instead of {"value": ...}.
 * Splitting only on commas sent the whole rest into the month slot or left month and
 * year empty (the panel then showed its MON / YEAR placeholders).
 */

/** The date string from an Info Box date field: {"value": "..."} or a bare string. */
export function infoBoxDateValue(date) {
    if (typeof date === 'string') return date.trim();
    if (date && typeof date === 'object' && date.value != null) return String(date.value).trim();
    return '';
}

// A year at the end of the text: three or more digits, or "Year 12", optionally with an era ("1247 AE", "412 DR").
const TRAILING_YEAR = /(?:^|\s)((?:[Yy]ear\s+\d+|\d{3,})(?:\s+[A-Z]{1,4}\.?)?)$/;

// Weekday names in the languages RPG Companion ships and a few more, long and short ("sunday", "sun")
const WEEKDAY_NAMES = (() => {
    const names = new Set();
    for (const locale of ['en', 'ru', 'fr', 'zh-CN', 'zh-TW', 'de', 'es', 'it', 'pt', 'ja', 'ko']) {
        for (const weekday of ['long', 'short']) {
            try {
                const format = new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' });
                for (let day = 0; day < 7; day++) {
                    names.add(format.format(new Date(Date.UTC(2024, 0, 7 + day))).toLowerCase().replace(/\.$/, ''));
                }
            } catch {
                // locale not available
            }
        }
    }
    return names;
})();

/** A weekday name, or a made-up one ending in "day" ("Moonday"). */
function looksLikeWeekday(text) {
    const word = String(text).trim().toLowerCase().replace(/\.$/, '');
    return WEEKDAY_NAMES.has(word) || /^\p{L}+day$/u.test(word);
}

/**
 * Splits an Info Box date into the parts the calendar shows.
 * @param {string} value - "Sunday, March 16, 1247" and the variants above
 * @returns {{weekday: string, month: string, year: string}}
 */
export function splitInfoBoxDate(value) {
    const text = String(value || '').trim();
    if (!text) return { weekday: '', month: '', year: '' };

    const parts = text.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
        return { weekday: parts[0], month: parts[1], year: parts.slice(2).join(', ') };
    }

    // One or two parts: a leading part without digits is the weekday, unless all that follows it is a
    // year ("March, 1247", "Late Autumn, 1247": that's the month) and it doesn't look like a weekday
    let weekday = '';
    let rest = parts.join(', ');
    if (parts.length === 2 && !/\d/.test(parts[0])) {
        const yearAfter = parts[1].match(TRAILING_YEAR);
        const onlyYearAfter = yearAfter && !parts[1].slice(0, yearAfter.index).trim();
        if (!onlyYearAfter || looksLikeWeekday(parts[0])) {
            weekday = parts[0];
            rest = parts[1];
        }
    } else if (parts.length === 1) {
        // "Sunday", or "Sunday 16 March 1247" written without commas
        const [first, ...others] = parts[0].split(/\s+/);
        if (looksLikeWeekday(first)) {
            weekday = first;
            rest = others.join(' ');
        }
    }

    let year = '';
    const yearMatch = rest.match(TRAILING_YEAR);
    if (yearMatch) {
        year = yearMatch[1].trim();
        rest = rest.slice(0, yearMatch.index);
    }
    const month = rest.replace(/[\s,]+$/, '').replace(/\s+of$/i, '').trim();
    return { weekday, month, year };
}

/** Joins calendar parts back into one date string ("Sunday, March 16, 1247"). */
export function joinInfoBoxDate({ weekday = '', month = '', year = '' }) {
    return [weekday, month, year].map(p => String(p).trim()).filter(Boolean).join(', ');
}
