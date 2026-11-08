// Text from the model's tracker JSON must stay text in the Info Box and Status panels
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, quietly } from './helpers/env.mjs';

const state = await ext('src/core/state.js');
const { parseUserStats } = await ext('src/systems/generation/parser.js');
const { renderInfoBox } = await ext('src/systems/rendering/infoBox.js');
const { renderUserStats } = await ext('src/systems/rendering/userStats.js');
const bad = (label) => `${label}"><b class="injected">x</b>'`;

function mount(setter) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    state[setter]($(host));
    return host;
}
const injected = (host) => [...host.querySelectorAll('.injected')].map((el) => el.parentElement?.className || el.parentElement?.tagName);

const infoBox = {
    date: { value: bad('Sunday') }, weather: { emoji: bad('W'), forecast: bad('rain') },
    temperature: { value: bad('12'), unit: bad('C') }, time: { start: bad('9:00'), end: bad('9:30') },
    location: { value: bad('Harbour') }, recentEvents: [bad('Event one'), bad('Event two')],
};
const userStats = {
    stats: [{ id: 'health', name: 'Health', value: 80 }],
    status: { mood: bad('M'), conditions: bad('Tired') },
    skills: [bad('Riding')],
    inventory: { onPerson: [{ name: 'Rope', quantity: 1 }] },
    quests: { main: { title: bad('Find Kael') } },
};

for (const theme of ['default', 'forge']) {
    test(`Info Box shows the model's text as text (${theme} theme)`, async () => {
        Object.assign(state.extensionSettings, { theme, showInfoBox: true });
        const host = mount('setInfoBoxContainer');
        state.lastGeneratedData.infoBox = JSON.stringify(infoBox);
        await quietly(() => renderInfoBox());
        assert.deepEqual(injected(host), []);
        assert.ok(host.textContent.includes(bad('Harbour')), 'location shown');
        host.remove();
    });

    test(`Status shows the model's text as text (${theme} theme)`, async () => {
        Object.assign(state.extensionSettings, { theme, showUserStats: true });
        const config = state.extensionSettings.trackerConfig.userStats;
        config.skillsSection = { ...config.skillsSection, enabled: true };
        const host = mount('setUserStatsContainer');
        state.lastGeneratedData.userStats = JSON.stringify(userStats);
        await quietly(() => parseUserStats(JSON.stringify(userStats)));
        await quietly(() => renderUserStats());
        assert.deepEqual(injected(host), []);
        assert.ok(host.textContent.includes(bad('Tired')), 'conditions shown');
        assert.ok(host.textContent.includes(bad('Riding')), 'skills shown');
        assert.ok(host.querySelector('.rpg-mood-emoji')?.textContent === bad('M'), 'mood shown');
        host.remove();
    });
}

test('phone panel-button widgets show the model\'s text as text', async () => {
    const { updateFabWidgets } = await ext('src/systems/ui/mobile.js');
    const on = { enabled: true };
    Object.assign(state.extensionSettings, {
        mobileFabWidgets: { enabled: true, weatherIcon: on, weatherDesc: on, clock: on, date: on, location: on, stats: on, attributes: on },
    });
    const fab = $('<div id="rpg-mobile-toggle"></div>').appendTo(document.body);
    const width = window.innerWidth;
    window.innerWidth = 400;
    state.lastGeneratedData.infoBox = JSON.stringify({ ...infoBox, location: { value: bad('A long harbour name') } });
    state.lastGeneratedData.userStats = JSON.stringify({ stats: [{ id: 'health', name: bad('Health'), value: 80 }] });
    try {
        await quietly(() => updateFabWidgets());
        const widgets = document.querySelector('#rpg-fab-widget-container');
        assert.ok(widgets?.textContent.includes(bad('A long harbour name')), 'location shown');
        assert.equal(document.querySelector('.injected'), null);
    } finally {
        window.innerWidth = width;
        $('#rpg-fab-widget-container').remove();
        fab.remove();
    }
});
