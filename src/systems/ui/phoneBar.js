/**
 * Compact phone layout: on phones the buttons that floated over the chat (the panel button, the thought
 * icon, the Elsewhere button) are docked into the row above the message box, next to the plot buttons,
 * and the info pills around the panel button are hidden (the panel shows the same things). Nothing
 * floats over the chat. Setting: compactPhoneLayout (on by default); off brings back the old layout.
 */
import { extensionSettings } from '../../core/state.js';

const PHONE_WIDTH = 1000;

export function isCompactPhone() {
    return extensionSettings.enabled !== false
        && extensionSettings.compactPhoneLayout !== false
        && window.innerWidth <= PHONE_WIDTH;
}

/** Moves the floating buttons into the bar above the message box on phones, or back out of it. */
export function dockPhoneButtons() {
    const compact = isCompactPhone();
    document.body.classList.toggle('rpg-compact-phone', compact);

    if (!compact) {
        const $bar = $('#rpg-phone-bar');
        if ($bar.length) {
            $bar.children().removeClass('rpg-docked').appendTo('body');
            $bar.remove();
            // The panel button goes back to where it was dragged to
            const pos = extensionSettings.mobileFabPosition;
            const toggle = document.getElementById('rpg-mobile-toggle');
            if (toggle && pos) {
                for (const side of ['top', 'right', 'bottom', 'left']) if (pos[side]) toggle.style[side] = pos[side];
            }
        }
        return;
    }

    const $buttons = $('#rpg-mobile-toggle, #rpg-thought-icon, #rpg-elsewhere-button');
    if (!$buttons.length) {
        $('#rpg-phone-bar').remove();
        return;
    }

    // The plot buttons' row: made by the plot buttons, or here when they have not made it yet
    if (!$('#extension-buttons-wrapper').length) {
        $('#send_form').prepend('<div id="extension-buttons-wrapper" style="text-align: center; margin: 5px auto;"></div>');
    }
    let $bar = $('#rpg-phone-bar');
    if (!$bar.length) {
        $bar = $('<span id="rpg-phone-bar"></span>');
        $('#extension-buttons-wrapper').prepend($bar);
    }
    // Panel button, thoughts, then Elsewhere, whatever order they were drawn in
    for (const id of ['rpg-mobile-toggle', 'rpg-thought-icon', 'rpg-elsewhere-button']) {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('rpg-docked');
            el.style.removeProperty('top');
            el.style.removeProperty('left');
            el.style.removeProperty('right');
            el.style.removeProperty('bottom');
            $bar.append(el);
        }
    }
}

let resizeTimer = null;
export function initPhoneBar() {
    $(window).off('resize.rpgPhoneBar').on('resize.rpgPhoneBar', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(dockPhoneButtons, 150);
    });
    dockPhoneButtons();
}
