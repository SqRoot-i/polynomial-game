/**
 * game.js — Polynomial v3
 * New: direction param in declare(), per-player constraints, getPlayerConstraint()
 */

const Game = (() => {
    let state = null;

    function buildDeck() {
        const deck = [];
        for (let n = -9; n <= 9; n++)
            for (let k = 0; k < 3; k++) deck.push({ type: 'num', value: n });
        deck.push({ type: 'special', value: 'N' });
        deck.push({ type: 'special', value: 'REV' });
        return shuffle(deck);
    }

    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length-1; i > 0; i--) {
            const j = Math.floor(Math.random()*(i+1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function drawNonSpecial(deck, n) {
        const drawn = [], skipped = [];
        while (drawn.length < n && deck.length > 0) {
            const c = deck.shift();
            if (c.type === 'special') skipped.push(c); else drawn.push(c);
        }
        deck.push(...skipped);
        return drawn;
    }

    // ── INIT ──────────────────────────────────
    // rules shape (v3):
    //   fourPts: bool
    //   globalConstraint: null | 'integer' | 'origin' | 'even'
    //   playerConstraints: { [playerId]: null | 'integer' | 'origin' | 'even' }
    //
    // オンライン対戦時: onlinePlayers に [{id, name, isBot:false},...] を渡すと
    // playerName/botCount を無視してそのプレイヤー一覧を使う
    function init({ playerName, botCount, botDiff, rules, onlinePlayers }) {
        const needed = rules.fourPts ? 4 : 3;
        const deck = buildDeck();

        let players;
        if (onlinePlayers && onlinePlayers.length > 0) {
            // オンライン: 外から渡されたプレイヤー一覧を使用
            players = onlinePlayers.map(p => ({ ...p, score: 0 }));
        } else {
            // ローカル: 従来どおり
            players = [{ id: 'human', name: playerName, score: 0, isBot: false }];
            const botNames = ['α', 'β', 'γ'];
            for (let i = 0; i < botCount; i++)
                players.push({ id: `bot${i}`, name: `BOT-${botNames[i]}`, score: 0, isBot: true });
        }

        state = {
            phase: 'playing',
            round: 1,
            deck,
            zoneA: drawNonSpecial(deck, needed),
            zoneB: drawNonSpecial(deck, needed),
            selA: Array(needed).fill(null),
            selB: Array(needed).fill(null),
            nValues: {},
            revTargets: {},
            revPending: null,
            players,
            penalized: new Set(),
            rules,
            botDiff,
            needed,
            lastWinner: null,
            lastFormula: null,
            lastPoints: null,
            lastDirection: null,
            gameOverReason: null,
            pendingVote: null,
        };
        return state;
    }

    // ── PER-PLAYER CONSTRAINT ─────────────────
    function getPlayerConstraint(playerId) {
        const r = state.rules;
        if (r.globalConstraint) return r.globalConstraint;
        if (r.playerConstraints && playerId in r.playerConstraints) return r.playerConstraints[playerId] || null;
        // v1 backward compat
        if (r.integer) return 'integer';
        if (r.origin)  return 'origin';
        if (r.even)    return 'even';
        return null;
    }

    // ── EFFECTIVE VALUE ───────────────────────
    function effectiveValue(zone, cardIdx) {
        const cards = zone === 'A' ? state.zoneA : state.zoneB;
        const card = cards[cardIdx];
        if (!card) return null;
        const key = `${zone}_${cardIdx}`;
        if (card.type === 'special' && card.value === 'N')
            return key in state.nValues ? state.nValues[key] : null;
        if (card.type === 'special' && card.value === 'REV') {
            if (!(key in state.revTargets)) return null;
            const tv = effectiveValue(zone, state.revTargets[key]);
            return tv === null ? null : -tv;
        }
        return card.value;
    }

    // ── SELECTION ─────────────────────────────
    function toggleSelect(zone, cardIdx) {
        const sel   = zone === 'A' ? state.selA : state.selB;
        const cards = zone === 'A' ? state.zoneA : state.zoneB;
        const card  = cards[cardIdx];
        if (!card) return { action: 'invalid' };

        if (state.revPending && state.revPending.zone === zone) {
            const { cardIdx: revIdx } = state.revPending;
            if (cardIdx !== revIdx && !sel.includes(cardIdx) && card.type !== 'special') {
                state.revTargets[`${zone}_${revIdx}`] = cardIdx;
                state.revPending = null;
                return { action: 'revTargetSet' };
            }
            return { action: 'revTargetInvalid' };
        }

        const existing = sel.indexOf(cardIdx);
        if (existing !== -1) {
            sel.splice(existing, 1);
            sel.push(null);
            const key = `${zone}_${cardIdx}`;
            if (card.value === 'REV') delete state.revTargets[key];
            if (card.value === 'N')   delete state.nValues[key];
            return { action: 'deselected' };
        }

        const isRevTgt = Object.entries(state.revTargets).some(
            ([k, ti]) => k.startsWith(zone+'_') && ti === cardIdx);
        if (isRevTgt) return { action: 'isRevTarget' };

        const free = sel.indexOf(null);
        if (free === -1) return { action: 'full' };
        sel[free] = cardIdx;

        if (card.type === 'special' && card.value === 'REV') {
            state.revPending = { zone, cardIdx };
            return { action: 'revSelected' };
        }
        if (card.type === 'special' && card.value === 'N') return { action: 'nSelected' };
        return { action: 'selected' };
    }

    function setNValue(zone, cardIdx, val) { state.nValues[`${zone}_${cardIdx}`] = val; }

    function cancelRevPending() {
        if (!state.revPending) return;
        const { zone, cardIdx } = state.revPending;
        const sel = zone === 'A' ? state.selA : state.selB;
        const idx = sel.indexOf(cardIdx);
        if (idx !== -1) { sel.splice(idx, 1); sel.push(null); }
        state.revPending = null;
    }

    // ── ADD CARD ──────────────────────────────
    function addCardToZone(zone) {
        if (state.deck.length === 0) return false;
        const card = state.deck.shift();
        if (zone === 'A') state.zoneA.push(card); else state.zoneB.push(card);
        state.penalized.clear();
        state.selA = Array(state.needed).fill(null);
        state.selB = Array(state.needed).fill(null);
        state.nValues = {};
        state.revTargets = {};
        state.revPending = null;
        return true;
    }
    function addCard() { return addCardToZone(state.zoneA.length <= state.zoneB.length ? 'A' : 'B'); }

    // ── DECLARE ───────────────────────────────
    // direction: 'AB' (A=x,B=y)  'BA' (B=x,A=y)  'auto' (try both)
    function declare(playerId, formulaStr, direction = 'auto') {
        if (state.phase !== 'playing')         return { ok: false, why: '現在宣言できません' };
        if (state.penalized.has(playerId))     return { ok: false, why: 'ペナルティ中のため宣言できません' };
        if (state.selA.includes(null) || state.selB.includes(null))
            return { ok: false, why: `Zone A・B からそれぞれ ${state.needed} 枚選択してください` };
        if (state.revPending)                  return { ok: false, why: '反転カードの対象カードを選んでください' };

        for (let i = 0; i < state.needed; i++) {
            if (effectiveValue('A', state.selA[i]) === null || effectiveValue('B', state.selB[i]) === null)
                return { ok: false, why: 'N カード／反転カードの値が未設定です' };
        }

        const constraint = getPlayerConstraint(playerId);
        if (constraint === 'integer' && !hasIntegerCoeffsStr(formulaStr))
            return { ok: false, why: '整数係数縛り: 係数はすべて整数でなければなりません' };

        const fn = parseFormula(formulaStr);
        if (!fn) return { ok: false, why: '式の形式が正しくありません（例: y=2x+1, y=x^2-3）' };

        const pairs = [];
        for (let i = 0; i < state.needed; i++)
            pairs.push({ a: effectiveValue('A', state.selA[i]), b: effectiveValue('B', state.selB[i]) });

        const ptsAB = pairs.map(p => ({ x: p.a, y: p.b }));
        const ptsBA = pairs.map(p => ({ x: p.b, y: p.a }));

        let validPts = null, usedDir = null;
        if (direction !== 'BA' && ptsCheck(fn, ptsAB)) { validPts = ptsAB; usedDir = 'AB'; }
        else if (direction !== 'AB' && ptsCheck(fn, ptsBA)) { validPts = ptsBA; usedDir = 'BA'; }

        if (!validPts) {
            if (direction === 'AB') return { ok: false, why: 'Zone A→x, Zone B→y として計算しましたが、その関数を通っていません' };
            if (direction === 'BA') return { ok: false, why: 'Zone B→x, Zone A→y として計算しましたが、その関数を通っていません' };
            return { ok: false, why: '選んだカードの値がその関数を通っていません' };
        }

        const ruleErr = checkExtraRules(fn, playerId);
        if (ruleErr) return { ok: false, why: ruleErr };

        state.players.find(p => p.id === playerId).score++;
        state.phase = 'roundEnd';
        state.lastWinner = playerId;
        state.lastFormula = formulaStr;
        state.lastPoints  = validPts;
        state.lastDirection = usedDir;
        return { ok: true, pts: validPts, direction: usedDir };
    }

    function ptsCheck(fn, pts) {
        try { return pts.every(p => Math.abs(fn(p.x) - p.y) < 0.01); }
        catch { return false; }
    }

    function botApplyAndDeclare(botId, solution) {
        state.selA = [...solution.selA];
        state.selB = [...solution.selB];
        state.nValues   = { ...(solution.nValues   || {}) };
        state.revTargets = { ...(solution.revTargets || {}) };
        state.revPending = null;
        return declare(botId, solution.formula, solution.direction || 'auto');
    }

    // ── NEXT ROUND ────────────────────────────
    function nextRound() {
        state.round++;
        state.phase = 'playing';
        state.penalized.clear();
        state.selA = Array(state.needed).fill(null);
        state.selB = Array(state.needed).fill(null);
        state.nValues = {}; state.revTargets = {}; state.revPending = null;
        state.lastWinner = null; state.lastFormula = null;
        state.lastPoints = null; state.lastDirection = null;
        state.zoneA = drawNonSpecial(state.deck, state.needed);
        state.zoneB = drawNonSpecial(state.deck, state.needed);
        if (state.zoneA.length < state.needed || state.zoneB.length < state.needed) {
            state.phase = 'gameOver';
            state.gameOverReason = '山札が不足しています';
        }
    }

    function checkGameOver() {
        if (state.phase === 'gameOver') return true;
        if (state.deck.length === 0) {
            if (!botFindSolution('human')) {
                state.phase = 'gameOver';
                state.gameOverReason = '山札がなくなり、現在の盤面では有効な関数が存在しません';
                return true;
            }
        }
        return false;
    }

    // ── MATH ENGINE ───────────────────────────
    function toInt(v) { const r=Math.round(v); return Math.abs(v-r)<1e-6?r:null; }

    function gaussSolve(A, b) {
        const n=A.length, M=A.map((row,i)=>[...row,b[i]]);
        for (let col=0; col<n; col++) {
            let piv=-1, mx=0;
            for (let r=col; r<n; r++) if(Math.abs(M[r][col])>mx){mx=Math.abs(M[r][col]);piv=r;}
            if(piv<0||mx<1e-10) return null;
            [M[col],M[piv]]=[M[piv],M[col]];
            for (let r=0; r<n; r++) {
                if(r===col) continue;
                const f=M[r][col]/M[col][col];
                for(let c=0;c<=n;c++) M[r][c]-=f*M[col][c];
            }
        }
        return M.map((row,i)=>row[n]/row[i]);
    }

    function chkConst(pts) {
        const y0=pts[0].y;
        for(const p of pts) if(Math.abs(p.y-y0)>1e-9) return null;
        const c=toInt(y0); if(c===null) return null;
        return ()=>c;
    }
    function chkLinear(pts) {
        let p0=null,p1=null;
        outer: for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++)
            if(pts[i].x!==pts[j].x){p0=pts[i];p1=pts[j];break outer;}
        if(!p0) return null;
        const a=(p1.y-p0.y)/(p1.x-p0.x), b=p0.y-a*p0.x;
        for(const p of pts) if(Math.abs(a*p.x+b-p.y)>1e-9) return null;
        const ai=toInt(a),bi=toInt(b); if(ai===null||bi===null) return null;
        return x=>ai*x+bi;
    }
    function chkQuad(pts) {
        if(pts.length<3) return null;
        const t=pts.slice(0,3);
        if(new Set(t.map(p=>p.x)).size<3) return null;
        const sol=gaussSolve([[1,t[0].x,t[0].x**2],[1,t[1].x,t[1].x**2],[1,t[2].x,t[2].x**2]],[t[0].y,t[1].y,t[2].y]);
        if(!sol) return null;
        const[c,bv,av]=sol; if(Math.abs(av)<1e-9) return null;
        for(const p of pts) if(Math.abs(av*p.x**2+bv*p.x+c-p.y)>1e-9) return null;
        const ai=toInt(av),bi=toInt(bv),ci=toInt(c); if(ai===null||bi===null||ci===null) return null;
        return x=>ai*x**2+bi*x+ci;
    }
    function chkCubic(pts) {
        if(pts.length<4) return null;
        const f=pts.slice(0,4);
        if(new Set(f.map(p=>p.x)).size<4) return null;
        const sol=gaussSolve(f.map(p=>[1,p.x,p.x**2,p.x**3]),f.map(p=>p.y));
        if(!sol) return null;
        const[d,c,b,a]=sol; if(Math.abs(a)<1e-9) return null;
        for(const p of pts) if(Math.abs(a*p.x**3+b*p.x**2+c*p.x+d-p.y)>1e-9) return null;
        const ai=toInt(a),bi=toInt(b),ci=toInt(c),di=toInt(d);
        if(ai===null||bi===null||ci===null||di===null) return null;
        return x=>ai*x**3+bi*x**2+ci*x+di;
    }
    function chkInverse(pts) {
        if(pts.some(p=>p.x===0)) return null;
        const k=pts[0].y*pts[0].x; if(Math.abs(k)<1e-9) return null;
        for(const p of pts) if(Math.abs(p.y*p.x-k)>1e-9) return null;
        const ki=toInt(k); if(ki===null) return null;
        return x=>ki/x;
    }
    function findFnThrough(pts) {
        return chkConst(pts)||chkLinear(pts)||chkInverse(pts)||chkQuad(pts)||chkCubic(pts)||null;
    }

    // ── BOT SOLVER ────────────────────────────
    function combs(arr,k){
        if(k===0)return[[]]; if(arr.length<k)return[];
        const[f,...rest]=arr;
        return[...combs(rest,k-1).map(c=>[f,...c]),...combs(rest,k)];
    }
    function perms(arr,k){
        if(k===0)return[[]];
        const res=[];
        for(let i=0;i<arr.length;i++){
            const rest=[...arr.slice(0,i),...arr.slice(i+1)];
            perms(rest,k-1).forEach(p=>res.push([arr[i],...p]));
        }
        return res;
    }

    function getAllZoneSelections(zone, n) {
        const cards=zone==='A'?state.zoneA:state.zoneB;
        const allIdx=cards.map((_,i)=>i);
        const results=[];
        for(const slotIdxs of combs(allIdx,n)){
            const restIdxs=allIdx.filter(i=>!slotIdxs.includes(i));
            function resolve(i,vals,nVals,revTgts){
                if(i>=slotIdxs.length){
                    if(vals.every(v=>v!==null)) results.push({slotIdxs,effectiveVals:vals,nVals,revTargets:revTgts});
                    return;
                }
                const ci=slotIdxs[i],card=cards[ci],key=`${zone}_${ci}`;
                if(card.type==='num') resolve(i+1,[...vals,card.value],nVals,revTgts);
                else if(card.value==='N') for(let v=-9;v<=9;v++) resolve(i+1,[...vals,v],{...nVals,[key]:v},revTgts);
                else if(card.value==='REV') for(const ti of restIdxs){
                    const tc=cards[ti]; if(tc.type!=='num') continue;
                    resolve(i+1,[...vals,-tc.value],nVals,{...revTgts,[key]:ti});
                }
            }
            resolve(0,[],{},{});
        }
        return results;
    }

    function botFindSolution(botId) {
        const n=state.needed;
        const constraint=getPlayerConstraint(botId||'human');
        const aS=getAllZoneSelections('A',n);
        const bS=getAllZoneSelections('B',n);
        const pIdxs=Array.from({length:n},(_,i)=>i);

        for(const aSel of aS) for(const bSel of bS){
            const aV=aSel.effectiveVals, bV=bSel.effectiveVals;
            const nValues={...aSel.nVals,...bSel.nVals};
            const revTargets={...aSel.revTargets,...bSel.revTargets};

            const tryDir=(xVals,yVals,dir,selXSlots,selYSlots)=>{
                if(new Set(xVals).size!==n) return null;
                for(const yPerm of perms(pIdxs,n)){
                    const pts=xVals.map((xv,k)=>({x:xv,y:yVals[yPerm[k]]}));
                    const fn=findFnThrough(pts);
                    if(!fn||checkExtraRules(fn,botId)) continue;
                    if(constraint==='integer'){
                        const formula=ptsToFormula(pts);
                        if(!formula||!hasIntegerCoeffsStr(formula)) continue;
                        return{formula,pts,dir,
                            selA:dir==='AB'?selXSlots:yPerm.map(pi=>selYSlots[pi]),
                            selB:dir==='AB'?yPerm.map(pi=>selYSlots[pi]):selXSlots,
                            nValues,revTargets};
                    }
                    const formula=ptsToFormula(pts);
                    if(!formula) continue;
                    return{formula,pts,dir,
                        selA:dir==='AB'?selXSlots:yPerm.map(pi=>selYSlots[pi]),
                        selB:dir==='AB'?yPerm.map(pi=>selYSlots[pi]):selXSlots,
                        nValues,revTargets};
                }
                return null;
            };

            const r1=tryDir(aV,bV,'AB',aSel.slotIdxs,bSel.slotIdxs);
            if(r1) return r1;
            const r2=tryDir(bV,aV,'BA',bSel.slotIdxs,aSel.slotIdxs);
            if(r2) return r2;
        }
        return null;
    }

    // ── FORMULA DERIVATION ────────────────────
    function ptsToFormula(pts) {
        if(chkConst(pts)) return `y = ${pts[0].y}`;
        const lin=chkLinear(pts);
        if(lin){
            const p0=pts[0],p1=pts.find(p=>p.x!==p0.x);
            const a=toInt((p1.y-p0.y)/(p1.x-p0.x)),b=toInt(p0.y-a*p0.x);
            if(a===null||b===null) return null;
            return fmtLin(a,b);
        }
        const inv=chkInverse(pts);
        if(inv){const k=toInt(pts[0].y*pts[0].x);if(k===null)return null;return`y = ${k}/x`;}
        const quad=chkQuad(pts);
        if(quad){
            const t=pts.slice(0,3);
            const sol=gaussSolve([[1,t[0].x,t[0].x**2],[1,t[1].x,t[1].x**2],[1,t[2].x,t[2].x**2]],[t[0].y,t[1].y,t[2].y]);
            if(!sol)return null;
            const[c,b,a]=[toInt(sol[0]),toInt(sol[1]),toInt(sol[2])];
            if(a===null||b===null||c===null)return null;
            return fmtQuad(a,b,c);
        }
        const cubic=chkCubic(pts);
        if(cubic){
            const f=pts.slice(0,4);
            const sol=gaussSolve(f.map(p=>[1,p.x,p.x**2,p.x**3]),f.map(p=>p.y));
            if(!sol)return null;
            const[d,c,b,a]=[toInt(sol[0]),toInt(sol[1]),toInt(sol[2]),toInt(sol[3])];
            if(a===null||b===null||c===null||d===null)return null;
            return fmtCubic(a,b,c,d);
        }
        return null;
    }

    function fc(a,v,lead=false){
        if(a===0)return'';
        if(lead){if(a===1)return v;if(a===-1)return`-${v}`;return`${a}${v}`;}
        if(a>0)return a===1?` + ${v}`:` + ${a}${v}`;
        return a===-1?` - ${v}`:` - ${Math.abs(a)}${v}`;
    }
    function fk(c,lead=false){
        if(c===0)return lead?'0':'';
        return lead?String(c):c>0?` + ${c}`:` - ${Math.abs(c)}`;
    }
    function fmtLin(a,b){if(a===0)return`y = ${b}`;let s='y = '+fc(a,'x',true);if(b)s+=fk(b);return s;}
    function fmtQuad(a,b,c){let s='y = '+fc(a,'x²',true);if(b)s+=fc(b,'x');if(c)s+=fk(c);return s;}
    function fmtCubic(a,b,c,d){let s='y = '+fc(a,'x³',true);if(b)s+=fc(b,'x²');if(c)s+=fc(c,'x');if(d)s+=fk(d);return s;}

    function parseFormula(str){
        if(!str)return null;
        let expr=str.toLowerCase().replace(/\s+/g,'').replace(/^y=/,'').replace(/^f\(x\)=/,'');
        expr=expr.replace(/x²/g,'x**2').replace(/x³/g,'x**3').replace(/x⁴/g,'x**4');
        expr=expr.replace(/\^/g,'**').replace(/(\d)(x)/g,'$1*$2').replace(/(\d)(\()/g,'$1*(');
        try{const fn=new Function('x',`'use strict';return(${expr});`);fn(1);fn(0);fn(-1);return fn;}
        catch{return null;}
    }
    function hasIntegerCoeffsStr(formula){
        const s=formula.replace(/\s/g,'').replace(/^y=/,'').replace(/^f\(x\)=/,'');
        const nums=s.match(/\d+\.?\d*/g)||[];
        return nums.every(n=>Math.abs(parseFloat(n)-Math.round(parseFloat(n)))<1e-9);
    }

    function checkExtraRules(fn,playerId){
        if(!fn)return null;
        const c=getPlayerConstraint(playerId);
        if(c==='origin'){
            try{if(Math.abs(fn(0))>1e-9)return'原点縛り: f(0) = 0 でなければなりません';}
            catch{return'原点縛り: f(0) = 0 でなければなりません';}
        }
        if(c==='even'){
            for(const x of[1,2,3,5]){
                try{if(Math.abs(fn(x)-fn(-x))>1e-9)return'偶関数縛り: f(x) = f(-x) を満たす必要があります';}
                catch{return'偶関数縛り: f(x) = f(-x) を満たしていません';}
            }
        }
        return null;
    }

    // ── VOTE (カード追加) ─────────────────────────
    function startVote(requesterId) {
        state.pendingVote = { requester: requesterId, votes: {} };
    }

    function castVoteOnCard(voterId, choice) {
        if (!state.pendingVote) return { done: false };
        state.pendingVote.votes[voterId] = choice;
        const votes = Object.values(state.pendingVote.votes);
        const total = state.players.length;
        const needed = Math.floor(total / 2) + 1;
        const countA = votes.filter(v => v === 'A').length;
        const countB = votes.filter(v => v === 'B').length;
        if (countA >= needed) { state.pendingVote = null; return { done: true, zone: 'A' }; }
        if (countB >= needed) { state.pendingVote = null; return { done: true, zone: 'B' }; }
        return { done: false };
    }

    function hasSolution() {
        // Check if any solution exists for any player (ignoring constraints)
        return botFindSolution('__noconstraint__') !== null;
    }

    return{
        init, getState:()=>state,
        toggleSelect, setNValue, cancelRevPending,
        addCard, addCardToZone,
        declare, botApplyAndDeclare,
        nextRound, checkGameOver,
        botFindSolution, getPlayerConstraint,
        parseFormula, ptsToFormula, effectiveValue,
        startVote, castVoteOnCard, hasSolution,
    };
})();
