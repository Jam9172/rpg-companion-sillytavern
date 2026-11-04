/**
 * Cast's background model requests: which connection they use, how much the model may reason before it
 * answers, and strict JSON.
 *
 * Reasoning is the expensive part of a Cast update (most of the reply tokens on models that think, and
 * never shown), so Cast sets it per request instead of following the chat preset:
 *   - a Connection Profile picked in the Cast tab: that profile's model and preset, with Cast's settings
 *   - the main connection on OpenRouter: sent directly, with Cast's settings
 *   - RPG Companion's External API (OpenRouter, NanoGPT or any OpenAI-style API): Cast's settings added
 *     to its request
 *   - anything else: SillyTavern's own quiet generation (reasoning follows the preset)
 * With strict JSON on, the reply has to match the task's schema; a connection that rejects schemas is
 * retried without, and one that rejects Cast's reasoning setting is retried with the model's default.
 */

import { main_api } from '../../../../../../../script.js';
import { oai_settings, getChatCompletionModel } from '../../../../../../openai.js';
import { getContext } from '../../../../../../extensions.js';
import { extensionSettings } from '../../core/state.js';
import { generateWithExternalAPI } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

export const CAST_REASONING = ['off', 'low', 'default'];
// The effort word sent straight to a provider (OpenRouter, NanoGPT and OpenAI-style APIs all take these)
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

/** The picked profile ({id, api}), or null for RPG Companion's own connection (also when the profile is gone). */
function castProfile() {
    const id = extensionSettings.castConnection || '';
    if (!id) return null;
    try {
        const profile = getContext().ConnectionManagerRequestService.getSupportedProfiles().find((p) => p?.id === id);
        return profile ? { id, api: String(profile.api || '') } : null;
    } catch {
        return null;
    }
}

// Cast's requests run in the background. TauriTavern only reports a failed request as an error when it is
// marked quiet; otherwise the error comes back as the reply's text.
const QUIET = { type: 'quiet' };

/**
 * Reasoning fields for a request that goes through SillyTavern's (or TauriTavern's) own backend, which
 * turns them into what the profile's provider expects.
 * - Off: 'none', except on NanoGPT, where the backend only takes SillyTavern's scale ('min' is NanoGPT's
 *   none, and TauriTavern rejects 'none').
 * - Low: TauriTavern only turns DeepSeek's thinking on when the thinking is asked back, so ask for it there
 *   (the reply's text stays separate from it).
 */
function backendReasoning(reasoning, api) {
    if (reasoning === 'default') return {};
    if (reasoning === 'off') return { reasoning_effort: api === 'nanogpt' ? 'min' : 'none', include_reasoning: false };
    return { reasoning_effort: 'low', include_reasoning: api === 'deepseek' };
}

/** Reasoning fields for RPG Companion's External API, which calls the provider directly. */
function externalReasoning(reasoning, baseUrl) {
    if (reasoning === 'default') return {};
    const effort = EFFORT[reasoning];
    // OpenRouter takes a reasoning object; NanoGPT and OpenAI-style APIs a top-level reasoning_effort
    // (NanoGPT also leaves the thinking out of the reply with reasoning.exclude)
    if (/openrouter\.ai/i.test(baseUrl)) return { reasoning: { effort, exclude: true } };
    if (/nano-gpt\.com/i.test(baseUrl)) return { reasoning_effort: effort, reasoning: { exclude: true } };
    return { reasoning_effort: effort };
}

function asText(content) {
    if (content && typeof content === 'object') return JSON.stringify(content);
    return String(content ?? '');
}

async function send(messages, { maxTokens, temperature, reasoning, jsonSchema }) {
    const context = getContext();
    const profile = castProfile();
    if (profile) {
        const result = await context.ConnectionManagerRequestService.sendRequest(profile.id, messages, maxTokens,
            { stream: false, extractData: true, includePreset: true },
            { ...QUIET, temperature, ...backendReasoning(reasoning, profile.api), ...(jsonSchema ? { json_schema: jsonSchema } : {}) });
        return asText(result?.content);
    }

    if (extensionSettings.generationMode === 'external') {
        const extra = { max_tokens: maxTokens, temperature, ...externalReasoning(reasoning, extensionSettings.externalApiSettings?.baseUrl || '') };
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
            ...QUIET,
            temperature,
            ...backendReasoning(reasoning, 'openrouter'),
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
    let options = {
        // The token room stays the one for the picked setting, also when a retry falls back to the default
        maxTokens: MAX_TOKENS[task][reasoning],
        temperature: TEMPERATURE[task],
        reasoning,
        jsonSchema: extensionSettings.castStrictJson !== false && schema
            ? { name: schema.name, strict: true, value: schema.value }
            : null,
    };

    // At most three tries: as set, then without whatever the connection turned down
    for (let attempt = 1; ; attempt++) {
        try {
            const text = await send(messages, options);
            if (text.trim() || !options.jsonSchema) return text;
            throw new Error('Empty reply');
        } catch (error) {
            const message = String(error?.message || error);
            if (attempt >= 3) throw error;
            if (options.reasoning !== 'default' && /reason|thinking/i.test(message)) {
                // e.g. "Unsupported xAI reasoning_effort: none", or a model that always thinks
                console.warn('[RPG Companion] Cast: the connection turned down the reasoning setting, retrying with the model default:', message);
                options = { ...options, reasoning: 'default' };
            } else if (options.jsonSchema) {
                // Some connections reject schemas, or return nothing with them
                console.warn('[RPG Companion] Cast: strict JSON failed, retrying without it:', message);
                options = { ...options, jsonSchema: null };
            } else {
                throw error;
            }
        }
    }
}
