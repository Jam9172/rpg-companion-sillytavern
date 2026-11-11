// A swipe or Regenerate replaces the last reply: the model must get the state from before that reply,
// not the replaced reply's. Events fire in SillyTavern 1.19's order: a new swipe sets
// swipe_id = swipes.length (the message text stays the old swipe's) and emits MESSAGE_SWIPED, then
// GENERATION_STARTED; Regenerate emits GENERATION_STARTED, then deletes the old reply (MESSAGE_DELETED).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st, quietly } from './helpers/env.mjs';

const script = await st('script.js');
const state = await ext('src/core/state.js');
const persistence = await ext('src/core/persistence.js');
const integration = await ext('src/systems/integration/sillytavern.js');
const { onGenerationStarted } = await ext('src/systems/generation/injector.js');

const trackers = (place) => ({ infoBox: JSON.stringify({ location: { value: place } }) });
const placeIn = (data) => JSON.parse(data?.infoBox || 'null')?.location?.value ?? null;
function reply(text, place) {
    const m = { name: 'Narrator', is_user: false, is_system: false, mes: text, send_date: text, swipes: [text], swipe_id: 0, swipe_info: [{ send_date: text, extra: {} }], extra: {} };
    persistence.setMessageSwipeTrackerData(m, 0, trackers(place));
    return m;
}
function startChat() {
    state.extensionSettings.enabled = true;
    state.extensionSettings.generationMode = 'together';
    script.chat.length = 0;
    script.chat.push(reply('You wake in a cell.', 'Cell'));
    script.chat.push({ name: 'User', is_user: true, is_system: false, mes: 'I pick the lock.', send_date: 'u1', extra: {} });
    script.chat.push(reply('You slip into the corridor.', 'Corridor'));
    state.setLastActionWasSwipe(false);
    state.setIsAwaitingNewMessage(false);
}
const run = (fn) => quietly(async () => { try { await fn(); } catch { /* prompt building needs the real page */ } });

test('a new swipe starts from the state before the reply it replaces', async () => {
    startChat();
    const last = script.chat[2];
    last.swipe_id = last.swipes.length; // SillyTavern: new swipe pending, text unchanged
    await run(() => integration.onMessageSwiped(2));
    await run(() => onGenerationStarted('swipe', {}, false));
    assert.equal(placeIn(state.committedTrackerData), 'Cell');
    assert.equal(state.isAwaitingNewMessage, true, 'a tracker update follows the new swipe');
});

test('Regenerate starts from the state before the reply it replaces', async () => {
    startChat();
    await run(() => onGenerationStarted('regenerate', {}, false));
    assert.equal(placeIn(state.committedTrackerData), 'Cell');
    assert.equal(state.isAwaitingNewMessage, true, 'a tracker update follows the regenerated reply');
    // SillyTavern then deletes the old reply
    script.chat.pop();
    await run(() => integration.onMessageDeleted(2));
    assert.equal(placeIn(state.committedTrackerData), 'Cell');
});

test('a normal turn still starts from the latest reply', async () => {
    startChat();
    script.chat.push({ name: 'User', is_user: true, is_system: false, mes: 'I run.', send_date: 'u2', extra: {} });
    await run(() => onGenerationStarted('normal', {}, false));
    assert.equal(placeIn(state.committedTrackerData), 'Corridor');
});

test('flipping back to an existing swipe keeps that swipe\'s trackers', async () => {
    startChat();
    const last = script.chat[2];
    last.swipes.push('You climb to the roof.');
    last.swipe_info.push({ send_date: 'r2', extra: {} });
    persistence.setMessageSwipeTrackerData(last, 1, trackers('Roof'));
    last.swipe_id = 1; script.syncSwipeToMes?.(2, 1); last.mes = last.swipes[1];
    await run(() => integration.onMessageSwiped(2));
    assert.equal(placeIn(state.lastGeneratedData), 'Roof');
    assert.equal(state.isAwaitingNewMessage, false);
});
