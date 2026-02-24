/**
 * online-sync.js — game.js ↔ Firebase リアルタイム同期レイヤー
 *
 * ─── ホスト側の動作 ─────────────────────────────────────────
 *   1. ui.js が Game.init() でゲームを初期化
 *   2. OnlineSync.start(true) → 初期状態をブロードキャスト + アクション監視開始
 *   3. クライアントからアクションが届く → game.js で処理 → 新状態をブロードキャスト
 *   4. ボット宣言後は broadcastAfterBotAction() を呼ぶ
 *
 * ─── クライアント側の動作 ──────────────────────────────────
 *   1. OnlineSync.start(false, onStateApplied) → 状態変化リスナー登録
 *   2. Firebase から状態が届く → ローカル game.js 状態に適用 → onStateApplied() で UI 再描画
 *   3. カード選択はローカルのみ（同期不要）
 *   4. 宣言・カード追加・次ラウンドは OnlineSync.sendAction() で送信
 */
const OnlineSync = (() => {

    let _isHost         = false;
    let _started        = false;
    let _onStateApplied = null;
    let _prevPhase      = null;

    // ── 同期開始 ───────────────────────────────────────────────
    /**
     * @param {boolean}  isHost        - true = ホスト、false = クライアント
     * @param {Function} onStateApplied - クライアント用: 状態適用後に呼ぶコールバック(rawData)
     */
    function start(isHost, onStateApplied) {
        _isHost         = isHost;
        _started        = true;
        _onStateApplied = onStateApplied;

        if (isHost) {
            // ホスト: アクションリスナーを登録
            Network.onAction(action => _processAction(action));
            // 初期状態をブロードキャスト
            Network.broadcastState(Game.getState());
        } else {
            // クライアント: 状態変化リスナーを登録
            Network.onStateChange(rawData => {
                _applyRemoteState(rawData);
                if (_onStateApplied) _onStateApplied(rawData);
            });
        }
    }

    // ── アクション送信（クライアント → ホスト） ─────────────────
    async function sendAction(action) {
        await Network.sendAction(action);
    }

    // ── ホスト: アクションを処理して状態を更新・ブロードキャスト ──
    function _processAction(action) {
        const { type, from, payload } = action;
        const gameId = _networkIdToGameId(from);
        if (!gameId) {
            console.warn('[OnlineSync] 不明な送信者:', from);
            return;
        }

        const st = Game.getState();
        if (!st || st.phase !== 'playing') return;

        switch (type) {

            case 'declare': {
                // 宣言者の選択状態を一時的にゲーム状態に反映
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

                if (!result.ok) {
                    // 失敗: 選択状態を元に戻す
                    Object.assign(st, saved);
                }
                Network.broadcastState(Game.getState());
                break;
            }

            case 'addCard': {
                Game.addCardToZone(payload.zone);
                Network.broadcastState(Game.getState());
                break;
            }

            case 'nextRound': {
                // ラウンド終了フェーズのみ受け付ける
                const cur = Game.getState();
                if (cur && cur.phase === 'roundEnd') {
                    Game.nextRound();
                    Network.broadcastState(Game.getState());
                }
                break;
            }
        }
    }

    // ── Network ID → game.js ID 変換 ─────────────────────────
    function _networkIdToGameId(networkId) {
        const room = Network.getRoom();
        if (!room?.idMap) return null;
        return room.idMap[networkId] || null;
    }

    // ── リモート状態をローカル game.js 状態に適用 ───────────────
    function _applyRemoteState(rawData) {
        const newSt = Network.deserializeState(rawData);

        let localSt = Game.getState();
        if (!localSt) {
            // ゲームがまだ初期化されていない場合: ダミーで初期化してから上書き
            Game.init({
                playerName: Network.getMyName() || 'Player',
                botCount:   0,
                botDiff:    'medium',
                rules:      newSt.rules || { fourPts: false },
            });
            localSt = Game.getState();
        }

        _prevPhase = localSt.phase;

        // game.js の内部状態オブジェクトをすべて上書き
        Object.keys(newSt).forEach(key => { localSt[key] = newSt[key]; });
    }

    // ── ホスト: ボット宣言後にブロードキャスト ────────────────
    function broadcastAfterBotAction() {
        if (_isHost && _started) {
            Network.broadcastState(Game.getState());
        }
    }

    // ── リセット（メニューに戻るとき） ────────────────────────
    function reset() {
        _isHost = false; _started = false; _onStateApplied = null; _prevPhase = null;
    }

    // ── 前フェーズを返す（状態遷移検出用） ───────────────────
    function getPrevPhase() { return _prevPhase; }

    return {
        start,
        sendAction,
        broadcastAfterBotAction,
        reset,
        isHost:       () => _isHost,
        getPrevPhase,
    };
})();
