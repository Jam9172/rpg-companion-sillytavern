/**
 * Scroll edges: marks scrollable parts of the panel with rpg-more-before / rpg-more-after while there is
 * more to scroll that way, so the stylesheet can fade that edge instead of cutting content off with no
 * hint (the tab content scrolls down, the feature toggles sideways).
 */

const SELECTORS = {
    y: '#rpg-companion-panel .rpg-tab-content',
    x: '#rpg-companion-panel .rpg-features-row',
};

function update(element, axis) {
    const before = axis === 'x' ? element.scrollLeft : element.scrollTop;
    const size = axis === 'x' ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
    element.classList.toggle('rpg-more-before', size > 2 && before > 2);
    element.classList.toggle('rpg-more-after', size > 2 && before < size - 2);
}

function updateAll() {
    for (const [axis, selector] of Object.entries(SELECTORS)) {
        document.querySelectorAll(selector).forEach((element) => update(element, axis));
    }
}

let scheduled = false;
function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        updateAll();
    });
}

let started = false;

/** Starts watching (once; the panel itself may be rebuilt, the listeners are on the document). */
export function initScrollEdges() {
    if (started) {
        schedule();
        return;
    }
    started = true;
    // scroll does not bubble: listen in the capture phase
    document.addEventListener('scroll', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        for (const [axis, selector] of Object.entries(SELECTORS)) {
            if (target.matches(selector)) update(target, axis);
        }
    }, true);
    window.addEventListener('resize', schedule);
    // Tabs switching and panels re-rendering change what can scroll
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    schedule();
}
