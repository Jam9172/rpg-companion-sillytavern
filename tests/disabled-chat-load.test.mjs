import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st, quietly } from './helpers/env.mjs';

const script = await st('script.js');
const { extensionSettings } = await ext('src/core/state.js');
const integration = await ext('src/systems/integration/sillytavern.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reply = 'The rain keeps falling.\n```json\n{"infoBox": {"location": {"value": "Harbor"}, "weather": {"emoji": "🌧️", "forecast": "Rain"}}}\n```';
function openChat() {
    script.chat.length = 0;
    script.chat.push({ name: 'Narrator', is_user: false, is_system: false, mes: reply, swipes: [reply], swipe_id: 0, extra: {} });
    return script.chat[0];
}
const run = (fn) => quietly(async () => { try { await fn(); } catch { /* no panel to render into */ } await sleep(700); });

test('turned off: opening or switching chats leaves the messages alone', async () => {
    extensionSettings.enabled = false;
    const message = openChat();
    await run(() => integration.onChatLoaded());
    await run(() => integration.onCharacterChanged());
    await run(() => integration.scheduleChatStateRehydration());
    assert.deepEqual(message.extra, {});
});

test('turned on: opening a chat still restores the trackers from the latest reply', async () => {
    extensionSettings.enabled = true;
    const message = openChat();
    await run(() => integration.onChatLoaded());
    assert.match(JSON.stringify(message.extra.rpg_companion_swipes ?? null), /Harbor/);
});
