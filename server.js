const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// Hero names
const HERO_NAMES = ['Aldric', 'Lyra', 'Theron', 'Seraphine', 'Kael', 'Mira', 'Draven', 'Elena'];

// ==================== CARD DATABASE ====================
const CardDB = {
    creatures: [
        { id: 'soldier', name: 'Soldat', atk: 2, hp: 3, cost: 1, abilities: [], type: 'creature', icon: '🛡️' },
        { id: 'archer', name: 'Archer', atk: 3, hp: 2, cost: 2, abilities: ['shooter'], type: 'creature', icon: '🏹' },
        { id: 'dragon', name: 'Dragon', atk: 4, hp: 4, cost: 4, abilities: ['fly'], type: 'creature', icon: '🐉' },
        { id: 'knight', name: 'Chevalier', atk: 3, hp: 4, cost: 3, abilities: [], type: 'creature', icon: '⚔️' },
        { id: 'scout', name: 'Éclaireur', atk: 2, hp: 2, cost: 1, abilities: ['haste'], type: 'creature', icon: '🏃' },
        { id: 'phoenix', name: 'Phénix', atk: 3, hp: 3, cost: 4, abilities: ['fly', 'haste'], type: 'creature', icon: '🔥' },
        { id: 'sniper', name: 'Sniper', atk: 4, hp: 1, cost: 2, abilities: ['shooter'], type: 'creature', icon: '🎯' },
        { id: 'guardian', name: 'Gardien', atk: 1, hp: 6, cost: 2, abilities: [], type: 'creature', icon: '🏰' },
        { id: 'hawk', name: 'Faucon', atk: 2, hp: 2, cost: 3, abilities: ['fly', 'shooter'], type: 'creature', icon: '🦅' },
        { id: 'berserker', name: 'Berserker', atk: 5, hp: 2, cost: 3, abilities: ['haste'], type: 'creature', icon: '💀' },
        { id: 'goblin', name: 'Gobelin', atk: 1, hp: 1, cost: 1, abilities: [], type: 'creature', icon: '👺' },
        { id: 'orc', name: 'Orc', atk: 3, hp: 3, cost: 2, abilities: [], type: 'creature', icon: '👹' },
        { id: 'wolf', name: 'Loup', atk: 2, hp: 1, cost: 1, abilities: ['haste'], type: 'creature', icon: '🐺' }
    ],
    spells: [
        { id: 'fireball', name: 'Boule de feu', damage: 3, cost: 2, type: 'spell', offensive: true, icon: '🔥', pattern: 'single' },
        { id: 'heal', name: 'Soin', heal: 3, cost: 1, type: 'spell', offensive: false, icon: '💚', pattern: 'single' },
        { id: 'lightning', name: 'Éclair', damage: 2, cost: 1, type: 'spell', offensive: true, icon: '⚡', pattern: 'single' },
        { id: 'cross', name: 'Croix de feu', damage: 2, cost: 3, type: 'spell', offensive: true, icon: '✝️', pattern: 'cross' }
    ],
    traps: [
        { id: 'spike', name: 'Piques', damage: 2, cost: 1, type: 'trap', icon: '📌' },
        { id: 'poison', name: 'Poison', damage: 1, cost: 1, type: 'trap', icon: '☠️' },
        { id: 'stun', name: 'Paralysie', cost: 2, type: 'trap', effect: 'stun', icon: '💫' }
    ]
};

const rooms = new Map();
const playerRooms = new Map();
const TURN_TIME = 90;

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomHeroName() {
    return HERO_NAMES[Math.floor(Math.random() * HERO_NAMES.length)];
}

function createDeck() {
    const deck = [];
    for (let i = 0; i < 60; i++) {
        const r = Math.random();
        let pool = r < 0.60 ? CardDB.creatures : r < 0.85 ? CardDB.spells : CardDB.traps;
        const card = { ...pool[Math.floor(Math.random() * pool.length)], uid: `${Date.now()}-${Math.random()}-${i}` };
        if (card.type === 'creature') {
            card.currentHp = card.hp;
            card.canAttack = false;
            card.turnsOnField = 0;
            card.movedThisTurn = false;
        }
        deck.push(card);
    }
    return deck.sort(() => Math.random() - 0.5);
}

function createPlayerState() {
    const deck = createDeck();
    const hand = deck.splice(0, 7);
    return {
        hp: 20,
        energy: 1,
        maxEnergy: 1,
        deck,
        hand,
        field: Array(4).fill(null).map(() => Array(2).fill(null)),
        traps: [null, null, null, null],
        graveyard: [],
        ready: false,
        connected: false,
        inDeployPhase: false,
        pendingActions: [],
        confirmedField: null,
        confirmedTraps: null,
        heroName: getRandomHeroName()
    };
}

function createGameState() {
    return {
        turn: 1,
        phase: 'planning',
        timeLeft: TURN_TIME,
        players: { 1: createPlayerState(), 2: createPlayerState() }
    };
}

function deepClone(obj) {
    if (obj === null || obj === undefined) return obj;
    return JSON.parse(JSON.stringify(obj));
}

function resetPlayerForNewTurn(player) {
    player.ready = false;
    player.inDeployPhase = false;
    player.pendingActions = [];
    
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            if (player.field[r][c]) {
                player.field[r][c].movedThisTurn = false;
            }
        }
    }
    
    player.confirmedField = deepClone(player.field);
    player.confirmedTraps = deepClone(player.traps);
}

function getPublicGameState(room, forPlayer) {
    const state = room.gameState;
    const opponent = forPlayer === 1 ? 2 : 1;
    const me = state.players[forPlayer];
    const opp = state.players[opponent];
    
    const isPlanning = state.phase === 'planning';
    
    return {
        turn: state.turn,
        phase: state.phase,
        timeLeft: state.timeLeft,
        myPlayer: forPlayer,
        me: {
            hp: me.hp,
            energy: me.energy,
            maxEnergy: me.maxEnergy,
            hand: me.hand,
            deckCount: me.deck.length,
            field: me.field,
            traps: me.traps,
            graveyardCount: me.graveyard.length,
            ready: me.ready,
            inDeployPhase: me.inDeployPhase,
            heroName: me.heroName
        },
        opponent: {
            hp: opp.hp,
            energy: opp.maxEnergy,
            maxEnergy: opp.maxEnergy,
            handCount: opp.hand.length,
            deckCount: opp.deck.length,
            field: isPlanning && opp.confirmedField ? opp.confirmedField : opp.field,
            traps: isPlanning && opp.confirmedTraps ? opp.confirmedTraps : opp.traps,
            graveyardCount: opp.graveyard.length,
            ready: opp.ready,
            heroName: opp.heroName
        }
    };
}

function emitStateToPlayer(room, playerNum) {
    const socketId = room.players[playerNum];
    if (socketId) {
        io.to(socketId).emit('gameStateUpdate', getPublicGameState(room, playerNum));
    }
}

function emitStateToBoth(room) {
    emitStateToPlayer(room, 1);
    emitStateToPlayer(room, 2);
}

function emitAnimation(room, type, data) {
    io.to(room.code).emit('animation', { type, ...data });
}

function startTurnTimer(room) {
    if (room.timer) clearInterval(room.timer);
    
    room.timer = setInterval(() => {
        room.gameState.timeLeft--;
        io.to(room.code).emit('timerUpdate', room.gameState.timeLeft);
        if (room.gameState.timeLeft <= 0) {
            clearInterval(room.timer);
            room.gameState.players[1].ready = true;
            room.gameState.players[2].ready = true;
            startResolution(room);
        }
    }, 1000);
}

function checkBothReady(room) {
    if (room.gameState.players[1].ready && room.gameState.players[2].ready) {
        startResolution(room);
    }
}

// Get adjacent cells for cross pattern (same side only)
function getCrossTargets(targetPlayer, row, col) {
    const targets = [];
    // Up
    if (row > 0) targets.push({ row: row - 1, col, player: targetPlayer });
    // Down
    if (row < 3) targets.push({ row: row + 1, col, player: targetPlayer });
    // Left (col 0)
    if (col > 0) targets.push({ row, col: col - 1, player: targetPlayer });
    // Right (col 1)
    if (col < 1) targets.push({ row, col: col + 1, player: targetPlayer });
    return targets;
}

async function startResolution(room) {
    if (room.timer) clearInterval(room.timer);
    room.gameState.phase = 'resolution';
    
    io.to(room.code).emit('phaseChange', 'resolution');
    
    const log = (msg, type) => io.to(room.code).emit('resolutionLog', { msg, type });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
    
    log(`⚔️ RÉSOLUTION DU TOUR ${room.gameState.turn}`, 'phase');
    await sleep(1000);
    
    // Collecter toutes les actions par type
    const allActions = { moves: [], places: [], spellsDefensive: [], spellsOffensive: [], traps: [] };
    
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        const actions = player.pendingActions || [];
        
        for (const action of actions) {
            action.playerNum = p;
            action.heroName = player.heroName;
            
            if (action.type === 'move') allActions.moves.push(action);
            else if (action.type === 'place') allActions.places.push(action);
            else if (action.type === 'trap') allActions.traps.push(action);
            else if (action.type === 'spell') {
                if (action.spell.offensive) allActions.spellsOffensive.push(action);
                else allActions.spellsDefensive.push(action);
            }
        }
    }
    
    // 1. REDÉPLOIEMENTS
    if (allActions.moves.length > 0) {
        log('🔄 Redéploiements', 'phase');
        await sleep(600);
        
        for (const action of allActions.moves) {
            log(`  ↔️ ${action.heroName}: ${action.card.name} ${slotNames[action.fromRow][action.fromCol]} → ${slotNames[action.toRow][action.toCol]}`, 'action');
            emitAnimation(room, 'move', { player: action.playerNum, fromRow: action.fromRow, fromCol: action.fromCol, toRow: action.toRow, toCol: action.toCol });
            emitStateToBoth(room);
            await sleep(800);
        }
    }
    
    // 2. POSES DE CRÉATURES
    if (allActions.places.length > 0) {
        log('🎴 Invocations', 'phase');
        await sleep(600);
        
        for (const action of allActions.places) {
            log(`  🎴 ${action.heroName}: ${action.card.name} en ${slotNames[action.row][action.col]}`, 'action');
            emitAnimation(room, 'summon', { player: action.playerNum, row: action.row, col: action.col, card: action.card });
            emitStateToBoth(room);
            await sleep(800);
        }
    }
    
    // 3. SORTS DÉFENSIFS (soins)
    if (allActions.spellsDefensive.length > 0) {
        log('💚 Sorts de soutien', 'phase');
        await sleep(600);
        
        for (const action of allActions.spellsDefensive) {
            await applySpell(room, action, log, sleep);
        }
    }
    
    // 4. SORTS OFFENSIFS
    if (allActions.spellsOffensive.length > 0) {
        log('🔥 Sorts offensifs', 'phase');
        await sleep(600);
        
        for (const action of allActions.spellsOffensive) {
            await applySpell(room, action, log, sleep);
        }
    }
    
    // 5. POSES DE PIÈGES
    if (allActions.traps.length > 0) {
        log('🪤 Pièges posés', 'phase');
        await sleep(600);
        
        for (const action of allActions.traps) {
            log(`  🪤 ${action.heroName}: Piège en rangée ${action.row + 1}`, 'action');
            emitAnimation(room, 'trapPlace', { player: action.playerNum, row: action.row });
            emitStateToBoth(room);
            await sleep(600);
        }
    }
    
    emitStateToBoth(room);
    await sleep(800);
    
    // 6. PIOCHE (max 9 cartes en main)
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        if (player.deck.length > 0) {
            const card = player.deck.pop();
            if (card.type === 'creature') {
                card.currentHp = card.hp;
                card.canAttack = false;
                card.turnsOnField = 0;
                card.movedThisTurn = false;
            }
            
            // Max 9 cartes en main
            if (player.hand.length >= 9) {
                player.graveyard.push(card);
                log(`📦 ${player.heroName} a la main pleine, la carte va au cimetière`, 'damage');
            } else {
                player.hand.push(card);
            }
        }
    }
    log('📦 Les joueurs piochent une carte', 'action');
    emitStateToBoth(room);
    await sleep(800);
    
    // 7. PHASE DE COMBAT (de haut en bas: A, B, C, D, E, F, G, H)
    log('⚔️ Phase de combat', 'phase');
    await sleep(800);
    
    for (let row = 0; row < 4; row++) {
        // D'abord colonne front (1) puis back (0) pour chaque rangée
        for (let col = 1; col >= 0; col--) {
            await processCombat(room, 1, row, col, log, sleep);
            await processCombat(room, 2, row, col, log, sleep);
        }
    }
    
    // Mettre à jour les créatures pour le prochain tour
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) {
                    card.turnsOnField++;
                    card.canAttack = true;
                    card.movedThisTurn = false;
                }
            }
        }
    }
    
    const p1hp = room.gameState.players[1].hp;
    const p2hp = room.gameState.players[2].hp;
    
    if (p1hp <= 0 || p2hp <= 0) {
        await sleep(800);
        const winner = p1hp <= 0 ? 2 : 1;
        log(`🏆 ${room.gameState.players[winner].heroName} GAGNE!`, 'phase');
        io.to(room.code).emit('gameOver', { winner });
        return;
    }
    
    await sleep(1000);
    startNewTurn(room);
}

// Fonction séparée pour appliquer les sorts
async function applySpell(room, action, log, sleep) {
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
    const playerNum = action.playerNum;
    const player = room.gameState.players[playerNum];
    const opponent = room.gameState.players[playerNum === 1 ? 2 : 1];
    const spell = action.spell;
    
    emitAnimation(room, 'spell', { 
        caster: playerNum, 
        targetPlayer: action.targetPlayer, 
        row: action.row, 
        col: action.col, 
        spell: spell 
    });
    await sleep(600);
    
    if (spell.pattern === 'cross') {
        const targets = getCrossTargets(action.targetPlayer, action.row, action.col);
        log(`  ✝️ ${action.heroName}: ${spell.name} en croix depuis ${slotNames[action.row][action.col]}!`, 'damage');
        
        for (const t of targets) {
            const targetField = t.player === playerNum ? player.field : opponent.field;
            const target = targetField[t.row][t.col];
            
            emitAnimation(room, 'spell', { 
                caster: playerNum, 
                targetPlayer: t.player, 
                row: t.row, 
                col: t.col, 
                spell: spell 
            });
            
            if (target) {
                target.currentHp -= spell.damage;
                log(`    🔥 ${target.name} (-${spell.damage})`, 'damage');
                emitAnimation(room, 'damage', { player: t.player, row: t.row, col: t.col, amount: spell.damage });
                
                if (target.currentHp <= 0) {
                    const targetOwner = t.player === playerNum ? player : opponent;
                    targetOwner.graveyard.push(target);
                    targetField[t.row][t.col] = null;
                    log(`    ☠️ ${target.name} détruit!`, 'damage');
                    emitAnimation(room, 'death', { player: t.player, row: t.row, col: t.col });
                }
            }
            await sleep(400);
        }
    } else {
        const targetField = action.targetPlayer === playerNum ? player.field : opponent.field;
        const target = targetField[action.row][action.col];
        
        if (target) {
            if (spell.offensive && spell.damage) {
                target.currentHp -= spell.damage;
                log(`  🔥 ${action.heroName}: ${spell.name} → ${target.name} (-${spell.damage})`, 'damage');
                emitAnimation(room, 'damage', { player: action.targetPlayer, row: action.row, col: action.col, amount: spell.damage });
                
                if (target.currentHp <= 0) {
                    const targetOwner = action.targetPlayer === playerNum ? player : opponent;
                    targetOwner.graveyard.push(target);
                    targetField[action.row][action.col] = null;
                    log(`  ☠️ ${target.name} détruit!`, 'damage');
                    emitAnimation(room, 'death', { player: action.targetPlayer, row: action.row, col: action.col });
                }
            }
            if (!spell.offensive && spell.heal) {
                const oldHp = target.currentHp;
                target.currentHp = Math.min(target.hp, target.currentHp + spell.heal);
                const healed = target.currentHp - oldHp;
                if (healed > 0) {
                    log(`  💚 ${action.heroName}: ${spell.name} → ${target.name} (+${healed} PV)`, 'heal');
                    emitAnimation(room, 'heal', { player: action.targetPlayer, row: action.row, col: action.col, amount: healed });
                }
            }
        } else {
            log(`  💨 ${action.heroName}: ${spell.name} n'a rien touché`, 'action');
            emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
        }
    }
    
    emitStateToBoth(room);
    await sleep(600);
}

async function applyAction(room, playerNum, action, log, sleep) {
    // Fonction legacy - non utilisée dans la nouvelle résolution
}

async function processCombat(room, attackerPlayer, row, col, log, sleep) {
    const attacker = room.gameState.players[attackerPlayer].field[row][col];
    if (!attacker || !attacker.canAttack) return;
    
    const defenderPlayer = attackerPlayer === 1 ? 2 : 1;
    const defenderState = room.gameState.players[defenderPlayer];
    const defenderField = defenderState.field;
    
    // Piège
    const trap = defenderState.traps[row];
    if (trap) {
        emitAnimation(room, 'trapTrigger', { player: defenderPlayer, row: row, trap: trap });
        await sleep(700);
        
        log(`🪤 Piège "${trap.name}" déclenché sur ${attacker.name}!`, 'trap');
        
        if (trap.damage) {
            attacker.currentHp -= trap.damage;
            emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: col, amount: trap.damage });
            await sleep(500);
        }
        
        const wasStunned = trap.effect === 'stun';
        if (wasStunned) {
            log(`  💫 ${attacker.name} est paralysé!`, 'trap');
        }
        
        defenderState.graveyard.push(trap);
        defenderState.traps[row] = null;
        
        emitStateToBoth(room);
        await sleep(500);
        
        if (attacker.currentHp <= 0) {
            room.gameState.players[attackerPlayer].graveyard.push(attacker);
            room.gameState.players[attackerPlayer].field[row][col] = null;
            log(`  ☠️ ${attacker.name} détruit par le piège!`, 'damage');
            emitAnimation(room, 'death', { player: attackerPlayer, row: row, col: col });
            emitStateToBoth(room);
            await sleep(600);
            return;
        }
        
        if (wasStunned) return;
    }
    
    const defFront = defenderField[row][1];
    const defBack = defenderField[row][0];
    
    const fly = attacker.abilities.includes('fly');
    
    let blocker = null, blockerCol = -1;
    
    if (defFront) {
        const canBlock = !fly || defFront.abilities.includes('fly') || defFront.abilities.includes('shooter');
        if (canBlock) { blocker = defFront; blockerCol = 1; }
    }
    if (!blocker && defBack) {
        const canBlock = !fly || defBack.abilities.includes('fly') || defBack.abilities.includes('shooter');
        if (canBlock) { blocker = defBack; blockerCol = 0; }
    }
    
    emitAnimation(room, 'attack', { 
        attacker: attackerPlayer, 
        row: row, 
        col: col, 
        targetPlayer: defenderPlayer,
        targetRow: row,
        targetCol: blocker ? blockerCol : -1,
        isFlying: fly,
        isShooter: attacker.abilities.includes('shooter')
    });
    await sleep(600);
    
    if (!blocker) {
        defenderState.hp -= attacker.atk;
        log(`⚔️ ${attacker.name} → ${defenderState.heroName} (-${attacker.atk})`, 'damage');
        emitAnimation(room, 'heroHit', { defender: defenderPlayer, damage: attacker.atk });
        io.to(room.code).emit('directDamage', { defender: defenderPlayer, damage: attacker.atk });
        emitStateToBoth(room);
        await sleep(600);
        return;
    }
    
    blocker.currentHp -= attacker.atk;
    log(`⚔️ ${attacker.name} → ${blocker.name} (-${attacker.atk})`, 'damage');
    emitAnimation(room, 'damage', { player: defenderPlayer, row: row, col: blockerCol, amount: attacker.atk });
    
    if (blocker.canAttack && blocker.currentHp > 0) {
        await sleep(500);
        attacker.currentHp -= blocker.atk;
        log(`↩️ ${blocker.name} riposte (-${blocker.atk})`, 'damage');
        emitAnimation(room, 'counterAttack', { player: defenderPlayer, row: row, col: blockerCol });
        await sleep(400);
        emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: col, amount: blocker.atk });
    }
    
    emitStateToBoth(room);
    await sleep(600);
    
    if (blocker.currentHp <= 0) {
        defenderState.graveyard.push(blocker);
        defenderField[row][blockerCol] = null;
        log(`☠️ ${blocker.name} détruit!`, 'damage');
        emitAnimation(room, 'death', { player: defenderPlayer, row: row, col: blockerCol });
        await sleep(400);
    }
    if (attacker.currentHp <= 0) {
        room.gameState.players[attackerPlayer].graveyard.push(attacker);
        room.gameState.players[attackerPlayer].field[row][col] = null;
        log(`☠️ ${attacker.name} détruit!`, 'damage');
        emitAnimation(room, 'death', { player: attackerPlayer, row: row, col: col });
        await sleep(400);
    }
    emitStateToBoth(room);
    await sleep(500);
}

function startNewTurn(room) {
    room.gameState.turn++;
    room.gameState.phase = 'planning';
    room.gameState.timeLeft = TURN_TIME;
    
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        player.maxEnergy = Math.min(10, player.maxEnergy + 1);
        player.energy = player.maxEnergy;
        resetPlayerForNewTurn(player);
    }
    
    io.to(room.code).emit('newTurn', { 
        turn: room.gameState.turn, 
        maxEnergy: room.gameState.players[1].maxEnergy 
    });
    
    emitStateToBoth(room);
    startTurnTimer(room);
}

function canPlaceAt(card, col) {
    const shooter = card.abilities?.includes('shooter');
    const fly = card.abilities?.includes('fly');
    if (fly) return true;
    if (shooter) return col === 0;
    return col === 1;
}

// ==================== SOCKET HANDLERS ====================
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);
    
    socket.on('createRoom', (callback) => {
        const code = generateRoomCode();
        const room = { code, players: { 1: socket.id, 2: null }, gameState: createGameState(), timer: null };
        room.gameState.players[1].connected = true;
        
        resetPlayerForNewTurn(room.gameState.players[1]);
        resetPlayerForNewTurn(room.gameState.players[2]);
        
        rooms.set(code, room);
        playerRooms.set(socket.id, { code, playerNum: 1 });
        socket.join(code);
        callback({ success: true, code, playerNum: 1 });
        console.log(`Room ${code} created`);
    });
    
    socket.on('joinRoom', (code, callback) => {
        const room = rooms.get(code.toUpperCase());
        if (!room) { callback({ success: false, error: 'Partie introuvable' }); return; }
        if (room.players[2]) { callback({ success: false, error: 'Partie complète' }); return; }
        
        room.players[2] = socket.id;
        room.gameState.players[2].connected = true;
        playerRooms.set(socket.id, { code: room.code, playerNum: 2 });
        socket.join(room.code);
        callback({ success: true, code: room.code, playerNum: 2 });
        
        io.to(room.players[1]).emit('gameStart', getPublicGameState(room, 1));
        io.to(room.players[2]).emit('gameStart', getPublicGameState(room, 2));
        
        startTurnTimer(room);
        console.log(`Room ${room.code} started`);
    });
    
    socket.on('placeCard', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready) return;
        
        const { handIndex, row, col } = data;
        if (handIndex < 0 || handIndex >= player.hand.length) return;
        
        const card = player.hand[handIndex];
        if (!card || card.type !== 'creature' || card.cost > player.energy) return;
        if (player.field[row][col]) return;
        if (!canPlaceAt(card, col)) return;
        
        player.energy -= card.cost;
        const placed = { 
            ...card, 
            turnsOnField: 0, 
            canAttack: card.abilities?.includes('haste'), 
            currentHp: card.hp, 
            movedThisTurn: false 
        };
        player.field[row][col] = placed;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;
        
        player.pendingActions.push({ type: 'place', card: deepClone(placed), row, col });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('moveCard', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready || player.inDeployPhase) return;
        
        const { fromRow, fromCol, toRow, toCol } = data;
        const card = player.field[fromRow][fromCol];
        if (!card || card.movedThisTurn) return;
        if (player.field[toRow][toCol]) return;
        
        if (fromCol !== toCol) return;
        if (Math.abs(toRow - fromRow) !== 1) return;
        if (!canPlaceAt(card, toCol)) return;
        
        card.movedThisTurn = true;
        // Redéploiement = comme si la créature venait d'être posée
        // Elle ne peut plus attaquer sauf si elle a célérité
        if (!card.abilities?.includes('haste')) {
            card.canAttack = false;
            card.turnsOnField = 0;
        }
        player.field[toRow][toCol] = card;
        player.field[fromRow][fromCol] = null;
        
        player.pendingActions.push({ type: 'move', card: deepClone(card), fromRow, fromCol, toRow, toCol });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('castSpell', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready) return;
        
        const { handIndex, targetPlayer, row, col } = data;
        if (handIndex < 0 || handIndex >= player.hand.length) return;
        
        const spell = player.hand[handIndex];
        if (!spell || spell.type !== 'spell' || spell.cost > player.energy) return;
        if (row < 0 || row > 3 || col < 0 || col > 1) return;
        
        player.energy -= spell.cost;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;
        
        player.pendingActions.push({ type: 'spell', spell: deepClone(spell), targetPlayer, row, col });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('placeTrap', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready) return;
        
        const { handIndex, trapIndex } = data;
        if (handIndex < 0 || handIndex >= player.hand.length) return;
        
        const trap = player.hand[handIndex];
        if (!trap || trap.type !== 'trap' || trap.cost > player.energy) return;
        if (player.traps[trapIndex]) return;
        
        player.energy -= trap.cost;
        player.traps[trapIndex] = trap;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;
        
        player.pendingActions.push({ type: 'trap', trap: deepClone(trap), row: trapIndex });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('ready', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        if (room.gameState.players[info.playerNum].ready) return;
        
        room.gameState.players[info.playerNum].ready = true;
        io.to(room.code).emit('playerReady', info.playerNum);
        
        checkBothReady(room);
    });
    
    socket.on('disconnect', () => {
        const info = playerRooms.get(socket.id);
        if (info) {
            const room = rooms.get(info.code);
            if (room) {
                room.gameState.players[info.playerNum].connected = false;
                io.to(room.code).emit('playerDisconnected', info.playerNum);
                setTimeout(() => {
                    if (room && !room.gameState.players[info.playerNum].connected) {
                        if (room.timer) clearInterval(room.timer);
                        rooms.delete(info.code);
                    }
                }, 60000);
            }
            playerRooms.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Server on http://localhost:${PORT}`));
