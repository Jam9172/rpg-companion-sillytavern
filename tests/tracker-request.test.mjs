// The separate tracker request (Separate and External modes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st, quietly, mountPanel } from './helpers/env.mjs';

const script = await st('script.js');
const state = await ext('src/core/state.js');
const persistence = await ext('src/core/persistence.js');
const { generateSeparateUpdatePrompt, generateTrackerInstructions } = await ext('src/systems/generation/promptBuilder.js');
const { updateRPGData } = await ext('src/systems/generation/apiClient.js');
await mountPanel();

const s = state.extensionSettings;
const user = (mes) => ({ name: 'User', is_user: true, is_system: false, mes, send_date: mes, extra: {} });
const trackers = (place) => ({ infoBox: JSON.stringify({ location: { value: place } }) });
function reply(mes, place) {
    const m = { name: 'Narrator', is_user: false, is_system: false, mes, send_date: mes, swipes: [mes], swipe_id: 0, swipe_info: [{ send_date: mes, extra: {} }], extra: {} };
    if (place) persistence.setMessageSwipeTrackerData(m, 0, trackers(place));
    return m;
}
function setChat(...messages) {
    script.chat.length = 0;
    script.chat.push(...messages);
    Object.assign(s, { enabled: true, generationMode: 'external', updateDepth: 4 });
}
const text = (messages) => messages.map((m) => m.content).join('\n');

test('hidden messages are left out of the tracker request', async () => {
    setChat(user('I pick the lock.'), reply('You are in a cell.', 'Cell'),
        { ...user('SECRET NOTE the model must not see'), is_system: true }, user('I walk on.'), reply('A corridor.', 'Corridor'));
    const request = text(await quietly(() => generateSeparateUpdatePrompt()));
    assert.ok(!request.includes('SECRET NOTE'));
    assert.ok(request.includes('I pick the lock.'), 'the four latest visible messages are sent');
});

test('the tracker request asks for one format, not two', async () => {
    setChat(user('I pick the lock.'), reply('You are in a cell.', 'Cell'));
    const messages = await quietly(() => generateSeparateUpdatePrompt());
    const instructions = messages.at(-1).content;
    assert.match(instructions, /Do NOT wrap the JSON in code fences/);
    assert.doesNotMatch(instructions, /JSON code block/);
    assert.doesNotMatch(instructions, /At the start of every reply/);
    assert.equal(instructions.split('```').length - 1, 1, 'the only ``` is in "do not wrap"');
    // Together mode still asks for the fenced block its regex script hides
    const together = await quietly(() => generateTrackerInstructions(false, true));
    assert.match(together, /At the start of every reply/);
    assert.match(together, /Provide EXACTLY ONE JSON code block[\s\S]*```json\n\{[\s\S]*\n\}\n```/);
});

test('a tracker request starts from the state before the reply it is for', async () => {
    setChat(user('I pick the lock.'), reply('You are in a cell.', 'Cell'), user('I walk on.'), reply('A corridor.', 'Corridor'),
        user('I climb.'), reply('The stairs.'));
    // The commit at this reply's generation start was skipped (another update was running): still "Cell"
    Object.assign(state.committedTrackerData, { userStats: null, characterThoughts: null, ...trackers('Cell') });
    s.externalApiSettings = { ...(s.externalApiSettings || {}), baseUrl: 'http://stub.local/v1', model: 'stub' };
    let sent = '';
    const realFetch = globalThis.fetch;
    globalThis.fetch = window.fetch = async (url, init) => {
        sent = text(JSON.parse(init.body).messages);
        const content = JSON.stringify({ infoBox: { location: { value: 'Stairs' } } });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
    };
    try {
        const noop = () => {};
        await quietly(() => updateRPGData(noop, noop, noop, noop));
    } finally {
        globalThis.fetch = window.fetch = realFetch;
    }
    const previous = sent.match(/<previous>([\s\S]*?)<\/previous>/)?.[1] || '';
    assert.match(previous, /Corridor/);
    assert.doesNotMatch(previous, /Cell/);
});
