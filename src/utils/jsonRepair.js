/**
 * JSON Repair Utilities
 * Handles parsing and repairing malformed JSON from AI responses
 */

/**
 * Repairs malformed JSON from AI responses
 * Handles common AI mistakes like trailing commas, missing commas, wrong quotes, etc.
 *
 * @param {string} jsonString - Potentially malformed JSON string
 * @returns {object|null} Repaired JSON object or null if repair fails
 */
export function repairJSON(jsonString) {
    if (typeof jsonString !== 'string') {
        console.warn('[RPG JSON Repair] Invalid input type:', typeof jsonString);
        return null;
    }

    let cleaned = jsonString.trim();

    if (!cleaned) {
        return null;
    }

    // Remove markdown code fences
    cleaned = cleaned.replace(/```json\s*/gi, '');
    cleaned = cleaned.replace(/```\s*/g, '');

    // Remove thinking tags (model's internal reasoning)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    // Attempt 1: Standard JSON.parse (valid JSON is used as it is)
    try {
        return JSON.parse(cleaned);
    } catch (e) {
    }

    // Fix common JSON errors, outside strings only (so URLs and "//" in text are kept):
    // JavaScript comments (the prompts' examples have "// 0 to 100" notes) and trailing commas.
    // (Missing commas, single quotes and unquoted keys aren't regex-fixed here: that corrupted valid
    // JSON. Attempt 4 below reads bare keys and single-quoted strings instead.)
    cleaned = stripCommentsAndTrailingCommas(cleaned);

    try {
        return JSON.parse(cleaned);
    } catch (e) {
    }

    // Attempt 2: Extract JSON object between first { and last }
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch (e) {
            // Silent fail, try next method
        }
    }

    // Attempt 3: Try to extract JSON array between first [ and last ]
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            return JSON.parse(arrayMatch[0]);
        } catch (e) {
            // Silent fail, try next method
        }
    }

    // Attempt 4: JavaScript-style object text (bare keys, single-quoted strings), converted to JSON.
    // Data only: the text is never run as code.
    for (const loose of [cleaned, objectMatch?.[0]]) {
        if (!loose) continue;
        try {
            const result = JSON.parse(looseToJSON(loose));
            if (result && typeof result === 'object') {
                return result;
            }
        } catch (e) {
            // try the next candidate
        }
    }

    console.error('[RPG JSON Repair] ✗ All repair attempts failed');
    return null;
}

const CLOSES_NEXT = /(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*[}\]]/y;
/** Whether only whitespace and comments come before the next } or ] at position `from`. */
function closesNext(text, from) {
    CLOSES_NEXT.lastIndex = from;
    return CLOSES_NEXT.test(text);
}

/**
 * Removes // and /* *\/ comments and commas before a closing } or ], leaving text inside "double" or
 * 'single' quoted strings alone.
 * @param {string} text
 * @returns {string}
 */
function stripCommentsAndTrailingCommas(text) {
    let out = '';
    let quote = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            out += ch;
            if (ch === '\\' && i + 1 < text.length) {
                out += text[++i];
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            out += ch;
        } else if (ch === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            if (i < text.length) out += '\n';
        } else if (ch === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            i = close === -1 ? text.length : close + 1;
        } else if (ch === ',' && closesNext(text, i + 1)) {
            // trailing comma: drop it
        } else {
            out += ch;
        }
    }
    return out;
}

/**
 * Rewrites JavaScript-style object text as JSON: quotes bare keys ({mood: 1} -> {"mood": 1}) and turns
 * 'single-quoted' strings into "double-quoted" ones. Text inside strings is left alone. Values that
 * aren't JSON (expressions, function calls, undefined) stay as they are, so JSON.parse rejects them.
 * @param {string} text
 * @returns {string}
 */
function looseToJSON(text) {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            // Copy a string, re-quoting single-quoted ones
            let j = i + 1;
            let body = '';
            while (j < text.length && text[j] !== ch) {
                if (text[j] === '\\' && j + 1 < text.length) {
                    // \' isn't a JSON escape; everything else is kept as written
                    body += (ch === "'" && text[j + 1] === "'") ? "'" : text[j] + text[j + 1];
                    j += 2;
                    continue;
                }
                body += (ch === "'" && text[j] === '"') ? '\\"' : text[j];
                j++;
            }
            out += `"${body}"`;
            i = j + 1;
            continue;
        }
        const key = /^[A-Za-z_$][\w$]*(?=\s*:)/.exec(text.slice(i));
        if (key && /[{,]\s*$/.test(out)) {
            out += `"${key[0]}"`;
            i += key[0].length;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

/**
 * Validates JSON structure matches expected schema for a tracker type
 *
 * @param {object} data - Parsed JSON data to validate
 * @param {string} type - Type of tracker ('userStats', 'infoBox', 'characters')
 * @returns {boolean} True if valid, false otherwise
 */
export function validateJSONSchema(data, type) {
    if (!data || typeof data !== 'object') {
        return false;
    }

    try {
        switch (type) {
            case 'userStats':
                return Array.isArray(data.stats) &&
                       data.stats.every(s =>
                           s &&
                           typeof s === 'object' &&
                           s.id &&
                           s.name &&
                           typeof s.value === 'number'
                       );

            case 'infoBox':
                return (data.date || data.weather || data.time || data.location || data.temperature || data.recentEvents);

            case 'characters':
                return Array.isArray(data.characters) &&
                       data.characters.every(c => c && c.name);

            default:
                console.warn('[RPG JSON Validation] Unknown tracker type:', type);
                return false;
        }
    } catch (e) {
        console.error('[RPG JSON Validation] Error during validation:', e);
        return false;
    }
}

/**
 * Extracts JSON from text that may contain other content
 * Looks for JSON blocks within ```json fences or standalone JSON objects
 *
 * @param {string} text - Text potentially containing JSON
 * @returns {string|null} Extracted JSON string or null
 */
export function extractJSONFromText(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }

    // Try to extract from ```json code fence
    const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
        const trimmed = fenceMatch[1].trim();
        if (trimmed) return trimmed;
    }

    // Try to extract from ``` code fence (without json label)
    const genericFenceMatch = text.match(/```\s*([\s\S]*?)```/);
    if (genericFenceMatch && genericFenceMatch[1]) {
        const content = genericFenceMatch[1].trim();
        // Check if it looks like JSON (starts with { or [)
        if (content && (content.startsWith('{') || content.startsWith('['))) {
            return content;
        }
    }

    // Try to find standalone JSON object
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch && objectMatch[0].trim()) {
        return objectMatch[0];
    }

    // Try to find standalone JSON array
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch && arrayMatch[0].trim()) {
        return arrayMatch[0];
    }

    return null;
}

/**
 * Safely parses JSON with automatic repair attempts
 * Combines extraction, repair, and validation in one call
 *
 * @param {string} text - Text containing JSON (with or without code fences)
 * @param {string} expectedType - Expected tracker type for validation ('userStats', 'infoBox', 'characters')
 * @returns {{data: object|null, success: boolean, error: string|null}} Result object
 */
export function safeParseJSON(text, expectedType = null) {
    const result = {
        data: null,
        success: false,
        error: null
    };

    // Extract JSON from text
    const jsonString = extractJSONFromText(text);
    if (!jsonString) {
        result.error = 'No JSON found in text';
        return result;
    }

    // Attempt to repair and parse
    const parsed = repairJSON(jsonString);
    if (!parsed) {
        result.error = 'Failed to parse JSON after repair attempts';
        return result;
    }

    // Validate schema if type specified
    if (expectedType) {
        const valid = validateJSONSchema(parsed, expectedType);
        if (!valid) {
            result.error = `JSON does not match expected schema for type: ${expectedType}`;
            result.data = parsed; // Return data anyway, might be partially useful
            return result;
        }
    }

    result.data = parsed;
    result.success = true;
    return result;
}
