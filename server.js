const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

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
        { id: 'fireball', name: 'Boule de feu', damage: 3, cost: 2, type: 'spell', offensive: true, icon: '🔥' },
        { id: 'heal', name: 'Soin', heal: 3, cost: 1, type: 'spell', offensive: false, icon: '💚' },
        { id: 'shield', name: 'Bouclier', shield: 2, cost: 1, type: 'spell', offensive: false, icon: '🛡️' },
        { id: 'lightning', name: 'Éclair', damage: 2, cost: 1, type: 'spell', offensive: true, icon: '⚡' }
    ],
    traps: [
        { id: 'spike', name: 'Piques', damage: 2, cost: 1, type: 'trap', icon: '📌' },
        { id: 'poison', name: 'Poison', damage: 1, cost: 1, type: 'trap', icon: '☠️' },
        { id: 'stun', name: 'Paralysie', cost: 2, type: 'trap', effect: 'stun', icon: '💫' },
        { id: 'counter', name: 'Riposte', damage: 2, cost: 2, type: 'trap', icon: '↩️' }
    ]
};

const rooms = new Map();
const playerRooms = new Map();
const TURN_TIME = 90;

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createDeck() {
    const deck = [];
    for (let i = 0; i < 60; i++) {
        const r = Math.random();
        let pool = r < 0.65 ? CardDB.creatures : r < 0.85 ? CardDB.spells : CardDB.traps;
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
        ready: false,
        connected: false
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

function getPublicGameState(room, forPlayer) {
    const state = room.gameState;
    const opponent = forPlayer === 1 ? 2 : 1;
    
    return {
        turn: state.turn,
        phase: state.phase,
        timeLeft: state.timeLeft,
        myPlayer: forPlayer,
        me: {
            hp: state.players[forPlayer].hp,
            energy: state.players[forPlayer].energy,
            maxEnergy: state.players[forPlayer].maxEnergy,
            hand: state.players[forPlayer].hand,
            deckCount: state.players[forPlayer].deck.length,
            field: state.players[forPlayer].field,
            traps: state.players[forPlayer].traps,
            ready: state.players[forPlayer].ready
        },
        opponent: {
            hp: state.players[opponent].hp,
            energy: state.players[opponent].energy,
            maxEnergy: state.players[opponent].maxEnergy,
            handCount: state.players[opponent].hand.length,
            deckCount: state.players[opponent].deck.length,
            field: state.players[opponent].field,
            trapsCount: state.players[opponent].traps.filter(t => t !== null).length,
            ready: state.players[opponent].ready
        }
    };
}

function startTurnTimer(room) {
    if (room.timer) clearInterval(room.timer);
    room.gameState.timeLeft = TURN_TIME;
    room.gameState.phase = 'planning';
    
    // Reset ready states
    room.gameState.players[1].ready = false;
    room.gameState.players[2].ready = false;
    
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

async function startResolution(room) {
    if (room.timer) clearInterval(room.timer);
    room.gameState.phase = 'resolution';
    
    io.to(room.code).emit('phaseChange', 'resolution');
    
    const log = (msg, type) => {
        io.to(room.code).emit('resolutionLog', { msg, type });
    };
    
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const emitState = () => {
        if (room.players[1]) io.to(room.players[1]).emit('gameStateUpdate', getPublicGameState(room, 1));
        if (room.players[2]) io.to(room.players[2]).emit('gameStateUpdate', getPublicGameState(room, 2));
    };
    
    log(`⚔️ RÉSOLUTION DU TOUR ${room.gameState.turn}`, 'phase');
    await sleep(500);
    
    // 1. Pioche
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        if (player.deck.length > 0) {
            const card = player.deck.pop();
            if (card.type === 'creature') {
                card.currentHp = card.hp;
                card.canAttack = false;
                card.turnsOnField = 0;
            }
            player.hand.push(card);
        }
    }
    log('📦 Les joueurs piochent une carte', 'action');
    emitState();
    await sleep(400);
    
    // 2. Combat
    log('⚔️ Phase de combat', 'phase');
    await sleep(300);
    
    for (let row = 0; row < 4; row++) {
        for (let col = 1; col >= 0; col--) {
            await processCombat(room, 1, row, col, log, emitState);
            await processCombat(room, 2, row, col, log, emitState);
        }
    }
    
    // 3. Activer cartes pour prochain tour
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
    
    // Victoire ?
    const p1hp = room.gameState.players[1].hp;
    const p2hp = room.gameState.players[2].hp;
    
    if (p1hp <= 0 || p2hp <= 0) {
        await sleep(500);
        const winner = p1hp <= 0 ? 2 : 1;
        log(`🏆 JOUEUR ${winner} GAGNE!`, 'phase');
        io.to(room.code).emit('gameOver', { winner });
        return;
    }
    
    await sleep(800);
    startNewTurn(room);
}

async function processCombat(room, ap, row, col, log, emitState) {
    const attacker = room.gameState.players[ap].field[row][col];
    if (!attacker || !attacker.canAttack) return;
    
    const dp = ap === 1 ? 2 : 1;
    const df = room.gameState.players[dp].field[row][0];
    const db = room.gameState.players[dp].field[row][1];
    
    const fly = attacker.abilities.includes('fly');
    
    let blocker = null, bc = -1;
    if (df && (!fly || df.abilities.includes('fly') || df.abilities.includes('shooter'))) { blocker = df; bc = 0; }
    if (!blocker && db && (!fly || db.abilities.includes('fly') || db.abilities.includes('shooter'))) { blocker = db; bc = 1; }
    
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    // Piège
    const trap = room.gameState.players[dp].traps[row];
    if (trap && !blocker) {
        log(`🪤 Piège "${trap.name}" sur ${attacker.name}!`, 'trap');
        if (trap.damage) {
            attacker.currentHp -= trap.damage;
        }
        if (trap.effect === 'stun') {
            attacker.stunned = true;
        }
        room.gameState.players[dp].traps[row] = null;
        emitState();
        await sleep(300);
        
        if (attacker.currentHp <= 0) {
            room.gameState.players[ap].field[row][col] = null;
            log(`☠️ ${attacker.name} détruit par piège!`, 'damage');
            emitState();
            return;
        }
        if (attacker.stunned) { delete attacker.stunned; return; }
    }
    
    if (!blocker) {
        room.gameState.players[dp].hp -= attacker.atk;
        log(`⚔️ ${attacker.name} → Héros J${dp} (-${attacker.atk})`, 'damage');
        io.to(room.code).emit('directDamage', { defender: dp, damage: attacker.atk });
        emitState();
        await sleep(400);
        return;
    }
    
    blocker.currentHp -= attacker.atk;
    log(`⚔️ ${attacker.name} → ${blocker.name} (-${attacker.atk})`, 'damage');
    
    if (blocker.canAttack && blocker.currentHp > 0) {
        attacker.currentHp -= blocker.atk;
        log(`↩️ ${blocker.name} riposte (-${blocker.atk})`, 'damage');
    }
    
    emitState();
    await sleep(300);
    
    if (blocker.currentHp <= 0) {
        room.gameState.players[dp].field[row][bc] = null;
        log(`☠️ ${blocker.name} détruit!`, 'damage');
    }
    if (attacker.currentHp <= 0) {
        room.gameState.players[ap].field[row][col] = null;
        log(`☠️ ${attacker.name} détruit!`, 'damage');
    }
    emitState();
    await sleep(200);
}

function startNewTurn(room) {
    room.gameState.turn++;
    
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        player.maxEnergy = Math.min(10, player.maxEnergy + 1);
        player.energy = player.maxEnergy;
        player.ready = false; // IMPORTANT: reset ready
        
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                if (player.field[r][c]) {
                    player.field[r][c].movedThisTurn = false;
                }
            }
        }
    }
    
    room.gameState.phase = 'planning';
    room.gameState.timeLeft = TURN_TIME;
    
    // Emit new turn FIRST
    io.to(room.code).emit('newTurn', { 
        turn: room.gameState.turn, 
        maxEnergy: room.gameState.players[1].maxEnergy 
    });
    
    // Then emit updated state
    if (room.players[1]) io.to(room.players[1]).emit('gameStateUpdate', getPublicGameState(room, 1));
    if (room.players[2]) io.to(room.players[2]).emit('gameStateUpdate', getPublicGameState(room, 2));
    
    // Start timer AFTER emitting
    startTurnTimer(room);
}

// ==================== SOCKET HANDLERS ====================
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);
    
    socket.on('createRoom', (callback) => {
        const code = generateRoomCode();
        const room = { code, players: { 1: socket.id, 2: null }, gameState: createGameState(), timer: null };
        room.gameState.players[1].connected = true;
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
        if (room.gameState.players[info.playerNum].ready) return;
        
        const player = room.gameState.players[info.playerNum];
        const { handIndex, row, col } = data;
        const card = player.hand[handIndex];
        if (!card || card.type !== 'creature' || card.cost > player.energy || player.field[row][col]) return;
        
        const back = col === 1, shooter = card.abilities?.includes('shooter'), fly = card.abilities?.includes('fly');
        if (back && !fly && !shooter) return;
        if (col === 0 && shooter && !fly) return;
        
        player.energy -= card.cost;
        const placed = { ...card, turnsOnField: 0, canAttack: card.abilities?.includes('haste'), currentHp: card.hp, movedThisTurn: false };
        player.field[row][col] = placed;
        player.hand.splice(handIndex, 1);
        
        socket.emit('gameStateUpdate', getPublicGameState(room, info.playerNum));
        // Also update opponent view
        const oppNum = info.playerNum === 1 ? 2 : 1;
        if (room.players[oppNum]) {
            io.to(room.players[oppNum]).emit('gameStateUpdate', getPublicGameState(room, oppNum));
        }
    });
    
    socket.on('moveCard', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        if (room.gameState.players[info.playerNum].ready) return;
        
        const player = room.gameState.players[info.playerNum];
        const { fromRow, fromCol, toRow, toCol } = data;
        const card = player.field[fromRow][fromCol];
        if (!card || card.movedThisTurn || player.field[toRow][toCol]) return;
        
        const rd = Math.abs(toRow - fromRow), cd = Math.abs(toCol - fromCol);
        if (!(rd === 1 && cd === 0) && !(rd === 0 && cd === 1 && card.abilities?.includes('fly'))) return;
        
        const back = toCol === 1, shooter = card.abilities?.includes('shooter'), fly = card.abilities?.includes('fly');
        if (back && !fly && !shooter) return;
        if (toCol === 0 && shooter && !fly) return;
        
        card.movedThisTurn = true;
        player.field[toRow][toCol] = card;
        player.field[fromRow][fromCol] = null;
        
        socket.emit('gameStateUpdate', getPublicGameState(room, info.playerNum));
        const oppNum = info.playerNum === 1 ? 2 : 1;
        if (room.players[oppNum]) {
            io.to(room.players[oppNum]).emit('gameStateUpdate', getPublicGameState(room, oppNum));
        }
    });
    
    socket.on('castSpell', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        if (room.gameState.players[info.playerNum].ready) return;
        
        const player = room.gameState.players[info.playerNum];
        const { handIndex, targetPlayer, row, col } = data;
        const spell = player.hand[handIndex];
        if (!spell || spell.type !== 'spell' || spell.cost > player.energy) return;
        
        const target = room.gameState.players[targetPlayer].field[row][col];
        if (!target) return; // Spell needs a target
        
        player.energy -= spell.cost;
        
        // Apply spell effect immediately (or queue it)
        if (spell.offensive && spell.damage) {
            target.currentHp -= spell.damage;
            if (target.currentHp <= 0) {
                room.gameState.players[targetPlayer].field[row][col] = null;
            }
        }
        if (!spell.offensive && spell.heal) {
            target.currentHp = Math.min(target.hp, target.currentHp + spell.heal);
        }
        
        player.hand.splice(handIndex, 1);
        
        socket.emit('gameStateUpdate', getPublicGameState(room, info.playerNum));
        const oppNum = info.playerNum === 1 ? 2 : 1;
        if (room.players[oppNum]) {
            io.to(room.players[oppNum]).emit('gameStateUpdate', getPublicGameState(room, oppNum));
        }
    });
    
    socket.on('placeTrap', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        if (room.gameState.players[info.playerNum].ready) return;
        
        const player = room.gameState.players[info.playerNum];
        const { handIndex, trapIndex } = data;
        const trap = player.hand[handIndex];
        if (!trap || trap.type !== 'trap' || trap.cost > player.energy || player.traps[trapIndex]) return;
        
        player.energy -= trap.cost;
        player.traps[trapIndex] = trap;
        player.hand.splice(handIndex, 1);
        
        socket.emit('gameStateUpdate', getPublicGameState(room, info.playerNum));
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
