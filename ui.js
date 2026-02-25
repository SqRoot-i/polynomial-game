/**
 * ui.js — Polynomial UI v4
 *
 * Changes from v3:
 *  - 4pts縛り チェックボックス削除
 *  - 個人縛り: オンライン参加者を反映 / 排他制限の撤廃
 *  - カード追加: オンライン時は全員投票制（投票モーダル + チャット）
 *  - 公開ルーム: ルーム名・公開設定・一覧表示
 *  - ロビーチャット（ゲーム開始前から利用可能）
 *  - 30秒操作なしで解の有無ヒントを表示
 *  - ログ管理: 試合終了で消去 / 過去ログ保持・閲覧
 */

const PAIR_COLORS = ['pair-0','pair-1','pair-2','pair-3'];
const PAIR_LABELS = ['ペア①','ペア②','ペア③','ペア④'];
const PAIR_HEX    = ['var(--p0)','var(--p1)','var(--p2)','var(--p3)'];
const CONSTRAINT_LABELS = { integer:'整数係数縛り', origin:'原点縛り', even:'偶関数縛り' };
const AUTO_ADVANCE_SECS = 8;
const INACTIVITY_SECS   = 30;

/* ── State ── */
let zoneDirection    = 'AB';
let autoAdvTimer     = null;
let autoAdvRemain    = 0;
let graphListeners   = [];
let _zonePickerBound = false;
let _onlineMode      = false;
let _inactivityTimer = null;
let _pastLogs        = [];   // 過去試合のログ
let _currentLogs     = [];   // 現在試合のログ

/* ── Element refs ── */
const $ = id => document.getElementById(id);

const els = {
    setupScreen:$('setupScreen'), gameScreen:$('gameScreen'),
    playerName:$('playerName'), botCount:$('botCount'), botDiff:$('botDiff'),
    startBtn:$('startBtn'), menuBtn:$('menuBtn'),
    addCardBtn:$('addCardBtn'),
    roundNum:$('roundNum'), deckNum:$('deckNum'),
    rulesBadges:$('rulesBadges'),
    zoneAEl:$('zoneAEl'), zoneBEl:$('zoneBEl'),
    zonePanelA:$('zonePanelA'), zonePanelB:$('zonePanelB'),
    zoneHintA:$('zoneHintA'), zoneHintB:$('zoneHintB'),
    pairLegend:$('pairLegend'),
    cntA:$('cntA'), cntB:$('cntB'), neededA:$('neededA'), neededB:$('neededB'), neededTxt:$('neededTxt'),
    funcInput:$('funcInput'), declareBtn:$('declareBtn'),
    msgBar:$('msgBar'), botRow:$('botRow'),
    scoreboard:$('scoreboard'), logBox:$('logBox'),
    modal:$('modal'), modalTitle:$('modalTitle'),
    modalWinner:$('modalWinner'), modalFn:$('modalFn'),
    modalPts:$('modalPts'), modalScores:$('modalScores'),
    nextRoundBtn:$('nextRoundBtn'), selStatus:$('selStatus'),
    specialPanel:$('specialPanel'),
    dirAB:$('dirAB'), dirBA:$('dirBA'), dirSwap:$('dirSwap'),
    graphContainer:$('graphContainer'), fnGraph:$('fnGraph'),
    countdownRow:$('countdownRow'), countdownBar:$('countdownBar'), countdownNum:$('countdownNum'),
    zonePickerModal:$('zonePickerModal'), zonePickerPreview:$('zonePickerPreview'),
    zoneACount:$('zoneACount'), zoneBCount:$('zoneBCount'),
    pickZoneA:$('pickZoneA'), pickZoneB:$('pickZoneB'), cancelAddCard:$('cancelAddCard'),
    tabLocal:$('tabLocal'), tabOnline:$('tabOnline'),
    onlineName:$('onlineName'),
    roomName:$('roomName'), roomPublic:$('roomPublic'),
    createRoomBtn:$('createRoomBtn'), roomInfo:$('roomInfo'),
    roomIdDisplay:$('roomIdDisplay'), roomPassDisplay:$('roomPassDisplay'),
    copyRoomId:$('copyRoomId'), copyRoomPass:$('copyRoomPass'),
    roomPlayerList:$('roomPlayerList'),
    lobbyChat:$('lobbyChat'), lobbyChatBox:$('lobbyChatBox'),
    lobbyChatInput:$('lobbyChatInput'), lobbyChatsend:$('lobbyChatsend'),
    publicRoomList:$('publicRoomList'), refreshRoomsBtn:$('refreshRoomsBtn'),
    joinRoomId:$('joinRoomId'), joinPassword:$('joinPassword'),
    joinRoomBtn:$('joinRoomBtn'), joinStatus:$('joinStatus'),
    hostPanel:$('hostPanel'), joinPanel:$('joinPanel'),
    globalConstraintPanel:$('globalConstraintPanel'),
    individualConstraintPanel:$('individualConstraintPanel'),
    perPlayerConstraints:$('perPlayerConstraints'),
    chatSection:$('chatSection'), chatBox:$('chatBox'),
    chatInput:$('chatInput'), chatSend:$('chatSend'),
    cardVoteModal:$('cardVoteModal'), voteStatus:$('voteStatus'),
    voteZoneA:$('voteZoneA'), voteZoneB:$('voteZoneB'),
    voteChatBox:$('voteChatBox'), voteChatInput:$('voteChatInput'), voteChatSend:$('voteChatSend'),
    inactivityHint:$('inactivityHint'),
    pastLogsModal:$('pastLogsModal'), pastLogsBox:$('pastLogsBox'),
    pastLogsBtn:$('pastLogsBtn'), closePastLogs:$('closePastLogs'),
};

/* ── Core event bindings ── */
els.startBtn.addEventListener('click', handleStart);
els.menuBtn.addEventListener('click', handleMenu);
els.addCardBtn.addEventListener('click', handleAddCard);
els.declareBtn.addEventListener('click', handleDeclare);
els.funcInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleDeclare(); });
els.funcInput.addEventListener('input', resetInactivityTimer);
els.nextRoundBtn.addEventListener('click', handleNextRound);

// Setup tabs
document.querySelectorAll('.setup-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.setup-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        els.tabLocal.classList.toggle('hidden', tab !== 'local');
        els.tabOnline.classList.toggle('hidden', tab !== 'online');
        _onlineMode = (tab === 'online');
        if (tab === 'online') _loadPublicRooms();
    });
});

// Online mode tabs (host/join)
document.querySelectorAll('.online-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.online-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        els.hostPanel.classList.toggle('hidden', btn.dataset.mode !== 'host');
        els.joinPanel.classList.toggle('hidden', btn.dataset.mode !== 'join');
        if (btn.dataset.mode === 'join') _loadPublicRooms();
    });
});

// Online room create
els.createRoomBtn.addEventListener('click', async () => {
    const name   = els.onlineName.value.trim() || 'ホスト';
    const rName  = els.roomName.value.trim()   || `${name}のゲーム`;
    const pub    = els.roomPublic.checked;
    els.createRoomBtn.disabled = true;
    els.createRoomBtn.textContent = '作成中...';
    const { roomId, password } = await Network.createRoom(name, {}, { roomName: rName, isPublic: pub });
    els.createRoomBtn.disabled = false;
    els.createRoomBtn.textContent = 'ルームを作成する';
    els.roomIdDisplay.textContent   = roomId;
    els.roomPassDisplay.textContent = password;
    els.roomInfo.classList.remove('hidden');

    // ロビーチャット有効化
    _enableLobbyChat();

    Network.onRoomChange((event, players) => {
        renderRoomPlayerList();
        // per-player constraint も更新
        const mode = document.querySelector('[name=constraintMode]:checked').value;
        if (mode === 'individual') renderPerPlayerConstraints();
    });
    renderRoomPlayerList();
});
els.copyRoomId.addEventListener('click',   () => navigator.clipboard?.writeText(els.roomIdDisplay.textContent));
els.copyRoomPass.addEventListener('click', () => navigator.clipboard?.writeText(els.roomPassDisplay.textContent));

// Online join
els.joinRoomBtn.addEventListener('click', async () => {
    const roomId   = els.joinRoomId.value.trim().toUpperCase();
    const password = els.joinPassword.value.trim();
    const name     = els.onlineName.value.trim() || 'ゲスト';
    if (!roomId || !password) {
        els.joinStatus.textContent = '✗ ルームIDとパスワードを入力してください';
        els.joinStatus.style.color = 'var(--danger)';
        return;
    }
    els.joinStatus.textContent = '接続中...';
    els.joinStatus.style.color = 'var(--text-dim)';
    const res = await Network.joinRoom(roomId, password, name);
    if (res.ok) {
        els.joinStatus.textContent = `✓ 参加しました (${name}) — ホストがゲームを開始するまでお待ちください`;
        els.joinStatus.style.color = 'var(--success)';
        _enableLobbyChat();
        _startWatchingForGame();
    } else {
        els.joinStatus.textContent = `✗ ${res.why}`;
        els.joinStatus.style.color = 'var(--danger)';
    }
});

// 公開ルーム更新
els.refreshRoomsBtn.addEventListener('click', _loadPublicRooms);

// Constraint mode
document.querySelectorAll('[name=constraintMode]').forEach(radio => {
    radio.addEventListener('change', () => {
        const mode = document.querySelector('[name=constraintMode]:checked').value;
        els.globalConstraintPanel.classList.toggle('hidden', mode !== 'global');
        els.individualConstraintPanel.classList.toggle('hidden', mode !== 'individual');
        if (mode === 'individual') renderPerPlayerConstraints();
    });
});

els.botCount.addEventListener('change', () => {
    if (document.querySelector('[name=constraintMode]:checked').value === 'individual')
        renderPerPlayerConstraints();
});
els.playerName.addEventListener('input', () => {
    if (document.querySelector('[name=constraintMode]:checked').value === 'individual')
        renderPerPlayerConstraints();
});

// Zone direction
els.dirAB.addEventListener('click',   () => setDirection('AB'));
els.dirBA.addEventListener('click',   () => setDirection('BA'));
els.dirSwap.addEventListener('click', () => setDirection(zoneDirection === 'AB' ? 'BA' : 'AB'));

// Game chat
els.chatSend.addEventListener('click', sendGameChat);
els.chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendGameChat(); });

// Vote modal
els.voteZoneA.addEventListener('click', () => submitVote('A'));
els.voteZoneB.addEventListener('click', () => submitVote('B'));
els.voteChatSend.addEventListener('click', sendVoteChat);
els.voteChatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendVoteChat(); });

// Past logs
els.pastLogsBtn.addEventListener('click', showPastLogsModal);
els.closePastLogs.addEventListener('click', () => els.pastLogsModal.classList.add('hidden'));

/* ── Zone picker bindings ── */
function bindZonePicker() {
    if (_zonePickerBound) return;
    _zonePickerBound = true;
    els.pickZoneA.addEventListener('click',    () => doAddCardToZone('A'));
    els.pickZoneB.addEventListener('click',    () => doAddCardToZone('B'));
    els.cancelAddCard.addEventListener('click', () => els.zonePickerModal.classList.add('hidden'));
}

/* ═══════════════════════════════════════════════
   PUBLIC ROOMS
   ═══════════════════════════════════════════════ */
async function _loadPublicRooms() {
    els.publicRoomList.innerHTML = '<div class="pub-loading">読み込み中...</div>';
    const rooms = await Network.listPublicRooms();
    if (!rooms.length) {
        els.publicRoomList.innerHTML = '<div class="pub-empty">公開ルームはありません</div>';
        return;
    }
    els.publicRoomList.innerHTML = rooms.map(r => `
      <div class="pub-room-item" data-roomid="${r.roomId}">
        <div class="pub-room-name">${r.name}</div>
        <div class="pub-room-meta">
          <span class="pub-room-host">👑 ${r.hostName}</span>
          <span class="pub-room-count">👥 ${r.playerCount}/8</span>
        </div>
        <button class="btn btn-outline btn-sm pub-join-btn" data-roomid="${r.roomId}">参加</button>
      </div>`).join('');

    els.publicRoomList.querySelectorAll('.pub-join-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const roomId = btn.dataset.roomid;
            els.joinRoomId.value = roomId;
            els.joinRoomId.readOnly = true;
            els.joinRoomId.style.opacity = '0.6';
            // パスワード入力欄にフォーカス
            els.joinPassword.focus();
            // 「参加する」タブに切替
            document.querySelector('.online-mode-btn[data-mode="join"]').click();
        });
    });
}

/* ═══════════════════════════════════════════════
   LOBBY CHAT
   ═══════════════════════════════════════════════ */
function _enableLobbyChat() {
    els.lobbyChat.classList.remove('hidden');
    Network.onChat(msg => {
        appendLobbyChat(msg);
        // ゲーム開始後はゲームチャットにも反映
        if (!els.gameScreen.classList.contains('hidden')) appendGameChat(msg);
        // 投票モーダルが開いていれば投票チャットにも
        if (!els.cardVoteModal.classList.contains('hidden')) appendVoteChat(msg);
    });
}

function appendLobbyChat(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-sender">${msg.sender}:</span> ${escHtml(msg.text)}`;
    els.lobbyChatBox.appendChild(div);
    els.lobbyChatBox.scrollTop = els.lobbyChatBox.scrollHeight;
}

els.lobbyChatsend.addEventListener('click', () => {
    const t = els.lobbyChatInput.value.trim();
    if (!t) return;
    Network.sendChat(t);
    els.lobbyChatInput.value = '';
});
els.lobbyChatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') els.lobbyChatsend.click();
});

/* ═══════════════════════════════════════════════
   SETUP
   ═══════════════════════════════════════════════ */
function handleStart() {
    bindZonePicker();

    if (_onlineMode && Network.isOnline() && Network.isHost()) {
        _startOnlineGame();
        return;
    }

    const playerName = els.playerName.value.trim() || 'プレイヤー1';
    const botCount   = parseInt(els.botCount.value);
    const botDiff    = els.botDiff.value;

    const mode  = document.querySelector('[name=constraintMode]:checked').value;
    const rules = {};  // 4pts廃止

    if (mode === 'global') {
        const gc = document.querySelector('[name=globalC]:checked');
        rules.globalConstraint = gc ? gc.value : null;
    } else if (mode === 'individual') {
        rules.globalConstraint = null;
        rules.playerConstraints = {};
        document.querySelectorAll('.per-player-row').forEach(row => {
            const pid = row.dataset.pid;
            const sel = row.querySelector('[name^=pc_]:checked');
            rules.playerConstraints[pid] = sel ? sel.value : null;
        });
    } else {
        rules.globalConstraint = null;
        rules.playerConstraints = {};
    }

    clearCurrentLogs();
    Game.init({ playerName, botCount, botDiff, rules });

    els.setupScreen.classList.add('hidden');
    els.gameScreen.classList.remove('hidden');

    const st = Game.getState();
    els.neededTxt.textContent = st.needed;
    els.neededA.textContent   = st.needed;
    els.neededB.textContent   = st.needed;

    els.chatSection.classList.add('hidden');
    zoneDirection = 'AB';
    renderDirectionUI();
    renderRulesBadges();
    renderAll();
    els.funcInput.value = '';
    startBots();
    startInactivityTimer();
}

/* ── オンライン: ホストがゲームを開始 ── */
async function _startOnlineGame() {
    bindZonePicker();
    const room = Network.getRoom();

    const mode  = document.querySelector('[name=constraintMode]:checked').value;
    const rules = {};  // 4pts廃止
    if (mode === 'global') {
        const gc = document.querySelector('[name=globalC]:checked');
        rules.globalConstraint = gc ? gc.value : null;
    } else if (mode === 'individual') {
        rules.globalConstraint = null;
        rules.playerConstraints = {};
        document.querySelectorAll('.per-player-row').forEach(row => {
            const pid = row.dataset.pid;
            const sel = row.querySelector('[name^=pc_]:checked');
            rules.playerConstraints[pid] = sel ? sel.value : null;
        });
    } else {
        rules.globalConstraint = null;
        rules.playerConstraints = {};
    }

    const idMap = {};
    idMap['host'] = 'human';
    const onlinePlayers = room.players.map((player, i) => {
        const gameId = i === 0 ? 'human' : `bot${i - 1}`;
        idMap[player.id] = gameId;
        return { id: gameId, name: player.name, isBot: false };
    });
    room.idMap = idMap;

    clearCurrentLogs();
    Game.init({ playerName: room.players[0].name, botCount: 0, botDiff: 'medium', rules, onlinePlayers });
    await Network.markStarted(idMap);
    OnlineSync.start(true, null);

    // 投票リスナー（ホスト側で集計）
    Network.onCardVoteChange(voteData => _onCardVoteChange(voteData));

    els.setupScreen.classList.add('hidden');
    els.gameScreen.classList.remove('hidden');

    const st = Game.getState();
    els.neededTxt.textContent = st.needed;
    els.neededA.textContent   = st.needed;
    els.neededB.textContent   = st.needed;

    els.chatSection.classList.remove('hidden');

    zoneDirection = 'AB';
    renderDirectionUI();
    renderRulesBadges();
    renderAll();
    els.funcInput.value = '';
    startInactivityTimer();
}

/* ── クライアント: ホストのゲーム開始を待つ ── */
function _startWatchingForGame() {
    // 投票リスナー（クライアント側はUIのみ）
    Network.onCardVoteChange(voteData => _onCardVoteChange(voteData));

    OnlineSync.start(false, rawData => {
        const st = Game.getState();
        if (!st) return;
        const prevPhase = OnlineSync.getPrevPhase();

        if (!els.setupScreen.classList.contains('hidden')) {
            bindZonePicker();
            clearCurrentLogs();
            els.setupScreen.classList.add('hidden');
            els.gameScreen.classList.remove('hidden');
            els.neededTxt.textContent = st.needed;
            els.neededA.textContent   = st.needed;
            els.neededB.textContent   = st.needed;
            els.chatSection.classList.remove('hidden');
            zoneDirection = 'AB';
            renderDirectionUI();
            renderRulesBadges();
            startInactivityTimer();
        }

        renderAll();

        if (st.phase === 'roundEnd' && prevPhase !== 'roundEnd') {
            Bot.clearAll();
            addLog(`${st.players.find(p => p.id === st.lastWinner)?.name || '?'}: ${st.lastFormula}`, 'log-win');
            showModal();
        } else if (st.phase === 'gameOver' && prevPhase !== 'gameOver') {
            showGameOverModal();
        } else if (st.phase === 'playing' && prevPhase === 'roundEnd') {
            stopAutoAdvance(); destroyGraph();
            els.modal.classList.add('hidden');
            els.funcInput.value = '';
            els.botRow.innerHTML = '';
            renderDirectionUI();
            renderAll();
            resetInactivityTimer();
        }
    });
}

function handleMenu() {
    Bot.clearAll();
    stopAutoAdvance();
    destroyGraph();
    stopInactivityTimer();
    clearCurrentLogs();
    OnlineSync.reset();
    if (Network.isOnline()) Network.leaveRoom();
    els.gameScreen.classList.add('hidden');
    els.modal.classList.add('hidden');
    els.cardVoteModal.classList.add('hidden');
    els.setupScreen.classList.remove('hidden');
    // ロビーチャットを隠す
    els.lobbyChat.classList.add('hidden');
    els.lobbyChatBox.innerHTML = '';
    // 公開ルームIDのロック解除
    els.joinRoomId.readOnly = false;
    els.joinRoomId.style.opacity = '';
    els.joinRoomId.value = '';
    els.joinStatus.textContent = '';
    els.roomInfo.classList.add('hidden');
}

/* ── Per-player constraint UI ── */
function renderPerPlayerConstraints() {
    let players;

    // オンラインモードでルームがあればルームのプレイヤーを使用
    if (_onlineMode && Network.isOnline()) {
        const room = Network.getRoom();
        if (room && room.players && room.players.length > 0) {
            players = room.players.map((p, i) => ({
                id: i === 0 ? 'human' : `bot${i - 1}`,
                name: p.name
            }));
        }
    }

    // ローカルモードはUIの値を使用
    if (!players) {
        const playerName = els.playerName.value.trim() || 'プレイヤー1';
        const botCount   = parseInt(els.botCount.value);
        players = [{ id: 'human', name: playerName }];
        const botNames = ['α','β','γ'];
        for (let i = 0; i < botCount; i++)
            players.push({ id: `bot${i}`, name: `BOT-${botNames[i]}` });
    }

    const opts = [
        { val: 'none',    label: '縛りなし' },
        { val: 'integer', label: '整数係数縛り ★☆☆☆' },
        { val: 'origin',  label: '原点縛り ★★☆☆' },
        { val: 'even',    label: '偶関数縛り ★★★★' },
    ];

    els.perPlayerConstraints.innerHTML = players.map(p => `
      <div class="per-player-row" data-pid="${p.id}">
        <span class="per-player-name">${p.name}</span>
        <div class="per-player-opts">
          ${opts.map(o => `
            <label class="c-opt">
              <input type="radio" name="pc_${p.id}" value="${o.val}" ${o.val==='none'?'checked':''}>
              ${o.label}
            </label>`).join('')}
        </div>
      </div>`).join('');
    // 排他制限なし（削除）
}

function renderRoomPlayerList() {
    const room = Network.getRoom();
    if (!room) return;
    els.roomPlayerList.innerHTML = room.players.map(p =>
        `<div class="room-player">${p.isHost ? '👑 ' : ''}${p.name}</div>`).join('');
}

/* ═══════════════════════════════════════════════
   CARD SELECTION
   ═══════════════════════════════════════════════ */
function handleCardClick(zone, cardIdx) {
    if (Game.getState().phase !== 'playing') return;
    resetInactivityTimer();
    const result = Game.toggleSelect(zone, cardIdx);
    renderZones();
    renderSelStatus();
    renderSpecialPanel();
    updateDeclareBtn();

    const msgs = {
        revSelected:      () => setMsg(`反転カード: Zone ${zone} の中から対象カードをクリックしてください`, 'info'),
        revTargetSet:     () => setMsg('反転カードの対象を設定しました ✓'),
        revTargetInvalid: () => setMsg('このカードは対象にできません', 'err'),
        isRevTarget:      () => setMsg('このカードは反転カードの対象として使用中です', 'err'),
        nSelected:        () => setMsg('N カード: 下のパネルで数値を選んでください', 'info'),
        full:             () => setMsg(`Zone ${zone} はすでに ${Game.getState().needed} 枚選択中`, 'err'),
        invalid:          () => setMsg('カードが見つかりません', 'err'),
    };
    (msgs[result.action] || (() => {}))();
}

/* ═══════════════════════════════════════════════
   ADD CARD
   ═══════════════════════════════════════════════ */
function handleAddCard() {
    if (Game.getState().deck.length === 0) {
        setMsg('山札がなくなりました', 'err');
        if (Game.checkGameOver()) showGameOverModal();
        return;
    }

    resetInactivityTimer();

    // オンライン: 投票モーダルを表示
    if (Network.isOnline()) {
        Network.initiateAddCardVote();
        return;
    }

    // ローカル: 従来のゾーン選択
    const st = Game.getState();
    els.zoneACount.textContent = `現在 ${st.zoneA.length} 枚`;
    els.zoneBCount.textContent = `現在 ${st.zoneB.length} 枚`;
    els.zonePickerPreview.innerHTML = `
      <div class="zone-picker-card-back">
        <span style="font-size:22px;font-weight:700;color:#6a88a4;">?</span>
      </div>`;
    els.zonePickerModal.classList.remove('hidden');
}

function doAddCardToZone(zone) {
    els.zonePickerModal.classList.add('hidden');
    if (!Game.addCardToZone(zone)) {
        setMsg('山札がなくなりました', 'err');
        if (Game.checkGameOver()) { showGameOverModal(); return; }
        return;
    }
    const st = Game.getState();
    const addedCard = (zone === 'A' ? st.zoneA : st.zoneB).slice(-1)[0];
    const lbl = addedCard.type === 'special'
        ? (addedCard.value === 'N' ? 'ｎ' : '反転')
        : String(addedCard.value);
    if (Network.isOnline()) OnlineSync.broadcastAfterBotAction();
    renderAll();
    setMsg(`Zone ${zone} に「${lbl}」を追加しました`);
    Bot.clearAll();
    if (Game.checkGameOver()) { showGameOverModal(); return; }
    startBots();
    resetInactivityTimer();
}

/* ═══════════════════════════════════════════════
   CARD VOTE SYSTEM
   ═══════════════════════════════════════════════ */
let _myVotedZone = null;

function _onCardVoteChange(voteData) {
    if (!voteData) {
        // 投票が解消された（カード追加済み）
        els.cardVoteModal.classList.add('hidden');
        _myVotedZone = null;
        return;
    }

    // 投票モーダルを表示・更新
    showVoteModal(voteData);

    // ホストは全票が揃ったら集計
    if (Network.isHost()) {
        const room    = Network.getRoom();
        const players = (room?.players || []).filter(p => p.connected !== false);
        const votes   = voteData.votes || {};
        const entries = Object.values(votes);

        if (entries.length >= players.length && players.length > 0) {
            const zones = entries.map(v => v.zone || v);
            const allSame = zones.every(z => z === zones[0]);

            if (allSame) {
                const zone = zones[0];
                Network.clearCardVote();
                // カードを追加してブロードキャスト
                if (Game.addCardToZone(zone)) {
                    Network.broadcastState(Game.getState());
                    const st = Game.getState();
                    const addedCard = (zone === 'A' ? st.zoneA : st.zoneB).slice(-1)[0];
                    const lbl = addedCard?.type === 'special'
                        ? (addedCard.value === 'N' ? 'ｎ' : '反転')
                        : String(addedCard?.value ?? '?');
                    renderAll();
                    setMsg(`全員合意: Zone ${zone} に「${lbl}」を追加しました ✓`);
                    addLog(`カードを Zone ${zone} に追加`, 'log-info');
                    Bot.clearAll();
                    if (Game.checkGameOver()) showGameOverModal();
                    else startBots();
                    resetInactivityTimer();
                }
            }
            // 全員投票済みだが一致しない → 引き続き待機（プレイヤーは票を変更可）
        }
    }
}

function showVoteModal(voteData) {
    els.cardVoteModal.classList.remove('hidden');

    const room    = Network.getRoom();
    const players = room?.players || [];
    const votes   = voteData.votes || {};
    const myId    = Network.getMyId();

    // 投票状況を表示
    const votedA = Object.entries(votes).filter(([,v]) => (v.zone||v) === 'A').map(([,v]) => v.name || '?');
    const votedB = Object.entries(votes).filter(([,v]) => (v.zone||v) === 'B').map(([,v]) => v.name || '?');
    const votedCount = Object.keys(votes).length;
    const totalCount = players.length;

    els.voteStatus.innerHTML = `
      <div class="vote-info">${voteData.initiatedByName || '?'} がカード追加をリクエスト</div>
      <div class="vote-progress">${votedCount} / ${totalCount} 人が投票済み</div>
      <div class="vote-tally">
        <div class="vote-tally-item">
          <span class="vote-zone-label">Zone A</span>
          <span class="vote-names">${votedA.join(', ') || '—'}</span>
          <span class="vote-count-badge">${votedA.length}</span>
        </div>
        <div class="vote-tally-item">
          <span class="vote-zone-label">Zone B</span>
          <span class="vote-names">${votedB.join(', ') || '—'}</span>
          <span class="vote-count-badge">${votedB.length}</span>
        </div>
      </div>
      ${votedCount >= totalCount && votedA.length !== votedB.length
          ? '<div class="vote-hint-mismatch">意見が割れています。票を変更できます。</div>'
          : '<div class="vote-hint">全員が同じゾーンに投票すると追加されます</div>'}
    `;

    // 自分が投票済みならボタンを強調
    const myVote = votes[myId];
    const myZone = myVote ? (myVote.zone || myVote) : null;
    els.voteZoneA.classList.toggle('vote-selected', myZone === 'A');
    els.voteZoneB.classList.toggle('vote-selected', myZone === 'B');
}

function submitVote(zone) {
    _myVotedZone = zone;
    Network.submitCardVote(zone);
    els.voteZoneA.classList.toggle('vote-selected', zone === 'A');
    els.voteZoneB.classList.toggle('vote-selected', zone === 'B');
}

function sendVoteChat() {
    const t = els.voteChatInput.value.trim();
    if (!t) return;
    Network.sendChat(t);
    els.voteChatInput.value = '';
}

function appendVoteChat(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-sender">${msg.sender}:</span> ${escHtml(msg.text)}`;
    els.voteChatBox.appendChild(div);
    els.voteChatBox.scrollTop = els.voteChatBox.scrollHeight;
}

/* ═══════════════════════════════════════════════
   DECLARE
   ═══════════════════════════════════════════════ */
function handleDeclare() {
    const formula = els.funcInput.value.trim();
    if (!formula) { setMsg('関数式を入力してください', 'err'); return; }

    resetInactivityTimer();

    if (Network.isOnline() && !Network.isHost()) {
        const st = Game.getState();
        OnlineSync.sendAction({
            type:    'declare',
            payload: {
                formula,
                direction:  zoneDirection,
                selA:       [...st.selA],
                selB:       [...st.selB],
                nValues:    { ...st.nValues },
                revTargets: { ...st.revTargets },
            },
        });
        setMsg('宣言を送信しました…ホストが検証中', 'info');
        return;
    }

    const myId   = Network.isOnline() ? (Network.getMyGameId() || 'human') : 'human';
    const result = Game.declare(myId, formula, zoneDirection);
    if (result.ok) {
        Bot.clearAll();
        const pName = Game.getState().players.find(p => p.id === myId)?.name || myId;
        addLog(`${pName}: ${formula}`, 'log-win');
        if (Network.isOnline()) OnlineSync.broadcastAfterBotAction();
        showModal();
        stopInactivityTimer();
    } else {
        setMsg(result.why, 'err');
        addLog(`誤宣言: ${formula}`, 'log-err');
        renderScoreboard();
        updateDeclareBtn();
    }
}

/* ═══════════════════════════════════════════════
   DIRECTION UI
   ═══════════════════════════════════════════════ */
function setDirection(dir) {
    zoneDirection = dir;
    renderDirectionUI();
    resetInactivityTimer();
}

function renderDirectionUI() {
    els.dirAB.classList.toggle('active', zoneDirection === 'AB');
    els.dirBA.classList.toggle('active', zoneDirection === 'BA');
    if (zoneDirection === 'AB') {
        els.zoneHintA.textContent = 'x 値 (x軸)';
        els.zoneHintB.textContent = 'y 値 (y軸)';
    } else {
        els.zoneHintA.textContent = 'y 値 (y軸)';
        els.zoneHintB.textContent = 'x 値 (x軸)';
    }
}

/* ═══════════════════════════════════════════════
   NEXT ROUND / GAME OVER
   ═══════════════════════════════════════════════ */
function handleNextRound() {
    stopAutoAdvance();
    destroyGraph();

    if (Network.isOnline() && !Network.isHost()) {
        OnlineSync.sendAction({ type: 'nextRound', payload: {} });
        return;
    }

    Game.nextRound();
    if (Network.isOnline()) OnlineSync.broadcastAfterBotAction();
    const st = Game.getState();
    if (st.phase === 'gameOver') { els.modal.classList.add('hidden'); showGameOverModal(); return; }
    els.modal.classList.add('hidden');
    els.funcInput.value = '';
    els.botRow.innerHTML = '';
    zoneDirection = 'AB';
    renderDirectionUI();
    renderAll();
    if (Game.checkGameOver()) { showGameOverModal(); return; }
    startBots();
    resetInactivityTimer();
}

/* ═══════════════════════════════════════════════
   BOT
   ═══════════════════════════════════════════════ */
function startBots() {
    if (Network.isOnline()) return;

    Bot.scheduleBots((botId, formula) => {
        const st  = Game.getState();
        const bot = st.players.find(p => p.id === botId);
        if (!bot) return;
        addLog(`${bot.name}: ${formula}`, 'log-win');
        els.botRow.innerHTML = '';
        showModal();
        stopInactivityTimer();
    });

    const st   = Game.getState();
    const bots = st.players.filter(p => p.isBot);
    if (bots.length > 0 && st.phase === 'playing') {
        els.botRow.innerHTML = `
          <span>${bots.map(b=>b.name).join(', ')} が考えています</span>
          <span class="thinking-dots">
            <span class="td"></span><span class="td"></span><span class="td"></span>
          </span>`;
    }
}

/* ═══════════════════════════════════════════════
   30秒 不活動ヒント
   ═══════════════════════════════════════════════ */
function startInactivityTimer() {
    stopInactivityTimer();
    _inactivityTimer = setTimeout(_checkInactivity, INACTIVITY_SECS * 1000);
}

function resetInactivityTimer() {
    hideInactivityHint();
    clearTimeout(_inactivityTimer);
    const st = Game.getState();
    if (!st || st.phase !== 'playing') return;
    _inactivityTimer = setTimeout(_checkInactivity, INACTIVITY_SECS * 1000);
}

function stopInactivityTimer() {
    clearTimeout(_inactivityTimer);
    _inactivityTimer = null;
    hideInactivityHint();
}

function _checkInactivity() {
    const st = Game.getState();
    if (!st || st.phase !== 'playing') return;

    const myId    = Network.isOnline() ? (Network.getMyGameId() || 'human') : 'human';
    const solution = Game.botFindSolution(myId);

    if (solution) {
        showInactivityHint('💡 現在の盤面に解が存在します（宣言できます）');
    } else {
        showInactivityHint('🃏 現在の盤面に解が見つかりません。カードを追加してみましょう');
    }
}

function showInactivityHint(text) {
    els.inactivityHint.textContent = text;
    els.inactivityHint.classList.remove('hidden');
}

function hideInactivityHint() {
    els.inactivityHint.classList.add('hidden');
}

/* ═══════════════════════════════════════════════
   LOG 管理
   ═══════════════════════════════════════════════ */
function addLog(text, cls = 'log-info') {
    const entry = { text, cls, time: new Date().toLocaleTimeString() };
    _currentLogs.unshift(entry);
    const div = document.createElement('div');
    div.className = `log-entry ${cls}`;
    div.textContent = `[${entry.time}] ${text}`;
    els.logBox.prepend(div);
    while (els.logBox.children.length > 50) els.logBox.removeChild(els.logBox.lastChild);
}

function clearCurrentLogs() {
    if (_currentLogs.length > 0) {
        _pastLogs.push({ timestamp: new Date().toLocaleString(), entries: [..._currentLogs] });
        if (_pastLogs.length > 10) _pastLogs.shift(); // 最大10試合分
    }
    _currentLogs = [];
    els.logBox.innerHTML = '';
}

function showPastLogsModal() {
    if (_pastLogs.length === 0) {
        els.pastLogsBox.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">過去のログはありません</div>';
    } else {
        els.pastLogsBox.innerHTML = _pastLogs.slice().reverse().map((game, gi) => `
          <div class="past-game-block">
            <div class="past-game-title">試合 ${_pastLogs.length - gi} — ${game.timestamp}</div>
            ${game.entries.map(e => `
              <div class="log-entry ${e.cls}">[${e.time}] ${e.text}</div>`).join('')}
          </div>`).join('');
    }
    els.pastLogsModal.classList.remove('hidden');
}

/* ═══════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════ */
function renderAll() {
    renderZones();
    renderScoreboard();
    renderSelStatus();
    renderSpecialPanel();
    updateDeclareBtn();
    const st = Game.getState();
    els.roundNum.textContent = st.round;
    els.deckNum.textContent  = st.deck.length;
    els.addCardBtn.disabled  = st.deck.length === 0;
}

function renderZones() {
    const st = Game.getState();
    renderZone('A', st.zoneA, st.selA);
    renderZone('B', st.zoneB, st.selB);
    els.deckNum.textContent = st.deck.length;
    renderPairLegend(st.selA, st.selB, st.needed);
}

function renderZone(zone, cards, sel) {
    const el      = zone === 'A' ? els.zoneAEl : els.zoneBEl;
    const panel   = zone === 'A' ? els.zonePanelA : els.zonePanelB;
    const st      = Game.getState();
    const pending = st.revPending;
    el.innerHTML  = '';

    const waitForTarget = pending && pending.zone === zone;
    panel.classList.toggle('rev-pending', waitForTarget);

    cards.forEach((card, cardIdx) => {
        const pairIdx  = sel.indexOf(cardIdx);
        const isRevTgt = Object.entries(st.revTargets).some(([k,ti]) => k.startsWith(zone+'_') && ti===cardIdx);

        const div = document.createElement('div');
        let cls = 'card new-card';
        if (card.type === 'special') cls += ' special';
        else if (card.value < 0)     cls += ' neg';
        else if (card.value === 0)   cls += ' zero';
        if (pairIdx !== -1)  cls += ` ${PAIR_COLORS[pairIdx]}`;
        if (isRevTgt)        cls += ' rev-target';
        if (waitForTarget && pairIdx === -1 && card.type !== 'special') cls += ' rev-eligible';
        div.className = cls;

        const face = document.createElement('span');
        if (card.type === 'special' && card.value === 'N') {
            const av = st.nValues[`${zone}_${cardIdx}`];
            face.textContent = av !== undefined ? `N=${av}` : 'ｎ';
            if (av === undefined && pairIdx !== -1) div.classList.add('n-unset');
        } else if (card.type === 'special' && card.value === 'REV') {
            face.textContent = '反転';
            const tgt = st.revTargets[`${zone}_${cardIdx}`];
            if (tgt === undefined && pairIdx !== -1) div.classList.add('rev-unset');
        } else {
            face.textContent = card.value;
        }
        div.appendChild(face);

        if (isRevTgt) {
            const t = document.createElement('span');
            t.className = 'rev-target-tag';
            t.textContent = '⟵';
            div.appendChild(t);
        }
        if (pairIdx !== -1) {
            const dot = document.createElement('span');
            dot.className = `pair-dot dot-${pairIdx}`;
            div.appendChild(dot);
        }

        div.addEventListener('click', () => handleCardClick(zone, cardIdx));
        el.appendChild(div);
    });
}

function renderSpecialPanel() {
    const st = Game.getState();
    const items = [];
    for (const zone of ['A','B']) {
        const cards = zone === 'A' ? st.zoneA : st.zoneB;
        const sel   = zone === 'A' ? st.selA  : st.selB;
        sel.forEach((cardIdx, pairPos) => {
            if (cardIdx === null) return;
            const card = cards[cardIdx];
            if (!card || card.type !== 'special' || card.value !== 'N') return;
            items.push({ zone, cardIdx, pairPos, current: st.nValues[`${zone}_${cardIdx}`] });
        });
    }

    if (!items.length) {
        els.specialPanel.innerHTML = '';
        els.specialPanel.classList.add('hidden');
        return;
    }
    els.specialPanel.classList.remove('hidden');
    els.specialPanel.innerHTML = items.map(({ zone, cardIdx, pairPos, current }) => `
      <div class="n-picker-row">
        <span class="n-picker-label">
          <span class="legend-swatch" style="background:${PAIR_HEX[pairPos]}"></span>
          Zone ${zone} ｎの値:
        </span>
        <div class="n-picker-btns" data-zone="${zone}" data-idx="${cardIdx}">
          ${Array.from({length:19},(_,i)=>i-9).map(v =>
            `<button class="n-val-btn${current===v?' active':''}" data-val="${v}">${v}</button>`
          ).join('')}
        </div>
      </div>`).join('');

    els.specialPanel.querySelectorAll('.n-picker-btns').forEach(row => {
        const zone = row.dataset.zone, idx = parseInt(row.dataset.idx);
        row.querySelectorAll('.n-val-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                Game.setNValue(zone, idx, parseInt(btn.dataset.val));
                renderZones();
                renderSpecialPanel();
                updateDeclareBtn();
                resetInactivityTimer();
            });
        });
    });
}

function renderPairLegend(selA, selB, needed) {
    const active = [];
    for (let i = 0; i < needed; i++) if (selA[i]!==null||selB[i]!==null) active.push(i);
    if (!active.length) { els.pairLegend.innerHTML=''; return; }
    els.pairLegend.innerHTML = '<span class="legend-label">ペア対応:</span>' +
        active.map(pi => `<span class="legend-item">
          <span class="legend-swatch" style="background:${PAIR_HEX[pi]}"></span>${PAIR_LABELS[pi]}
        </span>`).join('');
}

function renderSelStatus() {
    const st = Game.getState();
    els.cntA.textContent = st.selA.filter(v=>v!==null).length;
    els.cntB.textContent = st.selB.filter(v=>v!==null).length;
}

function renderScoreboard() {
    const st    = Game.getState();
    const myId  = Network.isOnline() ? ((Network.getMyGameId?.() ?? null) || 'human') : 'human';
    els.scoreboard.innerHTML = st.players.map(p => `
      <div class="score-item ${p.id === myId ? 'me' : ''} ${st.penalized.has(p.id) ? 'penalized' : ''}">
        <div>
          <div class="score-name">${p.name}${p.id === myId ? ' 👤' : ''}</div>
          <span class="penalty-tag">${st.penalized.has(p.id) ? 'ペナルティ中' : ''}</span>
          ${renderConstraintBadge(p.id)}
        </div>
        <div class="score-pt">${p.score}</div>
      </div>`).join('');
}

function renderConstraintBadge(playerId) {
    if (typeof Game.getPlayerConstraint !== 'function') return '';
    const c = Game.getPlayerConstraint(playerId);
    if (!c) return '';
    return `<span class="player-constraint-tag">${CONSTRAINT_LABELS[c]||''}</span>`;
}

function renderRulesBadges() {
    const st = Game.getState();
    const r  = st.rules;
    const badges = [];
    if (r.globalConstraint) badges.push(CONSTRAINT_LABELS[r.globalConstraint] || r.globalConstraint);
    if (r.playerConstraints) {
        Object.entries(r.playerConstraints).forEach(([pid, c]) => {
            if (c) {
                const p = st.players.find(pl => pl.id === pid);
                badges.push(`${p?.name||pid}: ${CONSTRAINT_LABELS[c]||c}`);
            }
        });
    }
    els.rulesBadges.innerHTML = badges.map(b => `<span class="rule-badge">${b}</span>`).join('');
}

function updateDeclareBtn() {
    const st   = Game.getState();
    const myId = Network.isOnline() ? (Network.getMyGameId() || 'human') : 'human';
    const selAFull = st.selA.every(v => v !== null);
    const selBFull = st.selB.every(v => v !== null);
    const nReady   = ['A', 'B'].every(zone =>
        (zone === 'A' ? st.selA : st.selB).every(i => i === null || Game.effectiveValue(zone, i) !== null));
    els.declareBtn.disabled = !(selAFull && selBFull && !st.penalized.has(myId)
                                && !st.revPending && nReady && st.phase === 'playing');
}

/* ═══════════════════════════════════════════════
   MODAL — ROUND END
   ═══════════════════════════════════════════════ */
function showModal() {
    const st     = Game.getState();
    const winner = st.players.find(p => p.id === st.lastWinner);
    const dir    = st.lastDirection;

    els.modalTitle.textContent  = '発見！';
    els.modalWinner.textContent = `${winner.name} が関数を発見しました`;
    els.modalFn.textContent     = st.lastFormula || '';

    els.modalPts.innerHTML = (st.lastPoints||[]).map((p,i) => `
      <div class="modal-pt">
        <span class="pt-pair-dot" style="background:${PAIR_HEX[i%4]}"></span>(${p.x}, ${p.y})
      </div>`).join('');

    els.modalScores.innerHTML = [...st.players]
        .sort((a,b) => b.score-a.score)
        .map(p => `
          <div class="modal-score-row ${p.id===st.lastWinner?'winner-row':''}">
            <span>${p.name}${p.id===st.lastWinner?' 🏆':''}</span>
            <span>${p.score} 点</span>
          </div>`).join('');

    els.nextRoundBtn.textContent = '次のラウンドへ →';
    els.nextRoundBtn.onclick     = handleNextRound;
    els.modal.classList.remove('hidden');
    renderScoreboard();

    if (st.lastFormula && st.lastPoints?.length > 0) {
        els.graphContainer.classList.remove('hidden');
        setupInteractiveGraph(els.fnGraph, st.lastFormula, st.lastPoints);
    } else {
        els.graphContainer.classList.add('hidden');
    }

    startAutoAdvance();
}

/* ═══════════════════════════════════════════════
   MODAL — GAME OVER
   ═══════════════════════════════════════════════ */
function showGameOverModal() {
    stopAutoAdvance();
    destroyGraph();
    stopInactivityTimer();
    const st = Game.getState();
    els.modalTitle.textContent  = 'ゲーム終了';
    els.modalWinner.textContent = st.gameOverReason || 'ゲームが終了しました';
    els.modalFn.textContent     = '';
    els.modalPts.innerHTML      = '';
    els.graphContainer.classList.add('hidden');
    els.countdownRow.style.display = 'none';

    els.modalScores.innerHTML = [...st.players]
        .sort((a,b) => b.score-a.score)
        .map((p,i) => `
          <div class="modal-score-row ${i===0?'winner-row':''}">
            <span>${i===0?'🏆 ':''}${p.name}</span>
            <span>${p.score} 点</span>
          </div>`).join('');

    els.nextRoundBtn.textContent = 'タイトルへ戻る';
    els.nextRoundBtn.onclick     = handleMenu;
    els.modal.classList.remove('hidden');
}

/* ═══════════════════════════════════════════════
   AUTO-ADVANCE COUNTDOWN
   ═══════════════════════════════════════════════ */
function startAutoAdvance() {
    stopAutoAdvance();
    autoAdvRemain = AUTO_ADVANCE_SECS;
    els.countdownRow.style.display = 'flex';
    updateCountdown();
    autoAdvTimer = setInterval(() => {
        autoAdvRemain--;
        updateCountdown();
        if (autoAdvRemain <= 0) { stopAutoAdvance(); handleNextRound(); }
    }, 1000);
}

function stopAutoAdvance() {
    if (autoAdvTimer) { clearInterval(autoAdvTimer); autoAdvTimer = null; }
    els.countdownRow.style.display = 'none';
}

function updateCountdown() {
    els.countdownNum.textContent = autoAdvRemain;
    els.countdownBar.style.width = ((autoAdvRemain / AUTO_ADVANCE_SECS) * 100) + '%';
}

/* ═══════════════════════════════════════════════
   INTERACTIVE GRAPH
   ═══════════════════════════════════════════════ */
function destroyGraph() {
    graphListeners.forEach(fn => fn());
    graphListeners = [];
}

function setupInteractiveGraph(canvas, formulaStr, points) {
    destroyGraph();
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    let xMin = Math.min(...xs) - 3, xMax = Math.max(...xs) + 3;
    let yMin = Math.min(...ys), yMax = Math.max(...ys);

    const fn = Game.parseFormula(formulaStr);
    if (!fn) { els.graphContainer.classList.add('hidden'); return; }

    const SAMPLE = 200, dx = (xMax-xMin)/SAMPLE;
    for (let s=0; s<=SAMPLE; s++) {
        try { const y=fn(xMin+s*dx); if (isFinite(y)){yMin=Math.min(yMin,y);yMax=Math.max(yMax,y);} } catch {}
    }
    const yPad = Math.max((yMax-yMin)*0.25, 2);
    yMin-=yPad; yMax+=yPad;
    if (xMin===xMax){xMin-=2;xMax+=2;} if (yMin===yMax){yMin-=2;yMax+=2;}

    let offsetX=0, offsetY=0, zoom=1;

    function toCanvas(gx, gy) {
        const W=canvas.width, H=canvas.height;
        const rangeX=(xMax-xMin)/zoom, rangeY=(yMax-yMin)/zoom;
        const ctrGX=(xMin+xMax)/2-offsetX/W*rangeX, ctrGY=(yMin+yMax)/2+offsetY/H*rangeY;
        return { cx:(gx-(ctrGX-rangeX/2))/rangeX*W, cy:H-(gy-(ctrGY-rangeY/2))/rangeY*H };
    }

    function draw() {
        const W=canvas.width, H=canvas.height;
        const ctx=canvas.getContext('2d');
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle='#0a1724'; ctx.fillRect(0,0,W,H);

        const rangeX=(xMax-xMin)/zoom, rangeY=(yMax-yMin)/zoom;
        const ctrGX=(xMin+xMax)/2-offsetX/W*rangeX, ctrGY=(yMin+yMax)/2+offsetY/H*rangeY;
        const vxMin=ctrGX-rangeX/2, vxMax=ctrGX+rangeX/2;
        const vyMin=ctrGY-rangeY/2, vyMax=ctrGY+rangeY/2;

        const rawStep=rangeX/8, step=Math.pow(10,Math.floor(Math.log10(rawStep)));
        const niceStep=rawStep/step<2?step:rawStep/step<5?2*step:5*step;

        ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1;
        for (let gx=Math.ceil(vxMin/niceStep)*niceStep; gx<=vxMax; gx+=niceStep) {
            const {cx}=toCanvas(gx,0); ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke();
        }
        for (let gy=Math.ceil(vyMin/niceStep)*niceStep; gy<=vyMax; gy+=niceStep) {
            const {cy}=toCanvas(0,gy); ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(W,cy); ctx.stroke();
        }

        ctx.strokeStyle='rgba(255,255,255,0.28)'; ctx.lineWidth=1.5;
        const {cx:ox,cy:oy}=toCanvas(0,0);
        if (ox>=0&&ox<=W){ctx.beginPath();ctx.moveTo(ox,0);ctx.lineTo(ox,H);ctx.stroke();}
        if (oy>=0&&oy<=H){ctx.beginPath();ctx.moveTo(0,oy);ctx.lineTo(W,oy);ctx.stroke();}

        ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='9px Inter,sans-serif';
        for (let gx=Math.ceil(vxMin/niceStep)*niceStep; gx<=vxMax; gx+=niceStep) {
            if (Math.abs(gx)<1e-9) continue;
            const {cx}=toCanvas(gx,0), ly=Math.min(Math.max(oy+11,10),H-4);
            ctx.textAlign='center'; ctx.fillText(gx%1===0?gx:gx.toFixed(1),cx,ly);
        }
        ctx.textAlign='right';
        for (let gy=Math.ceil(vyMin/niceStep)*niceStep; gy<=vyMax; gy+=niceStep) {
            if (Math.abs(gy)<1e-9) continue;
            const {cy}=toCanvas(0,gy), lx=Math.min(Math.max(ox-4,22),W-2);
            ctx.fillText(gy%1===0?gy:gy.toFixed(1),lx,cy+3);
        }

        ctx.strokeStyle='#3a8fe8'; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.beginPath();
        let penDown=false, lastY=null;
        for (let s=0; s<=500; s++) {
            const gx=vxMin+s*(rangeX/500);
            let gy; try{gy=fn(gx);}catch{penDown=false;lastY=null;continue;}
            if (!isFinite(gy)||Math.abs(gy)>rangeY*10+100){penDown=false;lastY=null;continue;}
            if (lastY!==null&&Math.abs(gy-lastY)>rangeY*4){penDown=false;}
            lastY=gy;
            const {cx,cy}=toCanvas(gx,gy);
            if (!penDown){ctx.moveTo(cx,cy);penDown=true;}else{ctx.lineTo(cx,cy);}
        }
        ctx.stroke();

        const PCOLS=['#e8a030','#2cb87a','#8c6fe8','#e85a5a'];
        points.forEach((p,i) => {
            const {cx,cy}=toCanvas(p.x,p.y), col=PCOLS[i%4];
            ctx.save(); ctx.shadowBlur=16; ctx.shadowColor=col;
            ctx.beginPath(); ctx.arc(cx,cy,8,0,Math.PI*2);
            ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
            ctx.shadowBlur=0; ctx.restore();
            ctx.fillStyle='#fff'; ctx.font='bold 11px Inter,sans-serif'; ctx.textAlign='left';
            ctx.strokeStyle='#0a1724'; ctx.lineWidth=3; ctx.lineJoin='round';
            ctx.strokeText(`(${p.x}, ${p.y})`,cx+11,cy-7);
            ctx.fillText(`(${p.x}, ${p.y})`,cx+11,cy-7);
        });
    }

    let drag=null;
    const onMouseDown = e => { drag={x:e.clientX,y:e.clientY}; canvas.style.cursor='grabbing'; };
    const onMouseMove = e => {
        if (!drag) return;
        const rect=canvas.getBoundingClientRect();
        offsetX+=(e.clientX-drag.x)*(canvas.width/rect.width);
        offsetY+=(e.clientY-drag.y)*(canvas.height/rect.height);
        drag={x:e.clientX,y:e.clientY}; draw();
    };
    const onMouseUp  = () => { drag=null; canvas.style.cursor='grab'; };
    const onWheel    = e => { e.preventDefault(); zoom=Math.max(0.15,Math.min(20,zoom*(e.deltaY<0?1.15:0.87))); draw(); };
    let lastTouch=null;
    const onTouchStart = e => { if (e.touches.length===1) lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY}; };
    const onTouchMove  = e => {
        e.preventDefault();
        if (e.touches.length===1&&lastTouch) {
            const rect=canvas.getBoundingClientRect();
            offsetX+=(e.touches[0].clientX-lastTouch.x)*(canvas.width/rect.width);
            offsetY+=(e.touches[0].clientY-lastTouch.y)*(canvas.height/rect.height);
            lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY}; draw();
        }
    };
    const onTouchEnd = () => { lastTouch=null; };

    canvas.style.cursor='grab';
    canvas.addEventListener('mousedown',onMouseDown);
    window.addEventListener('mousemove',onMouseMove);
    window.addEventListener('mouseup',onMouseUp);
    canvas.addEventListener('wheel',onWheel,{passive:false});
    canvas.addEventListener('touchstart',onTouchStart,{passive:true});
    canvas.addEventListener('touchmove',onTouchMove,{passive:false});
    canvas.addEventListener('touchend',onTouchEnd,{passive:true});

    graphListeners=[
        ()=>canvas.removeEventListener('mousedown',onMouseDown),
        ()=>window.removeEventListener('mousemove',onMouseMove),
        ()=>window.removeEventListener('mouseup',onMouseUp),
        ()=>canvas.removeEventListener('wheel',onWheel),
        ()=>canvas.removeEventListener('touchstart',onTouchStart),
        ()=>canvas.removeEventListener('touchmove',onTouchMove),
        ()=>canvas.removeEventListener('touchend',onTouchEnd),
    ];
    draw();
}

/* ═══════════════════════════════════════════════
   CHAT (ゲーム中)
   ═══════════════════════════════════════════════ */
function sendGameChat() {
    const text = els.chatInput.value.trim();
    if (!text) return;
    Network.sendChat(text);
    els.chatInput.value = '';
}

function appendGameChat(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-sender">${msg.sender}:</span> ${escHtml(msg.text)}`;
    els.chatBox.appendChild(div);
    els.chatBox.scrollTop = els.chatBox.scrollHeight;
}

/* ═══════════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════════ */
function setMsg(text, type='') {
    els.msgBar.className = 'msg-bar' + (type ? ` ${type}` : '');
    els.msgBar.innerHTML = text;
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
