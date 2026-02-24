/**
 * ui.js — Polynomial UI v3
 *
 * New features:
 *  1. Interactive graph: pan/zoom, correct point rendering, auto-advance countdown
 *  2. Per-player constraint setup UI (dynamic, mutual exclusion)
 *  3. Zone direction toggle (A→x/B→y  ↔  B→x/A→y)
 *  4. Online room create/join UI + chat panel
 *  5. Bot callback phase-check fix (no longer checks phase after botApplyAndDeclare)
 */

/* ── Constants ────────────────────────────────── */
const PAIR_COLORS = ['pair-0','pair-1','pair-2','pair-3'];
const PAIR_LABELS = ['ペア①','ペア②','ペア③','ペア④'];
const PAIR_HEX    = ['var(--p0)','var(--p1)','var(--p2)','var(--p3)'];
const CONSTRAINT_LABELS = { integer:'整数係数縛り', origin:'原点縛り', even:'偶関数縛り' };
const AUTO_ADVANCE_SECS = 8;

/* ── State ────────────────────────────────────── */
let zoneDirection   = 'AB';   // 'AB' | 'BA'
let autoAdvTimer    = null;
let autoAdvRemain   = 0;
let graphListeners  = [];     // cleanup fns for interactive graph
let _zonePickerBound = false;
let _onlineMode      = false;

/* ── Element refs ─────────────────────────────── */
const $ = id => document.getElementById(id);

const els = {
    setupScreen:$('setupScreen'), gameScreen:$('gameScreen'),
    playerName:$('playerName'), botCount:$('botCount'), botDiff:$('botDiff'),
    r4pts:$('r4pts'),
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
    createRoomBtn:$('createRoomBtn'), roomInfo:$('roomInfo'),
    roomIdDisplay:$('roomIdDisplay'), roomPassDisplay:$('roomPassDisplay'),
    copyRoomId:$('copyRoomId'), copyRoomPass:$('copyRoomPass'),
    roomPlayerList:$('roomPlayerList'),
    joinRoomId:$('joinRoomId'), joinPassword:$('joinPassword'),
    joinRoomBtn:$('joinRoomBtn'), joinStatus:$('joinStatus'),
    hostPanel:$('hostPanel'), joinPanel:$('joinPanel'),
    globalConstraintPanel:$('globalConstraintPanel'),
    individualConstraintPanel:$('individualConstraintPanel'),
    perPlayerConstraints:$('perPlayerConstraints'),
    chatSection:$('chatSection'), chatBox:$('chatBox'),
    chatInput:$('chatInput'), chatSend:$('chatSend'),
};

/* ── Core event bindings ─────────────────────── */
els.startBtn.addEventListener('click', handleStart);
els.menuBtn.addEventListener('click', handleMenu);
els.addCardBtn.addEventListener('click', handleAddCard);
els.declareBtn.addEventListener('click', handleDeclare);
els.funcInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleDeclare(); });
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
    });
});

// Online mode tabs
document.querySelectorAll('.online-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.online-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        els.hostPanel.classList.toggle('hidden', btn.dataset.mode !== 'host');
        els.joinPanel.classList.toggle('hidden', btn.dataset.mode !== 'join');
    });
});

// Online room create
els.createRoomBtn.addEventListener('click', async () => {
    const name = els.onlineName.value.trim() || 'ホスト';
    const { roomId, password } = await Network.createRoom(name, {});
    els.roomIdDisplay.textContent   = roomId;
    els.roomPassDisplay.textContent = password;
    els.roomInfo.classList.remove('hidden');
    Network.onRoomChange((event, player) => {
        renderRoomPlayerList();
        addLog(`${player.name} が${event === 'join' ? '参加' : '退出'}しました`, 'log-info');
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
    els.joinStatus.textContent = '接続中...';
    const res = await Network.joinRoom(roomId, password, name);
    if (res.ok) {
        els.joinStatus.textContent = `✓ 参加しました (${name}) — ホストがゲームを開始するまでお待ちください`;
        els.joinStatus.style.color = 'var(--success)';
        // ホストがゲームを開始するのを待ち、状態が届いたら自動でゲーム画面へ
        _startWatchingForGame();
    } else {
        els.joinStatus.textContent = `✗ ${res.why}`;
        els.joinStatus.style.color = 'var(--danger)';
    }
});

// Constraint mode
document.querySelectorAll('[name=constraintMode]').forEach(radio => {
    radio.addEventListener('change', () => {
        const mode = document.querySelector('[name=constraintMode]:checked').value;
        els.globalConstraintPanel.classList.toggle('hidden', mode !== 'global');
        els.individualConstraintPanel.classList.toggle('hidden', mode !== 'individual');
        if (mode === 'individual') renderPerPlayerConstraints();
    });
});

// Update per-player constraints when bot count changes
els.botCount.addEventListener('change', () => {
    const mode = document.querySelector('[name=constraintMode]:checked').value;
    if (mode === 'individual') renderPerPlayerConstraints();
});
els.playerName.addEventListener('input', () => {
    const mode = document.querySelector('[name=constraintMode]:checked').value;
    if (mode === 'individual') renderPerPlayerConstraints();
});

// Zone direction
els.dirAB.addEventListener('click',  () => setDirection('AB'));
els.dirBA.addEventListener('click',  () => setDirection('BA'));
els.dirSwap.addEventListener('click',() => setDirection(zoneDirection === 'AB' ? 'BA' : 'AB'));

// Chat
els.chatSend.addEventListener('click', sendChat);
els.chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

/* ── Zone picker bindings ───────────────────── */
function bindZonePicker() {
    if (_zonePickerBound) return;
    _zonePickerBound = true;
    els.pickZoneA.addEventListener('click',   () => doAddCardToZone('A'));
    els.pickZoneB.addEventListener('click',   () => doAddCardToZone('B'));
    els.cancelAddCard.addEventListener('click',() => els.zonePickerModal.classList.add('hidden'));
}

/* ═══════════════════════════════════════════════
   SETUP
   ═══════════════════════════════════════════════ */
function handleStart() {
    bindZonePicker();

    // ── オンライン・ホスト処理 ───────────────────────────────
    if (_onlineMode && Network.isOnline() && Network.isHost()) {
        _startOnlineGame();
        return;
    }

    // ── ローカル処理（従来どおり） ────────────────────────────
    const playerName = els.playerName.value.trim() || 'プレイヤー1';
    const botCount   = parseInt(els.botCount.value);
    const botDiff    = els.botDiff.value;

    // Build rules object (v3 format)
    const mode = document.querySelector('[name=constraintMode]:checked').value;
    const rules = { fourPts: els.r4pts.checked };

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

    Game.init({ playerName, botCount, botDiff, rules });

    els.setupScreen.classList.add('hidden');
    els.gameScreen.classList.remove('hidden');

    const st = Game.getState();
    els.neededTxt.textContent = st.needed;
    els.neededA.textContent   = st.needed;
    els.neededB.textContent   = st.needed;

    // Online chat
    if (Network.isOnline()) {
        els.chatSection.classList.remove('hidden');
        Network.onChat(msg => appendChat(msg));
    } else {
        els.chatSection.classList.add('hidden');
    }

    zoneDirection = 'AB';
    renderDirectionUI();
    renderRulesBadges();
    renderAll();
    els.funcInput.value = '';
    startBots();
}

/* ── オンライン: ホストがゲームを開始 ─────────────────────── */
async function _startOnlineGame() {
    bindZonePicker();
    const room = Network.getRoom();

    // ルール設定を読み込む（セットアップ画面の設定を使用）
    const mode  = document.querySelector('[name=constraintMode]:checked').value;
    const rules = { fourPts: els.r4pts.checked };
    if (mode === 'global') {
        const gc = document.querySelector('[name=globalC]:checked');
        rules.globalConstraint = gc ? gc.value : null;
    } else {
        rules.globalConstraint = null;
        rules.playerConstraints = {};
    }

    // ルームの参加者からゲームプレイヤーを生成 & ID マップを作成
    const idMap = {};
    idMap[room.players[0].id] = 'human'; // ホスト自身
    const onlinePlayers = room.players.map((player, i) => {
        const gameId = i === 0 ? 'human' : `bot${i - 1}`;
        idMap[player.id] = gameId;
        return { id: gameId, name: player.name, isBot: false };
    });

    // ホスト自身の idMap エントリ (getMyGameId() が 'human' を返せるように)
    idMap['host'] = 'human';
    room.idMap = idMap;

    const botDiff = 'medium'; // オンライン対戦ではBOTなし
    Game.init({ playerName: room.players[0].name, botCount: 0, botDiff, rules, onlinePlayers });

    // Firebase にゲーム開始を記録し、IDマップをブロードキャスト
    await Network.markStarted(idMap);

    // OnlineSync 開始: ホストとして
    OnlineSync.start(true, null);

    els.setupScreen.classList.add('hidden');
    els.gameScreen.classList.remove('hidden');

    const st = Game.getState();
    els.neededTxt.textContent = st.needed;
    els.neededA.textContent   = st.needed;
    els.neededB.textContent   = st.needed;

    els.chatSection.classList.remove('hidden');
    Network.onChat(msg => appendChat(msg));

    zoneDirection = 'AB';
    renderDirectionUI();
    renderRulesBadges();
    renderAll();
    els.funcInput.value = '';
    // オンライン対戦ではBOTを起動しない
}

/* ── クライアント: ホストのゲーム開始を待つ ────────────────── */
function _startWatchingForGame() {
    OnlineSync.start(false, rawData => {
        const st = Game.getState();
        if (!st) return;

        const prevPhase = OnlineSync.getPrevPhase();

        // まだセットアップ画面ならゲーム画面へ遷移
        if (!els.setupScreen.classList.contains('hidden')) {
            bindZonePicker();
            els.setupScreen.classList.add('hidden');
            els.gameScreen.classList.remove('hidden');

            els.neededTxt.textContent = st.needed;
            els.neededA.textContent   = st.needed;
            els.neededB.textContent   = st.needed;

            els.chatSection.classList.remove('hidden');
            Network.onChat(msg => appendChat(msg));

            zoneDirection = 'AB';
            renderDirectionUI();
            renderRulesBadges();
        }

        renderAll();

        // フェーズ遷移の検出
        if (st.phase === 'roundEnd' && prevPhase !== 'roundEnd') {
            Bot.clearAll();
            addLog(`${st.players.find(p => p.id === st.lastWinner)?.name || '?'}: ${st.lastFormula}`, 'log-win');
            showModal();
        } else if (st.phase === 'gameOver' && prevPhase !== 'gameOver') {
            showGameOverModal();
        } else if (st.phase === 'playing' && prevPhase === 'roundEnd') {
            // 次のラウンドへ遷移
            stopAutoAdvance();
            destroyGraph();
            els.modal.classList.add('hidden');
            els.funcInput.value = '';
            els.botRow.innerHTML = '';
            renderDirectionUI();
            renderAll();
        }
    });
}

function handleMenu() {
    Bot.clearAll();
    stopAutoAdvance();
    destroyGraph();
    OnlineSync.reset();
    if (Network.isOnline()) Network.leaveRoom();
    els.gameScreen.classList.add('hidden');
    els.modal.classList.add('hidden');
    els.setupScreen.classList.remove('hidden');
}

/* ── Per-player constraint UI ──────────────── */
function renderPerPlayerConstraints() {
    const playerName = els.playerName.value.trim() || 'プレイヤー1';
    const botCount   = parseInt(els.botCount.value);
    const players    = [{ id: 'human', name: playerName }];
    const botNames   = ['α','β','γ'];
    for (let i = 0; i < botCount; i++)
        players.push({ id: `bot${i}`, name: `BOT-${botNames[i]}` });

    const opts = [
        { val:'none', label:'縛りなし' },
        { val:'integer', label:'整数係数縛り ★☆☆☆' },
        { val:'origin',  label:'原点縛り ★★☆☆' },
        { val:'even',    label:'偶関数縛り ★★★★' },
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

    // Enforce mutual exclusion: each constraint type can only be assigned once
    els.perPlayerConstraints.addEventListener('change', enforceConstraintExclusivity);
}

function enforceConstraintExclusivity() {
    const used = {};
    document.querySelectorAll('.per-player-row').forEach(row => {
        const pid = row.dataset.pid;
        const sel = row.querySelector('[name^=pc_]:checked');
        if (sel && sel.value !== 'none') used[sel.value] = pid;
    });
    document.querySelectorAll('.per-player-row').forEach(row => {
        const pid = row.dataset.pid;
        ['integer','origin','even'].forEach(v => {
            const radio = row.querySelector(`[name=pc_${pid}][value=${v}]`);
            if (!radio) return;
            // Disable if used by another player
            radio.disabled = (used[v] && used[v] !== pid);
        });
    });
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
    const result = Game.toggleSelect(zone, cardIdx);
    renderZones();
    renderSelStatus();
    renderSpecialPanel();
    updateDeclareBtn();

    const msgs = {
        revSelected:      () => setMsg(`反転カード: Zone ${zone} の中から対象カードをクリックしてください`, 'info'),
        revTargetSet:     () => setMsg('反転カードの対象を設定しました ✓'),
        revTargetInvalid: () => setMsg('このカードは対象にできません（特殊/選択済みカード不可）', 'err'),
        isRevTarget:      () => setMsg('このカードは反転カードの対象として使用中です', 'err'),
        nSelected:        () => setMsg('N カード: 下のパネルで数値を選んでください', 'info'),
        full:             () => setMsg(`Zone ${zone} はすでに ${Game.getState().needed} 枚選択中。クリックで解除できます`, 'err'),
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

    // オンライン・非ホスト: アクションを送信
    if (Network.isOnline() && !Network.isHost()) {
        OnlineSync.sendAction({ type: 'addCard', payload: { zone } });
        setMsg(`Zone ${zone} へカード追加をリクエストしました…`);
        return;
    }

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
}

/* ═══════════════════════════════════════════════
   DECLARE
   ═══════════════════════════════════════════════ */
function handleDeclare() {
    const formula = els.funcInput.value.trim();
    if (!formula) { setMsg('関数式を入力してください', 'err'); return; }

    // オンライン・非ホスト: アクションをホストに送信
    if (Network.isOnline() && !Network.isHost()) {
        const st = Game.getState();
        OnlineSync.sendAction({
            type:      'declare',
            payload:   {
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

    // ローカル / ホスト: 直接処理
    const result = Game.declare('human', formula, zoneDirection);
    if (result.ok) {
        Bot.clearAll();
        addLog(`${Game.getState().players[0].name}: ${formula}`, 'log-win');
        if (Network.isOnline()) OnlineSync.broadcastAfterBotAction();
        showModal();
    } else {
        setMsg(result.why, 'err');
        addLog(`${Game.getState().players[0].name} 誤宣言: ${formula}`, 'log-err');
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
}

function renderDirectionUI() {
    els.dirAB.classList.toggle('active', zoneDirection === 'AB');
    els.dirBA.classList.toggle('active', zoneDirection === 'BA');
    // Update zone headers to reflect role
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

    // オンライン・非ホスト: アクションを送信（ホスト側で処理）
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
}

/* ═══════════════════════════════════════════════
   BOT  (phase check REMOVED from callback — it's always roundEnd by then)
   ═══════════════════════════════════════════════ */
function startBots() {
    // オンライン対戦中はBOTを動かさない（ホストでもオンライン時はBOTなし）
    if (Network.isOnline()) return;

    Bot.scheduleBots((botId, formula) => {
        const st  = Game.getState();
        const bot = st.players.find(p => p.id === botId);
        if (!bot) return;
        addLog(`${bot.name}: ${formula}`, 'log-win');
        els.botRow.innerHTML = '';
        showModal();
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
    const myId  = Network.isOnline() ? (Network.getMyGameId() || 'human') : 'human';
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
    const c = Game.getPlayerConstraint(playerId);
    if (!c) return '';
    return `<span class="player-constraint-tag">${CONSTRAINT_LABELS[c]||''}</span>`;
}

function renderRulesBadges() {
    const st = Game.getState();
    const r  = st.rules;
    const badges = [];
    if (r.fourPts) badges.push('4点縛り');
    if (r.globalConstraint) badges.push(CONSTRAINT_LABELS[r.globalConstraint] || r.globalConstraint);
    els.rulesBadges.innerHTML = badges.map(b => `<span class="rule-badge">${b}</span>`).join('');
}

function updateDeclareBtn() {
    const st   = Game.getState();
    const myId = Network.isOnline() ? (Network.getMyGameId() || 'human') : 'human';
    const selAFull = st.selA.every(v => v !== null);
    const selBFull = st.selB.every(v => v !== null);
    const nReady   = ['A', 'B'].every(zone => {
        return (zone === 'A' ? st.selA : st.selB).every(i => i === null || Game.effectiveValue(zone, i) !== null);
    });
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

    const xZone = dir === 'BA' ? 'B' : 'A';
    const yZone = dir === 'BA' ? 'A' : 'B';
    els.modalPts.innerHTML = (st.lastPoints||[]).map((p,i) => `
      <div class="modal-pt">
        <span class="pt-pair-dot" style="background:${PAIR_HEX[i%4]}"></span>
        (${p.x}, ${p.y})
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

    // Draw interactive graph
    if (st.lastFormula && st.lastPoints && st.lastPoints.length > 0) {
        els.graphContainer.classList.remove('hidden');
        setupInteractiveGraph(els.fnGraph, st.lastFormula, st.lastPoints);
    } else {
        els.graphContainer.classList.add('hidden');
    }

    // Auto-advance countdown
    startAutoAdvance();
}

/* ═══════════════════════════════════════════════
   MODAL — GAME OVER
   ═══════════════════════════════════════════════ */
function showGameOverModal() {
    stopAutoAdvance();
    destroyGraph();
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
        if (autoAdvRemain <= 0) {
            stopAutoAdvance();
            handleNextRound();
        }
    }, 1000);
}

function stopAutoAdvance() {
    if (autoAdvTimer) { clearInterval(autoAdvTimer); autoAdvTimer = null; }
    els.countdownRow.style.display = 'none';
}

function updateCountdown() {
    els.countdownNum.textContent = autoAdvRemain;
    const pct = (autoAdvRemain / AUTO_ADVANCE_SECS) * 100;
    els.countdownBar.style.width = pct + '%';
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

    // Compute initial view range from points
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    let xMin = Math.min(...xs) - 3, xMax = Math.max(...xs) + 3;
    let yMin = Math.min(...ys),     yMax = Math.max(...ys);

    // Sample fn to get y range
    const fn = Game.parseFormula(formulaStr);
    if (!fn) { els.graphContainer.classList.add('hidden'); return; }

    const SAMPLE = 200;
    const dx = (xMax - xMin) / SAMPLE;
    for (let s = 0; s <= SAMPLE; s++) {
        try { const y = fn(xMin + s*dx); if (isFinite(y)) { yMin=Math.min(yMin,y); yMax=Math.max(yMax,y); } } catch {}
    }
    const yPad = Math.max((yMax-yMin)*0.25, 2);
    yMin -= yPad; yMax += yPad;
    if (xMin===xMax){xMin-=2;xMax+=2;}
    if (yMin===yMax){yMin-=2;yMax+=2;}

    // View state
    let offsetX = 0, offsetY = 0, zoom = 1;

    function toCanvas(gx, gy) {
        const W = canvas.width, H = canvas.height;
        const rangeX = (xMax-xMin)/zoom, rangeY = (yMax-yMin)/zoom;
        const ctrGX  = (xMin+xMax)/2 - offsetX/W*rangeX;
        const ctrGY  = (yMin+yMax)/2 + offsetY/H*rangeY;
        return {
            cx: (gx - (ctrGX-rangeX/2)) / rangeX * W,
            cy: H - (gy - (ctrGY-rangeY/2)) / rangeY * H,
        };
    }
    function toGraph(cx, cy) {
        const W = canvas.width, H = canvas.height;
        const rangeX = (xMax-xMin)/zoom, rangeY = (yMax-yMin)/zoom;
        const ctrGX  = (xMin+xMax)/2 - offsetX/W*rangeX;
        const ctrGY  = (yMin+yMax)/2 + offsetY/H*rangeY;
        return {
            gx: cx/W*rangeX + (ctrGX-rangeX/2),
            gy: (1-cy/H)*rangeY + (ctrGY-rangeY/2),
        };
    }

    function draw() {
        const W = canvas.width, H = canvas.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = '#0a1724';
        ctx.fillRect(0, 0, W, H);

        // Grid
        const rangeX = (xMax-xMin)/zoom, rangeY = (yMax-yMin)/zoom;
        const ctrGX  = (xMin+xMax)/2 - offsetX/W*rangeX;
        const ctrGY  = (yMin+yMax)/2 + offsetY/H*rangeY;
        const vxMin  = ctrGX-rangeX/2, vxMax = ctrGX+rangeX/2;
        const vyMin  = ctrGY-rangeY/2, vyMax = ctrGY+rangeY/2;

        // Grid step (adaptive)
        const rawStep = rangeX / 8;
        const step = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const niceStep = rawStep/step < 2 ? step : rawStep/step < 5 ? 2*step : 5*step;

        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        for (let gx=Math.ceil(vxMin/niceStep)*niceStep; gx<=vxMax; gx+=niceStep) {
            const {cx} = toCanvas(gx,0);
            ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke();
        }
        for (let gy=Math.ceil(vyMin/niceStep)*niceStep; gy<=vyMax; gy+=niceStep) {
            const {cy} = toCanvas(0,gy);
            ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(W,cy); ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1.5;
        const {cx:ox} = toCanvas(0,0); const {cy:oy} = toCanvas(0,0);
        if (ox>=0&&ox<=W){ctx.beginPath();ctx.moveTo(ox,0);ctx.lineTo(ox,H);ctx.stroke();}
        if (oy>=0&&oy<=H){ctx.beginPath();ctx.moveTo(0,oy);ctx.lineTo(W,oy);ctx.stroke();}

        // Axis labels
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '9px Inter,sans-serif';
        for (let gx=Math.ceil(vxMin/niceStep)*niceStep; gx<=vxMax; gx+=niceStep) {
            if (Math.abs(gx)<1e-9) continue;
            const {cx} = toCanvas(gx,0);
            const ly = Math.min(Math.max(oy+11,10),H-4);
            ctx.textAlign='center'; ctx.fillText(gx%1===0?gx:gx.toFixed(1), cx, ly);
        }
        ctx.textAlign='right';
        for (let gy=Math.ceil(vyMin/niceStep)*niceStep; gy<=vyMax; gy+=niceStep) {
            if (Math.abs(gy)<1e-9) continue;
            const {cy} = toCanvas(0,gy);
            const lx = Math.min(Math.max(ox-4,22),W-2);
            ctx.fillText(gy%1===0?gy:gy.toFixed(1), lx, cy+3);
        }

        // Function curve
        ctx.strokeStyle = '#3a8fe8';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let penDown = false, lastY = null;
        const steps = 500;
        const ddx = rangeX / steps;
        for (let s = 0; s <= steps; s++) {
            const gx = vxMin + s*ddx;
            let gy;
            try { gy = fn(gx); } catch { penDown=false; lastY=null; continue; }
            if (!isFinite(gy) || Math.abs(gy) > rangeY*10 + 100) { penDown=false; lastY=null; continue; }
            if (lastY !== null && Math.abs(gy-lastY) > rangeY*4) { penDown=false; }
            lastY = gy;
            const {cx,cy} = toCanvas(gx,gy);
            if (!penDown) { ctx.moveTo(cx,cy); penDown=true; } else { ctx.lineTo(cx,cy); }
        }
        ctx.stroke();

        // Points
        const PCOLS = ['#e8a030','#2cb87a','#8c6fe8','#e85a5a'];
        points.forEach((p, i) => {
            const {cx,cy} = toCanvas(p.x, p.y);
            const col = PCOLS[i%4];
            ctx.save();
            ctx.shadowBlur = 16; ctx.shadowColor = col;
            ctx.beginPath(); ctx.arc(cx,cy,8,0,Math.PI*2);
            ctx.fillStyle = col; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.restore();
            // Label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Inter,sans-serif';
            ctx.textAlign = 'left';
            const labelX = cx+11, labelY = cy-7;
            // outline
            ctx.strokeStyle = '#0a1724'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
            ctx.strokeText(`(${p.x}, ${p.y})`, labelX, labelY);
            ctx.fillStyle = '#fff';
            ctx.fillText(`(${p.x}, ${p.y})`, labelX, labelY);
        });
    }

    // Interaction
    let drag = null;
    const onMouseDown = e => {
        drag = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
    };
    const onMouseMove = e => {
        if (!drag) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        offsetX += (e.clientX - drag.x) * scaleX;
        offsetY += (e.clientY - drag.y) * scaleY;
        drag = { x: e.clientX, y: e.clientY };
        draw();
    };
    const onMouseUp = () => { drag = null; canvas.style.cursor = 'grab'; };
    const onWheel = e => {
        e.preventDefault();
        zoom = Math.max(0.15, Math.min(20, zoom * (e.deltaY < 0 ? 1.15 : 0.87)));
        draw();
    };

    // Touch
    let lastTouch = null;
    const onTouchStart = e => { if (e.touches.length===1) lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY}; };
    const onTouchMove  = e => {
        e.preventDefault();
        if (e.touches.length===1&&lastTouch) {
            const rect = canvas.getBoundingClientRect();
            offsetX += (e.touches[0].clientX-lastTouch.x) * (canvas.width/rect.width);
            offsetY += (e.touches[0].clientY-lastTouch.y) * (canvas.height/rect.height);
            lastTouch = {x:e.touches[0].clientX,y:e.touches[0].clientY};
            draw();
        }
    };
    const onTouchEnd = () => { lastTouch=null; };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    canvas.addEventListener('wheel',     onWheel, {passive:false});
    canvas.addEventListener('touchstart', onTouchStart, {passive:true});
    canvas.addEventListener('touchmove',  onTouchMove,  {passive:false});
    canvas.addEventListener('touchend',   onTouchEnd,   {passive:true});

    graphListeners = [
        () => canvas.removeEventListener('mousedown', onMouseDown),
        () => window.removeEventListener('mousemove', onMouseMove),
        () => window.removeEventListener('mouseup',   onMouseUp),
        () => canvas.removeEventListener('wheel',     onWheel),
        () => canvas.removeEventListener('touchstart', onTouchStart),
        () => canvas.removeEventListener('touchmove',  onTouchMove),
        () => canvas.removeEventListener('touchend',   onTouchEnd),
    ];

    draw();
}

/* ═══════════════════════════════════════════════
   CHAT
   ═══════════════════════════════════════════════ */
function sendChat() {
    const text = els.chatInput.value.trim();
    if (!text) return;
    Network.sendChat(text);
    els.chatInput.value = '';
}

function appendChat(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-sender">${msg.sender}:</span> ${msg.text}`;
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

function addLog(text, cls='log-info') {
    const div = document.createElement('div');
    div.className = `log-entry ${cls}`;
    div.textContent = text;
    els.logBox.prepend(div);
    while (els.logBox.children.length > 50) els.logBox.removeChild(els.logBox.lastChild);
}
