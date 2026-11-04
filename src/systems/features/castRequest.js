/**
 * Cast's background model requests: which connection they use, how much the model may reason before it
 * answers, and strict JSON.
 *
 * Reasoning is the expensive part of a Cast update (most of the reply tokens on models that think, and
 * never shown), so Cast sets it per request instead of following the chat preset:
 *   - a Connection Profile picked in the Cast tab: that profile's model and preset, with Cast's settings
 *   - the main connection on OpenRouter: sent directly, with Cast's settings
 *   - RPG Companion's External API: Cast's settings added to its request
 *   - anything else: SillyTavern's own quiet generation (reasoning follows the preset)
 * With strict JSON on, the reply has to match the task's schema; a connection that rejects schemas is
 * retried once without.
 */

import { main_api } from '../../../../../../../script.js';
import { oai_settings, getChatCompletionModel } from '../../../../../../openai.js';
import { getContext } from '../../../../../../extensions.js';
import { extensionSettings } from '../../core/state.js';
import { generateWithExternalAPI } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

export const CAST_REASONING = ['off', 'low', 'default'];
const EFFORT = { off: 'none', low: 'low' };
// Room for the reply; reasoning counts against it
const MAX_TOKENS = {
    update: { off: 3000, low: 6000, default: 10000 },
    tidy: { off: 6000, low: 10000, default: 16000 },
    fold: { off: 4000, low: 8000, default: 12000 },
};
// Updates invent off-screen lives; a tidy only cleans up
const TEMPERATURE = { update: 0.7, tidy: 0.3, fold: 0.3 };

/** @returns {string} 'off', 'low' or 'default' */
export function castReasoning() {
    return CAST_REASONING.includes(extensionSettings.castReasoning) ? extensionSettings.castReasoning : 'off';
}

/** Connection Profiles Cast can use (empty when the Connection Manager is off). */
export function castConnectionProfiles() {
    try {
        return getContext().ConnectionManagerRequestService.getSupportedProfiles()
            .filter((p) => p?.id)
            .map((p) => ({ id: p.id, name: p.name || p.id }));
    } catch {
        return [];
    }
}

/** The picked profile, or '' for RPG Companion's own connection (also when the profile is gone). */
function castProfile() {
    const id = extensionSettings.castConnection || '';
    return id && castConnectionProfiles().some((p) => p.id === id) ? id : '';
}

function asText(content) {
    if (content && typeof content === 'object') return JSON.stringify(content);
    return String(content ?? '');
}

async function send(messages, { maxTokens, overrides, jsonSchema }) {
    const context = getContext();
    const profile = castProfile();
    if (profile) {
        const result = await context.ConnectionManagerRequestService.sendRequest(profile, messages, maxTokens,
            { stream: false, extractData: true, includePreset: true },
            { ...overrides, ...(jsonSchema ? { json_schema: jsonSchema } : {}) });
        return asText(result?.content);
    }

    if (extensionSettings.generationMode === 'external') {
        const isOpenRouter = /openrouter\.ai/i.test(extensionSettings.externalApiSettings?.baseUrl || '');
        const extra = { max_tokens: maxTokens, temperature: overrides.temperature };
        if (overrides.reasoning_effort && isOpenRouter) extra.reasoning = { effort: overrides.reasoning_effort, exclude: true };
        if (jsonSchema) extra.response_format = { type: 'json_schema', json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.value } };
        return asText(await generateWithExternalAPI(messages, extra));
    }

    if (main_api === 'openai' && oai_settings.chat_completion_source === 'openrouter') {
        const result = await context.ChatCompletionService.processRequest({
            stream: false,
            messages,
            model: getChatCompletionModel(oai_settings),
            chat_completion_source: 'openrouter',
            max_tokens: maxTokens,
            provider: oai_settings.openrouter_providers,
            allow_fallbacks: oai_settings.openrouter_allow_fallbacks,
            quantizations: oai_settings.openrouter_quantizations,
            ...overrides,
            ...(jsonSchema ? { json_schema: jsonSchema } : {}),
        }, {}, true);
        return asText(result?.content);
    }

    return asText(await safeGenerateRaw({ prompt: messages, quietToLoud: false, responseLength: maxTokens, jsonSchema }));
}

/**
 * Sends a Cast request and returns the reply text.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{task: 'update'|'tidy'|'fold', schema?: {name: string, value: Object}}} options
 * @returns {Promise<string>}
 */
export async function requestCast(messages, { task, schema }) {
    // A tidy has to catch contradictions across the whole memory, and summing up has to keep what matters;
    // both miss things without some thinking and run rarely, so they always reason at least a little
    const reasoning = task !== 'update' && castReasoning() === 'off' ? 'low' : castReasoning();
    const maxTokens = MAX_TOKENS[task][reasoning];
    const overrides = { temperature: TEMPERATURE[task] };
    if (reasoning !== 'default') {
        overrides.reasoning_effort = EFFORT[reasoning];
        overrides.include_reasoning = false;
    }
    const jsonSchema = extensionSettings.castStrictJson !== false && schema
        ? { name: schema.name, strict: true, value: schema.value }
        : null;

    try {
        const text = await send(messages, { maxTokens, overrides, jsonSchema });
        if (text.trim() || !jsonSchema) return text;
        throw new Error('Empty reply');
    } catch (error) {
        if (!jsonSchema) throw error;
        // Some connections reject schemas, or return nothing with them: try once without
        console.warn('[RPG Companion] Cast: strict JSON failed, retrying without it:', error?.message || error);
        return await send(messages, { maxTokens, overrides, jsonSchema: null });
    }
}
