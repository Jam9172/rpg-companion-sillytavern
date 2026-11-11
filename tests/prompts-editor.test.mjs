// The Prompts editor: its defaults are what is really sent, and it only stores what the user changed
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, quietly } from './helpers/env.mjs';

const { extensionSettings: s } = await ext('src/core/state.js');
const editor = await ext('src/systems/ui/promptsEditor.js');
const { generateTrackerInstructions } = await ext('src/systems/generation/promptBuilder.js');

const defaults = editor.getDefaultPrompts();
const kebab = (key) => key.replace(/([A-Z])/g, '-$1').toLowerCase();
const box = (key) => document.querySelector(`#rpg-prompt-${kebab(key)}`);
const click = (selector) => $(selector).first().trigger('click');
const customSettings = () => Object.keys(s).filter((k) => /^custom\w*Prompt$|^avatarLLMCustomInstruction$/.test(k) && s[k]);

// The editor's popup, as in template.html: one box and one Restore button per prompt
$(document.body).append(`<button id="rpg-open-prompts-editor"></button>
<div id="rpg-prompts-editor-popup">
  ${Object.keys(defaults).map((key) => `<textarea id="rpg-prompt-${kebab(key)}"></textarea><button class="rpg-restore-prompt-btn" data-prompt="${key}"></button>`).join('')}
  <button id="rpg-prompts-save"></button><button id="rpg-prompts-cancel"></button><button id="rpg-prompts-restore-all"></button>
</div>`);
// a prompt stored by an earlier Save although it is the default text
s.customHtmlPrompt = defaults.html;
editor.initPromptsEditor();

test('a prompt stored although it is the default goes back to following the default', () => {
    assert.equal(s.customHtmlPrompt, '');
});

test('Save without edits stores nothing and changes nothing that is sent', async () => {
    const before = await quietly(() => generateTrackerInstructions(false, true));
    click('#rpg-open-prompts-editor');
    click('#rpg-prompts-save');
    assert.deepEqual(customSettings(), []);
    assert.equal(await quietly(() => generateTrackerInstructions(false, true)), before);
});

test('the boxes show what is sent by default', async () => {
    click('#rpg-open-prompts-editor');
    const sent = await quietly(() => generateTrackerInstructions(false, true));
    const fill = (text) => text.replace(/{userName}/g, 'User');
    assert.ok(sent.includes(fill(box('trackerInstructions').value)), 'tracker instructions');
    assert.ok(sent.includes(fill(box('trackerContinuation').value)), 'tracker continuation');
    click('#rpg-prompts-cancel');
});

test('Restore changes the box; Cancel keeps the custom prompt, Save drops it', () => {
    s.customTrackerContinuationPrompt = 'My own continuation.';
    click('#rpg-open-prompts-editor');
    assert.equal(box('trackerContinuation').value, 'My own continuation.');
    click('.rpg-restore-prompt-btn[data-prompt="trackerContinuation"]');
    assert.equal(box('trackerContinuation').value, defaults.trackerContinuation);
    click('#rpg-prompts-cancel');
    assert.equal(s.customTrackerContinuationPrompt, 'My own continuation.');

    click('#rpg-open-prompts-editor');
    click('#rpg-prompts-restore-all');
    click('#rpg-prompts-save');
    assert.equal(s.customTrackerContinuationPrompt, '');
});

test('an edited prompt is stored and sent', async () => {
    click('#rpg-open-prompts-editor');
    box('trackerContinuation').value = 'Then carry on with the scene.';
    click('#rpg-prompts-save');
    assert.equal(s.customTrackerContinuationPrompt, 'Then carry on with the scene.');
    assert.ok((await quietly(() => generateTrackerInstructions(false, true))).includes('Then carry on with the scene.'));
    s.customTrackerContinuationPrompt = '';
});
