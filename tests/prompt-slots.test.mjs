// What RPG Companion leaves in SillyTavern's prompt slots, and where its History Persistence notes land.
// At GENERATION_STARTED on a normal send the user's new message is not in the chat yet (SillyTavern 1.19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st, quietly, mountPanel } from './helpers/env.mjs';

const script = await st('script.js');
const state = await ext('src/core/state.js');
const persistence = await ext('src/core/persistence.js');
const integration = await ext('src/systems/integration/sillytavern.js');
const injector = await ext('src/systems/generation/injector.js');
injector.initHistoryInjectionListeners();
await mountPanel();

const s = state.extensionSettings;
const slots = script.extension_prompts;
const filled = () => Object.keys(slots).filter((k) => k.startsWith('rpg-companion') && slots[k].value).sort();
const user = (mes) => ({ name: 'User', is_user: true, is_system: false, mes, send_date: mes, extra: {} });
function reply(mes, place) {
    const m = { name: 'Narrator', is_user: false, is_system: false, mes, send_date: mes, swipes: [mes], swipe_id: 0, swipe_info: [{ send_date: mes, extra: {} }], extra: {} };
    if (place) persistence.setMessageSwipeTrackerData(m, 0, { infoBox: JSON.stringify({ location: { value: place } }) });
    return m;
}
function setChat(...messages) {
    script.chat.length = 0;
    script.chat.push(...messages);
    for (const key of Object.keys(slots)) delete slots[key];
    Object.assign(s, { enabled: true, generationMode: 'together', enableDeceptionSystem: false, enableOmniscienceFilter: false, enableCYOA: false });
    s.historyPersistence = { ...s.historyPersistence, enabled: false };
    state.setLastActionWasSwipe(false);
}
const generate = (type = 'normal') => quietly(() => injector.onGenerationStarted(type, {}, false));

test('the previous trackers leave the prompt when the story is deleted back to the greeting', async () => {
    setChat(reply('Welcome.'), user('I pick the lock.'), reply('You are in a cell.', 'Cell'));
    await generate();
    assert.match(slots['rpg-companion-example'].value, /Cell/);
    script.chat.length = 1;
    await quietly(() => integration.onMessageDeleted(1));
    await generate();
    assert.equal(slots['rpg-companion-example'].value, '');
});

test('a chat with no greeting gets the previous trackers on turn 2', async () => {
    setChat(user('I pick the lock.'), reply('You are in a cell.', 'Cell'));
    await generate();
    assert.match(slots['rpg-companion-example'].value, /Cell/);
    assert.equal(slots['rpg-companion-example'].depth, 1);
});

test('turning RPG Companion off empties every prompt slot', async () => {
    setChat(reply('Welcome.'), user('I pick the lock.'), reply('You are in a cell.', 'Cell'));
    Object.assign(s, { enableDeceptionSystem: true, enableOmniscienceFilter: true, enableCYOA: true });
    await generate();
    assert.ok(['rpg-companion-deception', 'rpg-companion-omniscience', 'rpg-companion-zzz-cyoa'].every((k) => filled().includes(k)), filled().join(', '));
    s.enabled = false;
    integration.clearExtensionPrompts(); // what the off switch calls
    assert.deepEqual(filled(), []);
    // and a generation started while it is off leaves them empty
    slots['rpg-companion-deception'].value = 'left over';
    await generate();
    assert.deepEqual(filled(), []);
});

// History Persistence: each reply's tracker notes go on the user message that led to it
const prompt = (...entries) => entries.map(([role, content]) => ({ role, content }));
const notesOn = (messages) => messages.map((m) => [...m.content.matchAll(/Location: (\w+)/g)].map((x) => x[1]).join('+'));
async function sendPrompt(messages) {
    const eventData = { chat: messages, dryRun: false };
    await script.eventSource.emit('CHAT_COMPLETION_PROMPT_READY', eventData);
    return eventData.chat;
}

test('history notes stay out of the prompt once RPG Companion is off or the chat changes', async () => {
    const turn = () => [reply('Welcome.'), user('Status report, please.'), reply('You are in a cell.', 'Cell')];
    const sent = () => sendPrompt(prompt(['assistant', 'Welcome.'], ['user', 'Status report, please.'], ['assistant', 'Elsewhere.']));

    setChat(...turn());
    s.historyPersistence = { ...s.historyPersistence, enabled: true, messageCount: 0, injectionPosition: 'user_message_end' };
    await generate();
    assert.deepEqual(notesOn(await sent()), ['', 'Cell', ''], 'notes are sent while it is on');

    s.enabled = false;
    integration.clearExtensionPrompts();
    assert.deepEqual(notesOn(await sent()), ['', '', ''], 'off');

    setChat(...turn());
    s.historyPersistence = { ...s.historyPersistence, enabled: true, messageCount: 0, injectionPosition: 'user_message_end' };
    await generate();
    await script.eventSource.emit('CHAT_CHANGED');
    assert.deepEqual(notesOn(await sent()), ['', '', ''], 'another chat');
});
