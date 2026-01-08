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
        { id: 'hawk', name: 'Faucon', atk: 2, hp: 2, cost: 3, abilities: ['fly'], type: 'creature', icon: '🦅' },
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
    
    // Collecter les slots qui vont recevoir des créatures (pour les bloquer côté client)
    const summonSlots = allActions.places.map(a => ({ player: a.playerNum, row: a.row, col: a.col }));
    
    // Informer le client des slots à bloquer AVANT tout
    if (summonSlots.length > 0) {
        io.to(room.code).emit('blockSlots', summonSlots);
        await sleep(50);
    }
    
    // 1. REDÉPLOIEMENTS
    if (allActions.moves.length > 0) {
        log('🔄 Redéploiements', 'phase');
        await sleep(600);
        
        for (const action of allActions.moves) {
            log(`  ↔️ ${action.heroName}: ${action.card.name} ${slotNames[action.fromRow][action.fromCol]} → ${slotNames[action.toRow][action.toCol]}`, 'action');
            emitAnimation(room, 'move', { 
                player: action.playerNum, 
                fromRow: action.fromRow, 
                fromCol: action.fromCol, 
                toRow: action.toRow, 
                toCol: action.toCol,
                card: action.card
            });
            await sleep(100);
            emitStateToBoth(room);
            await sleep(700);
        }
    }
    
    // 2. POSES DE CRÉATURES 
    if (allActions.places.length > 0) {
        log('🎴 Invocations', 'phase');
        await sleep(600);
        
        for (const action of allActions.places) {
            log(`  🎴 ${action.heroName}: ${action.card.name} en ${slotNames[action.row][action.col]}`, 'action');
            emitAnimation(room, 'summon', { player: action.playerNum, row: action.row, col: action.col, card: action.card, animateForOpponent: true });
            await sleep(100);
            emitStateToBoth(room);
            await sleep(700);
        }
    } else if (allActions.moves.length === 0) {
        emitStateToBoth(room);
    }
    
    await sleep(300);
    
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
            await sleep(600);
        }
        emitStateToBoth(room);
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
    
    // 7. PHASE DE COMBAT dans l'ordre: A > B > C > D > E > F > G > H
    // A = row0/col0, B = row0/col1, C = row1/col0, D = row1/col1, etc.
    log('⚔️ Phase de combat', 'phase');
    await sleep(800);
    
    // D'abord résoudre tous les pièges par rangée
    for (let row = 0; row < 4; row++) {
        await processTrapsForRow(room, row, log, sleep);
    }
    
    // Ensuite résoudre le combat dans l'ordre des lettres
    // Ordre: A(r0c0) -> B(r0c1) -> C(r1c0) -> D(r1c1) -> E(r2c0) -> F(r2c1) -> G(r3c0) -> H(r3c1)
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 2; col++) {
            await processCombatSlot(room, row, col, log, sleep);
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

// Résoudre les pièges pour une rangée (avant le combat)
async function processTrapsForRow(room, row, log, sleep) {
    for (let attackerPlayer = 1; attackerPlayer <= 2; attackerPlayer++) {
        const defenderPlayer = attackerPlayer === 1 ? 2 : 1;
        const defenderState = room.gameState.players[defenderPlayer];
        const trap = defenderState.traps[row];
        
        if (!trap) continue;
        
        // Trouver les créatures qui vont attaquer sur cette rangée
        const attackerState = room.gameState.players[attackerPlayer];
        const attackers = [];
        
        for (let col = 0; col < 2; col++) {
            const card = attackerState.field[row][col];
            if (card && card.canAttack) {
                // Vérifier que cette créature va bien attaquer dans la direction du piège
                const target = findTarget(card, 
                    defenderState.field[row][1], 
                    defenderState.field[row][0], 
                    defenderPlayer,
                    row);
                
                // Le piège se déclenche si la créature attaque (même le héros)
                if (target) {
                    attackers.push({ card, col });
                }
            }
        }
        
        // Déclencher le piège sur le premier attaquant trouvé
        if (attackers.length > 0) {
            const firstAttacker = attackers[0];
            
            emitAnimation(room, 'trapTrigger', { player: defenderPlayer, row: row, trap: trap });
            await sleep(700);
            
            log(`🪤 Piège "${trap.name}" déclenché sur ${firstAttacker.card.name}!`, 'trap');
            
            if (trap.damage) {
                firstAttacker.card.currentHp -= trap.damage;
                emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: firstAttacker.col, amount: trap.damage });
                await sleep(500);
            }
            
            const wasStunned = trap.effect === 'stun';
            if (wasStunned) {
                log(`  💫 ${firstAttacker.card.name} est paralysé!`, 'trap');
                firstAttacker.card.canAttack = false; // Ne peut plus attaquer ce tour
            }
            
            // Mettre le piège au cimetière
            defenderState.graveyard.push(trap);
            defenderState.traps[row] = null;
            
            emitStateToBoth(room);
            await sleep(500);
            
            // Vérifier si la créature meurt du piège
            if (firstAttacker.card.currentHp <= 0) {
                attackerState.graveyard.push(firstAttacker.card);
                attackerState.field[row][firstAttacker.col] = null;
                log(`  ☠️ ${firstAttacker.card.name} détruit par le piège!`, 'damage');
                emitAnimation(room, 'death', { player: attackerPlayer, row: row, col: firstAttacker.col });
                emitStateToBoth(room);
                await sleep(600);
            }
        }
    }
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
        // Le sort croix touche le CENTRE + les 4 cases adjacentes
        const adjacentTargets = getCrossTargets(action.targetPlayer, action.row, action.col);
        
        // Ajouter le centre comme première cible
        const allTargets = [
            { row: action.row, col: action.col, player: action.targetPlayer },
            ...adjacentTargets
        ];
        
        log(`  ✝️ ${action.heroName}: ${spell.name} en croix sur ${slotNames[action.row][action.col]}!`, 'damage');
        
        // Appliquer les dégâts à toutes les cibles (centre + adjacents)
        for (const t of allTargets) {
            const targetField = t.player === playerNum ? player.field : opponent.field;
            const target = targetField[t.row][t.col];
            
            // Animation de dégâts seulement (pas de spell pour chaque case)
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
        }
        await sleep(400);
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

// Combat pour un slot spécifique - chaque créature attaque sa cible
// Riposte uniquement si la cible ne peut pas attaquer ce tour ET l'attaquant n'est pas un tireur
async function processCombatSlot(room, row, col, log, sleep) {
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
    const slotLetter = slotNames[row][col];
    
    const p1State = room.gameState.players[1];
    const p2State = room.gameState.players[2];
    
    const p1Card = p1State.field[row][col];
    const p2Card = p2State.field[row][col];
    
    // Collecter les attaques de ce slot
    const attacks = [];
    
    // Créature du joueur 1 à ce slot
    if (p1Card && p1Card.canAttack) {
        const target = findTarget(p1Card, p2State.field[row][1], p2State.field[row][0], 2, row);
        if (target) {
            attacks.push({
                attacker: p1Card,
                attackerPlayer: 1,
                attackerRow: row,
                attackerCol: col,
                target: target.card,
                targetPlayer: 2,
                targetRow: target.row !== undefined ? target.row : row,
                targetCol: target.col,
                targetIsHero: target.isHero
            });
        }
    }
    
    // Créature du joueur 2 à ce slot
    if (p2Card && p2Card.canAttack) {
        const target = findTarget(p2Card, p1State.field[row][1], p1State.field[row][0], 1, row);
        if (target) {
            attacks.push({
                attacker: p2Card,
                attackerPlayer: 2,
                attackerRow: row,
                attackerCol: col,
                target: target.card,
                targetPlayer: 1,
                targetRow: target.row !== undefined ? target.row : row,
                targetCol: target.col,
                targetIsHero: target.isHero
            });
        }
    }
    
    if (attacks.length === 0) return;
    
    // Animer les attaques
    for (const atk of attacks) {
        emitAnimation(room, 'attack', {
            attacker: atk.attackerPlayer,
            row: atk.attackerRow,
            col: atk.attackerCol,
            targetPlayer: atk.targetPlayer,
            targetRow: atk.targetRow,
            targetCol: atk.targetIsHero ? -1 : atk.targetCol,
            isFlying: atk.attacker.abilities.includes('fly'),
            isShooter: atk.attacker.abilities.includes('shooter')
        });
    }
    await sleep(500);
    
    // Calculer les dégâts
    const damages = [];
    
    for (const atk of attacks) {
        if (atk.targetIsHero) {
            damages.push({
                type: 'hero',
                player: atk.targetPlayer,
                amount: atk.attacker.atk,
                attackerName: atk.attacker.name,
                defenderName: room.gameState.players[atk.targetPlayer].heroName
            });
        } else if (atk.target) {
            damages.push({
                type: 'creature',
                player: atk.targetPlayer,
                row: atk.targetRow,
                col: atk.targetCol,
                amount: atk.attacker.atk,
                attackerName: atk.attacker.name,
                defenderName: atk.target.name
            });
            
            // RIPOSTE : seulement si la cible NE PEUT PAS attaquer ce tour
            // ET (l'attaquant N'EST PAS un tireur OU la cible EST un tireur)
            // => Les tireurs évitent la riposte SAUF si la cible est aussi un tireur
            const attackerIsShooter = atk.attacker.abilities.includes('shooter');
            const targetIsShooter = atk.target.abilities?.includes('shooter');
            const targetCanAttack = atk.target.canAttack;
            
            if (!targetCanAttack && (!attackerIsShooter || targetIsShooter)) {
                damages.push({
                    type: 'creature',
                    player: atk.attackerPlayer,
                    row: atk.attackerRow,
                    col: atk.attackerCol,
                    amount: atk.target.atk,
                    attackerName: atk.target.name,
                    defenderName: atk.attacker.name,
                    isRiposte: true
                });
            }
        }
    }
    
    // Appliquer les dégâts
    for (const dmg of damages) {
        if (dmg.type === 'hero') {
            room.gameState.players[dmg.player].hp -= dmg.amount;
            log(`⚔️ ${dmg.attackerName} → ${dmg.defenderName} (-${dmg.amount})`, 'damage');
            emitAnimation(room, 'heroHit', { defender: dmg.player, damage: dmg.amount });
            io.to(room.code).emit('directDamage', { defender: dmg.player, damage: dmg.amount });
        } else {
            const targetCard = room.gameState.players[dmg.player].field[dmg.row][dmg.col];
            if (targetCard) {
                targetCard.currentHp -= dmg.amount;
                if (dmg.isRiposte) {
                    log(`↩️ ${dmg.attackerName} riposte sur ${dmg.defenderName} (-${dmg.amount})`, 'damage');
                } else {
                    log(`⚔️ ${dmg.attackerName} → ${dmg.defenderName} (-${dmg.amount})`, 'damage');
                }
                emitAnimation(room, 'damage', { player: dmg.player, row: dmg.row, col: dmg.col, amount: dmg.amount });
            }
        }
    }
    
    emitStateToBoth(room);
    await sleep(400);
    
    // Vérifier les morts sur ce slot
    for (let p = 1; p <= 2; p++) {
        const card = room.gameState.players[p].field[row][col];
        if (card && card.currentHp <= 0) {
            room.gameState.players[p].graveyard.push(card);
            room.gameState.players[p].field[row][col] = null;
            log(`☠️ ${card.name} détruit!`, 'damage');
            emitAnimation(room, 'death', { player: p, row: row, col: col });
        }
    }
    
    // Vérifier aussi les cibles qui ne sont pas au même slot (ex: shooter qui tire sur la colonne d'à côté)
    for (const atk of attacks) {
        if (!atk.targetIsHero && atk.target && (atk.targetRow !== row || atk.targetCol !== col)) {
            const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
            if (targetCard && targetCard.currentHp <= 0) {
                room.gameState.players[atk.targetPlayer].graveyard.push(targetCard);
                room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol] = null;
                log(`☠️ ${targetCard.name} détruit!`, 'damage');
                emitAnimation(room, 'death', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol });
            }
        }
    }
    
    emitStateToBoth(room);
    await sleep(300);
}

async function processCombatRow(room, row, log, sleep) {
    // Fonction obsolète - gardée pour compatibilité
}

// Trouver la cible d'une créature
function findTarget(attacker, enemyFront, enemyBack, enemyPlayer, row) {
    const isFlying = attacker.abilities.includes('fly');
    const isShooter = attacker.abilities.includes('shooter');
    
    // CAS 1: Créature VOLANTE
    if (isFlying) {
        // Cherche un volant adverse à combattre
        if (enemyFront && enemyFront.abilities.includes('fly')) {
            return { card: enemyFront, col: 1, row: row, player: enemyPlayer, isHero: false };
        }
        if (enemyBack && enemyBack.abilities.includes('fly')) {
            return { card: enemyBack, col: 0, row: row, player: enemyPlayer, isHero: false };
        }
        // Sinon attaque le héros directement
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }
    
    // CAS 2: Créature TIREUR
    if (isShooter) {
        // Peut attaquer n'importe quelle créature (même volante)
        if (enemyFront) {
            return { card: enemyFront, col: 1, row: row, player: enemyPlayer, isHero: false };
        }
        if (enemyBack) {
            return { card: enemyBack, col: 0, row: row, player: enemyPlayer, isHero: false };
        }
        // Sinon attaque le héros
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }
    
    // CAS 3: Créature NORMALE
    // Les volants sont ignorés par les créatures normales
    const frontIsFlying = enemyFront && enemyFront.abilities.includes('fly');
    const backIsFlying = enemyBack && enemyBack.abilities.includes('fly');
    
    // Si front existe et n'est PAS volant → attaque front
    if (enemyFront && !frontIsFlying) {
        return { card: enemyFront, col: 1, row: row, player: enemyPlayer, isHero: false };
    }
    
    // Si front est volant (ou n'existe pas), cherche le back non-volant
    if (enemyBack && !backIsFlying) {
        return { card: enemyBack, col: 0, row: row, player: enemyPlayer, isHero: false };
    }
    
    // Sinon attaque le héros (passe au-dessus des volants ou rangée vide)
    return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
}

async function processCombat(room, attackerPlayer, row, col, log, sleep) {
    // Cette fonction n'est plus utilisée - gardée pour compatibilité
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
        
        const isFlying = card.abilities?.includes('fly');
        const isVerticalMove = (fromCol === toCol && Math.abs(toRow - fromRow) === 1);
        const isHorizontalMove = (fromRow === toRow && fromCol !== toCol);
        
        // Déplacement vertical: toutes les créatures
        // Déplacement horizontal: seulement les volants
        if (!isVerticalMove && !(isFlying && isHorizontalMove)) return;
        
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
