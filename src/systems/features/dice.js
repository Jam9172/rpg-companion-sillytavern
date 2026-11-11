/**
 * Dice System Module
 * Handles dice rolling logic, display updates, and quick reply integration
 */

import {
    extensionSettings,
    pendingDiceRoll,
    setPendingDiceRoll
} from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { i18n } from '../../core/i18n.js';

/**
 * Rolls the dice and displays result.
 * Works with the DiceModal class for UI updates.
 * @param {DiceModal} diceModal - The DiceModal instance
 */
export async function rollDice(diceModal) {
    if (!diceModal) return;

    const count = parseInt(String($('#rpg-dice-count').val())) || 1;
    const sides = parseInt(String($('#rpg-dice-sides').val())) || 20;

    // Start rolling animation
    diceModal.startRolling();

    // Wait for animation (simulate rolling)
    await new Promise(resolve => setTimeout(resolve, 1200));

    // Execute /roll command
    const rollCommand = `/roll ${count}d${sides}`;
    const rollResult = await executeRollCommand(rollCommand);

    // Parse result
    const total = rollResult.total || 0;
    const rolls = rollResult.rolls || [];

    // Store result temporarily (not saved until "Save Roll" is clicked)
    setPendingDiceRoll({
        formula: `${count}d${sides}`,
        total: total,
        rolls: rolls,
        timestamp: Date.now()
    });

    // Show result
    diceModal.showResult(total, rolls);

    // Don't update sidebar display yet - only update when user clicks "Save Roll"
}

/**
 * Executes a /roll command and returns the result.
 * @param {string} command - The roll command (e.g., "/roll 2d20")
 * @returns {Promise<{total: number, rolls: Array<number>}>} The roll result
 */
export async function executeRollCommand(command) {
    try {
        // Parse the dice notation (e.g., "2d20")
        const match = command.match(/(\d+)d(\d+)/);
        if (!match) {
            return { total: 0, rolls: [] };
        }

        const count = parseInt(match[1]);
        const sides = parseInt(match[2]);
        const rolls = [];
        let total = 0;

        for (let i = 0; i < count; i++) {
            const roll = Math.floor(Math.random() * sides) + 1;
            rolls.push(roll);
            total += roll;
        }

        return { total, rolls };
    } catch (error) {
        console.error('[RPG Companion] Error rolling dice:', error);
        return { total: 0, rolls: [] };
    }
}

/**
 * Updates the dice display in the sidebar.
 */
export function updateDiceDisplay() {
    // Hide the entire dice display if showDiceDisplay is false
    const $display = $('#rpg-dice-display');
    if (!extensionSettings.showDiceDisplay) {
        $display.hide();
        return;
    } else {
        $display.show();
    }

    const lastRoll = extensionSettings.lastDiceRoll;
    const label = i18n.getTranslation('template.mainPanel.lastRoll') || 'Last Roll: ';
    const noneValue = i18n.getTranslation('global.none') || 'None';

    if (lastRoll) {
        $('#rpg-last-roll-text').text(`${label}(${lastRoll.formula}): ${lastRoll.total}`);
    } else {
        $('#rpg-last-roll-text').text(label + noneValue);
    }
}

/**
 * Clears the last dice roll.
 * Called when the x button is clicked.
 */
export function clearDiceRoll() {
    extensionSettings.lastDiceRoll = null;
    saveSettings();
    updateDiceDisplay();
}

/**
 * A saved roll is for one turn: the reply to the next message, and any swipe or Regenerate of that reply.
 * Called when a generation starts. A new turn uses the roll if it is fresh, and drops one that an earlier
 * turn already used (it used to be sent with every later message, in every chat, until cleared by hand).
 * @param {string} generationType - SillyTavern's generation type
 */
export function advanceDiceRoll(generationType) {
    const roll = extensionSettings.lastDiceRoll;
    const startsNewTurn = !generationType || generationType === 'normal';
    if (!roll || !startsNewTurn) return;

    if (roll.used) {
        clearDiceRoll();
    } else {
        roll.used = true;
        saveSettings();
    }
}

/**
 * Adds the Roll Dice quick reply button.
 */
export function addDiceQuickReply() {
    // Create quick reply button if Quick Replies exist
    if (window.quickReplyApi) {
        // Quick Reply API integration would go here
        // For now, the dice display in the sidebar serves as the button
    }
}
