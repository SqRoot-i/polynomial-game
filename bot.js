/**
 * bot.js — Bot AI for Polynomial (v3)
 * Uses botApplyAndDeclare() which atomically sets selections before declaring.
 * Callback does NOT check phase (it's already 'roundEnd' when the bot wins).
 */
const Bot = (() => {
    const DELAYS = {
        easy:   [6000, 14000],
        medium: [1500,  6000],
        hard:   [ 400,  2200],
    };
    let timeouts = [];

    function clearAll() { timeouts.forEach(t => clearTimeout(t)); timeouts = []; }

    function scheduleBots(onFound) {
        clearAll();
        const st = Game.getState();
        if (!st || st.phase !== 'playing') return;

        const bots = st.players.filter(p => p.isBot);
        const [mn, mx] = DELAYS[st.botDiff] || DELAYS.medium;

        bots.forEach(bot => {
            const delay = mn + Math.random() * (mx - mn);
            const t = setTimeout(() => {
                const cur = Game.getState();
                if (!cur || cur.phase !== 'playing') return;
                if (cur.penalized.has(bot.id)) return;

                const solution = Game.botFindSolution(bot.id);
                if (solution) {
                    const result = Game.botApplyAndDeclare(bot.id, solution);
                    if (result.ok) onFound(bot.id, solution.formula, result.pts);
                }
            }, delay);
            timeouts.push(t);
        });
    }

    return { scheduleBots, clearAll };
})();
