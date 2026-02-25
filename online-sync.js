/**
 * online-sync.js — game.js ↔ Firebase リアルタイム同期レイヤー
 */
const OnlineSync = (() => {

    let _isHost         = false;
    let _started        = false;
    let _onStateApplied = null;
    let _prevPhase      = null;

    function start(isHost, onStateApplied) {
        _isHost         = isHost;
        _started        = true;
        _onStateApplied = onStateApplied;

        if (isHost) {
            Network.onAction(action => _processAction(action));
            Network.broadcastState(Game.getState());
        } else {
            Network.onStateChange(rawData => {
                _applyRemoteState(rawData);
                if (_onStateApplied) _onStateApplied(rawData);
            });
        }
    }

    async function sendAction(action) {
        await Network.sendAction(action);
    }

    function _processAction(action) {
        const { type, from, payload } = action;
        const gameId = _networkIdToGameId(from);
        if (!gameId) { console.warn('[OnlineSync] 不明な送信者:', from); return; }

        const st = Game.getState();

        switch (type) {
            case 'declare': {
                if (!st || st.phase !== 'playing') return;
                const saved = {
                    selA: [...st.selA], selB: [...st.selB],
                    nValues: { ...st.nValues }, revTargets: { ...st.revTargets },
                };
                st.selA       = payload.selA       || saved.selA;
                st.selB       = payload.selB       || saved.selB;
                st.nValues    = payload.nValues    || {};
                st.revTargets = payload.revTargets || {};
                st.revPending = null;

                const result = Game.declare(gameId, payload.formula, payload.direction || 'auto');
                if (!result.ok) Object.assign(st, saved);
                Network.broadcastState(Game.getState());
                break;
            }

            case 'nextRound': {
                const cur = Game.getState();
                if (cur && cur.phase === 'roundEnd') {
                    Game.nextRound();
                    Network.broadcastState(Game.getState());
                }
                break;
            }
        }
    }

    function _networkIdToGameId(networkId) {
        const room = Network.getRoom();
        if (!room?.idMap) return null;
        return room.idMap[networkId] || null;
    }

    function _applyRemoteState(rawData) {
        const newSt = Network.deserializeState(rawData);
        let localSt = Game.getState();
        if (!localSt) {
            Game.init({
                playerName: Network.getMyName() || 'Player',
                botCount: 0, botDiff: 'medium',
                rules: newSt.rules || { fourPts: false },
            });
            localSt = Game.getState();
        }
        _prevPhase = localSt.phase;
        Object.keys(newSt).forEach(key => { localSt[key] = newSt[key]; });
    }

    function broadcastAfterBotAction() {
        if (_isHost && _started) Network.broadcastState(Game.getState());
    }

    function reset() {
        _isHost = false; _started = false; _onStateApplied = null; _prevPhase = null;
    }

    function getPrevPhase() { return _prevPhase; }

    return { start, sendAction, broadcastAfterBotAction, reset, isHost: () => _isHost, getPrevPhase };
})();
