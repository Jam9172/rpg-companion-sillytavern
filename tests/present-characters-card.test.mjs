import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, quietly } from './helpers/env.mjs';

const state = await ext('src/core/state.js');
const { renderThoughts } = await ext('src/systems/rendering/thoughts.js');
const bad = (label) => `${label}"><b class="injected">x</b>'`;

async function renderCard(character, { theme } = {}) {
    Object.assign(state.extensionSettings, {
        showCharacterThoughts: true,
        showLockIcons: true,
        theme: theme ?? state.extensionSettings.theme,
        trackerConfig: {
            ...state.extensionSettings.trackerConfig,
            presentCharacters: {
                ...state.extensionSettings.trackerConfig?.presentCharacters,
                customFields: [{ name: 'Appearance', enabled: true }, { name: 'Thoughts', enabled: true }],
                relationshipFields: ['Friend', 'Rival'],
                characterStats: { enabled: true, customStats: [{ name: 'Health', enabled: true }] },
            },
        },
    });
    state.lastGeneratedData.characterThoughts = JSON.stringify([character]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    state.setThoughtsContainer($(host));
    await quietly(() => renderThoughts({ useCommittedFallback: false }));
    return host;
}

for (const theme of ['default', 'forge']) {
    test(`text from the model stays text on the Present Characters card (${theme} theme)`, async () => {
        const name = bad('Mira');
        const host = await renderCard({
            name, emoji: bad('E'), relationship: bad('Rel'), details: { Appearance: bad('Tall') },
            thoughts: { content: bad('Thinks') }, stats: [{ name: 'Health', value: bad('80') }],
        }, { theme });
        const text = host.textContent;
        for (const shown of [name, bad('E'), bad('Tall')]) assert.ok(text.includes(shown), `shows ${shown}`);
        assert.equal(host.querySelector('.rpg-relationship-badge')?.textContent, bad('Rel'));
        assert.ok(host.querySelector('.rpg-character-stat')?.textContent.includes(bad('80')), 'stat shown');
        assert.ok(host.querySelector('.rpg-character-card'), 'a card was rendered');
        assert.equal(host.querySelector('.injected'), null);
        assert.equal(host.querySelector('.rpg-character-card').getAttribute('data-character-name'), name);
        assert.equal(host.querySelector('.rpg-character-name').textContent, name);
        for (const el of host.querySelectorAll('[data-character]')) assert.equal(el.getAttribute('data-character'), name);
    });
}

test('ordinary names and values look the same as before', async () => {
    const host = await renderCard({ name: 'Mira Ashdown', emoji: '🙂', details: { Appearance: 'Copper hair & burn scars' } });
    assert.equal(host.querySelector('.rpg-character-name').textContent, 'Mira Ashdown');
    assert.equal(host.querySelector('.rpg-character-emoji').textContent, '🙂');
    assert.ok([...host.querySelectorAll('[data-field="Appearance"]')].some((el) => el.textContent === 'Copper hair & burn scars'));
});

const { createThoughtPanel } = await ext('src/systems/rendering/thoughts.js');
for (const theme of ['default', 'forge']) {
    test(`thoughts from the model stay text in the thought panel (${theme} theme)`, async () => {
        state.extensionSettings.theme = theme;
        const message = $('<div class="mes"><div class="avatar"><img src="a.png"></div><div class="mes_text"></div></div>').appendTo(document.body);
        const thought = { name: bad('Mira'), emoji: bad('E'), thought: bad('Thinks') };
        await quietly(() => createThoughtPanel(message, [thought]));
        const panel = document.querySelector('#rpg-thought-panel');
        assert.ok(panel, 'panel built');
        assert.equal(document.querySelector('.injected'), null);
        assert.ok(panel.textContent.includes(bad('Thinks')), 'shows the thought as text');
        assert.equal(panel.querySelector('.rpg-thought-content').getAttribute('data-character'), bad('Mira'));
        $('#rpg-thought-panel, #rpg-thought-icon, #rpg-thoughts-button').remove();
        message.remove();
    });
}
