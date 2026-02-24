/**
 * network.js — Polynomial オンライン (Firebase Realtime Database)
 *
 * ★ セットアップ手順は SETUP.md を参照してください ★
 *
 * Firebase 無料プラン (Spark) で動作:
 *   - 同時接続 100 / ストレージ 1GB / 転送 10GB/月
 *
 * FIREBASE_CONFIG の値は Firebase Console → プロジェクト設定 → マイアプリ で取得
 */

const Network = (() => {

    // ╔══════════════════════════════════════════════════════════╗
    // ║  ★★★  ここを自分の Firebase 設定に変更してください  ★★★  ║
    // ╚══════════════════════════════════════════════════════════╝
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyBiQfSVWw_JdxHDklfggLpsC8fS1Upcfp4",
        authDomain: "polynomial-game.firebaseapp.com",
        databaseURL: "https://polynomial-game-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "polynomial-game",
        storageBucket: "polynomial-game.firebasestorage.app",
        messagingSenderId: "875359750297",
        appId: "1:875359750297:web:14436d8cfc2dff11ab5008"
    };
    // ─── 設定ここまで ─────────────────────────────────────────

    // ── 内部状態 ──────────────────────────────────────────────
    let _db          = null;
    let _room        = null;   // { roomId, password, players, idMap }
    let _myId        = null;
    let _myName      = null;
    let _isHost      = false;
    let _unsubs      = [];     // Firebase リスナー解除関数群

    const _chatCbs   = [];
    const _actionCbs = [];
    const _roomCbs   = [];
    const _stateCbs  = [];

    // ── Firebase 初期化 ────────────────────────────────────────
    function _initFirebase() {
        if (_db) return true;
        if (typeof firebase === 'undefined') {
            console.warn('[Network] Firebase SDK が未ロード。ローカルスタブ で動作します。');
            return false;
        }
        try {
            if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
            _db = firebase.database();
            return true;
        } catch (e) {
            console.error('[Network] Firebase 初期化エラー:', e);
            return false;
        }
    }

    // ── ユーティリティ ────────────────────────────────────────
    const _rnd = (n, s) =>
        Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');

    const generateRoomId   = () => _rnd(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    const generatePassword = () => _rnd(4, '0123456789');

    function _path(sub = '') {
        return `/rooms/${_room.roomId}${sub ? '/' + sub : ''}`;
    }

    function _listen(ref, event, cb) {
        ref.on(event, cb);
        _unsubs.push(() => ref.off(event, cb));
    }

    // ── ルーム作成（ホスト） ───────────────────────────────────
    async function createRoom(hostName, gameConfig) {
        if (!_initFirebase()) return _localCreateRoom(hostName, gameConfig);

        const roomId   = generateRoomId();
        const password = generatePassword();
        _myId   = 'host_' + Date.now();
        _myName = hostName;
        _isHost = true;
        _room   = { roomId, password, players: [], config: gameConfig };

        await _db.ref(`/rooms/${roomId}`).set({
            meta: { hostId: _myId, password, createdAt: Date.now(), started: false },
            players: {
                [_myId]: { name: hostName, isHost: true, order: 0, connected: true },
            },
        });

        // ホスト切断時: 自エントリをオフラインに + ルーム削除
        _db.ref(`/rooms/${roomId}/players/${_myId}/connected`).onDisconnect().set(false);
        _db.ref(`/rooms/${roomId}`).onDisconnect().remove();

        // プレイヤー参加監視
        _listen(_db.ref(`/rooms/${roomId}/players`), 'value', snap => {
            const data = snap.val() || {};
            _room.players = Object.entries(data)
                .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
                .map(([id, p]) => ({ id, ...p }));
            _roomCbs.forEach(cb => cb('update', _room.players));
        });

        return { roomId, password };
    }

    // ── ルーム参加（クライアント） ─────────────────────────────
    async function joinRoom(roomId, password, playerName) {
        if (!_initFirebase()) return _localJoinRoom(roomId, password, playerName);

        const snap     = await _db.ref(`/rooms/${roomId}`).once('value');
        const roomData = snap.val();

        if (!roomData)                           return { ok: false, why: 'ルームが見つかりません' };
        if (roomData.meta.password !== password) return { ok: false, why: 'パスワードが違います' };
        if (roomData.meta.started)               return { ok: false, why: 'すでにゲームが開始済みです' };

        const playerCount = Object.keys(roomData.players || {}).length;
        if (playerCount >= 8)                    return { ok: false, why: 'ルームが満員です' };

        const pid = 'p_' + Date.now() + '_' + _rnd(4, '0123456789');
        _myId   = pid;
        _myName = playerName;
        _isHost = false;
        _room   = { roomId, password, players: [] };

        await _db.ref(`/rooms/${roomId}/players/${pid}`).set({
            name: playerName, isHost: false, order: playerCount, connected: true,
        });
        _db.ref(`/rooms/${roomId}/players/${pid}/connected`).onDisconnect().set(false);

        // プレイヤー一覧監視
        _listen(_db.ref(`/rooms/${roomId}/players`), 'value', snap => {
            const data = snap.val() || {};
            _room.players = Object.entries(data)
                .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
                .map(([id, p]) => ({ id, ...p }));
            _roomCbs.forEach(cb => cb('update', _room.players));
        });

        // ゲーム状態監視（ホストが更新するたびに受信）
        _listen(_db.ref(`/rooms/${roomId}/state`), 'value', snap => {
            const st = snap.val();
            if (st) _stateCbs.forEach(cb => cb(st));
        });

        // チャット監視
        _listen(_db.ref(`/rooms/${roomId}/chat`).limitToLast(100), 'child_added', snap => {
            _chatCbs.forEach(cb => cb(snap.val()));
        });

        // ID マップ監視（自分のゲーム内IDを知るため）
        _listen(_db.ref(`/rooms/${roomId}/idMap`), 'value', snap => {
            const map = snap.val();
            if (map) _room.idMap = map;
        });

        return { ok: true, playerId: pid };
    }

    // ── ゲーム開始をマーク（ホストのみ） ─────────────────────
    async function markStarted(idMap) {
        if (!_db || !_isHost || !_room) return;
        await _db.ref(_path('meta/started')).set(true);
        await _db.ref(_path('idMap')).set(idMap);
        _room.idMap = idMap;

        // ホスト用チャット監視
        _listen(_db.ref(_path('chat')).limitToLast(100), 'child_added', snap => {
            _chatCbs.forEach(cb => cb(snap.val()));
        });

        // ホスト用アクション監視（クライアントからのアクションを受信→処理済みで削除）
        _listen(_db.ref(_path('actions')), 'child_added', snap => {
            const action = snap.val();
            if (action) {
                _actionCbs.forEach(cb => cb({ ...action, _key: snap.key }));
                snap.ref.remove();
            }
        });
    }

    // ── ゲーム状態ブロードキャスト（ホスト→全員） ─────────────
    async function broadcastState(gameState) {
        if (!_db || !_isHost || !_room) return;
        await _db.ref(_path('state')).set(serializeState(gameState));
    }

    // ── アクション送信（クライアント→ホスト） ─────────────────
    async function sendAction(action) {
        if (!_room) {
            _actionCbs.forEach(cb => cb({ ...action, from: _myId }));
            return;
        }
        if (_isHost) {
            _actionCbs.forEach(cb => cb({ ...action, from: _myId }));
        } else {
            await _db.ref(_path('actions')).push({
                ...action,
                from:      _myId,
                fromName:  _myName,
                timestamp: Date.now(),
            });
        }
    }

    // ── チャット ──────────────────────────────────────────────
    function sendChat(text) {
        if (!text?.trim()) return;
        const msg = { sender: _myName, senderId: _myId, text: text.trim(), time: Date.now() };
        if (_db && _room) {
            _db.ref(_path('chat')).push(msg);
        } else {
            _chatCbs.forEach(cb => cb(msg));
        }
    }

    // ── ルーム退出 ─────────────────────────────────────────────
    function leaveRoom() {
        _unsubs.forEach(fn => { try { fn(); } catch {} });
        _unsubs = [];
        if (_db && _room) {
            _db.ref(_path(`players/${_myId}`)).remove().catch(() => {});
            if (_isHost) _db.ref(_path()).remove().catch(() => {});
        }
        _room = null; _myId = null; _myName = null; _isHost = false;
        _chatCbs.length = _actionCbs.length = _roomCbs.length = _stateCbs.length = 0;
    }

    // ── イベントリスナー ───────────────────────────────────────
    function onChat(cb)       { _chatCbs.push(cb); }
    function onAction(cb)     { _actionCbs.push(cb); }
    function onRoomChange(cb) { _roomCbs.push(cb); }
    function onStateChange(cb){ _stateCbs.push(cb); }
    function offAll() {
        _chatCbs.length = _actionCbs.length = _roomCbs.length = _stateCbs.length = 0;
    }

    // ── 状態シリアライズ / デシリアライズ ──────────────────────
    function serializeState(st) {
        return JSON.parse(JSON.stringify(st, (_, v) => {
            if (v instanceof Set) return { __isSet: true, values: [...v] };
            return v;
        }));
    }

    function deserializeState(data) {
        return JSON.parse(JSON.stringify(data), (_, v) => {
            if (v && typeof v === 'object' && v.__isSet === true) return new Set(v.values || []);
            return v;
        });
    }

    // ── Firebase 未設定時のローカルスタブ ──────────────────────
    function _localCreateRoom(hostName, gameConfig) {
        const roomId = generateRoomId(), password = generatePassword();
        _myId = 'human'; _myName = hostName; _isHost = true;
        _room = {
            roomId, password, config: gameConfig,
            players: [{ id: 'human', name: hostName, isHost: true, order: 0 }],
        };
        return { roomId, password };
    }
    function _localJoinRoom(roomId, password, playerName) {
        if (!_room)                       return { ok: false, why: 'ルームが見つかりません' };
        if (_room.roomId !== roomId)      return { ok: false, why: 'ルームIDが違います' };
        if (_room.password !== password)  return { ok: false, why: 'パスワードが違います' };
        if (_room.players.length >= 8)    return { ok: false, why: 'ルームが満員です' };
        const pid = `p_${Date.now()}`;
        _myId = pid; _myName = playerName; _isHost = false;
        const player = { id: pid, name: playerName, isHost: false, order: _room.players.length };
        _room.players.push(player);
        _roomCbs.forEach(cb => cb('join', player));
        return { ok: true, playerId: pid };
    }

    // ── 公開 API ───────────────────────────────────────────────
    return {
        createRoom, joinRoom, leaveRoom,
        markStarted, broadcastState,
        sendAction, sendChat,
        onChat, onAction, onRoomChange, onStateChange,
        offAll, serializeState, deserializeState,
        getRoom:      () => _room,
        isOnline:     () => _room !== null,
        isHost:       () => _isHost,
        getMyId:      () => _myId,
        getMyName:    () => _myName,
        getMyGameId:  () => {
            if (!_room) return 'human';
            if (_isHost) return _room.idMap?.['host'] || 'human';
            return _room.idMap?.[_myId] || null;
        },
        generateRoomId, generatePassword,
    };
})();
