const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Game configuration
// ---------------------------------------------------------------------------

const PLAYER_CONFIG = {
  2: { lives: 2, stars: 1, levels: 12 },
  3: { lives: 3, stars: 1, levels: 10 },
  4: { lives: 4, stars: 1, levels: 8 }
};

const MAX_LIVES = 5;
const MAX_STARS = 3;

// After completing a level, check for rewards
// Levels 2,5,8 give +1 star; levels 3,6,9 give +1 life
const STAR_REWARD_LEVELS = new Set([2, 5, 8]);
const LIFE_REWARD_LEVELS = new Set([3, 6, 9]);

// ---------------------------------------------------------------------------
// Room / game state
// ---------------------------------------------------------------------------

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(hostSocket, nickname) {
  const code = generateRoomCode();
  const room = {
    code,
    players: [],
    state: 'lobby', // lobby | playing | between_levels | game_over | game_won
    level: 0,
    lives: 0,
    stars: 0,
    deck: [],
    playedCards: [],
    lastPlayedCard: 0,
    shurikenProposer: null,
    shurikenVotes: new Map(),
    shurikenActive: false,
    levelConfig: null
  };
  rooms.set(code, room);
  addPlayer(room, hostSocket, nickname, true);
  return room;
}

function addPlayer(room, socket, nickname, isHost) {
  const player = {
    id: socket.id,
    nickname: nickname || `Player ${room.players.length + 1}`,
    hand: [],
    isHost,
    connected: true
  };
  room.players.push(player);
  socket.join(room.code);
  socket.roomCode = room.code;
  socket.playerId = socket.id;
  return player;
}

function removePlayer(room, socketId) {
  const idx = room.players.findIndex(p => p.id === socketId);
  if (idx === -1) return;

  room.players.splice(idx, 1);

  // If room is empty, delete it
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  // If host left, assign new host
  if (!room.players.some(p => p.isHost)) {
    room.players[0].isHost = true;
  }
}

// ---------------------------------------------------------------------------
// Deck helpers
// ---------------------------------------------------------------------------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDeck() {
  const deck = [];
  for (let i = 1; i <= 100; i++) deck.push(i);
  return shuffle(deck);
}

// ---------------------------------------------------------------------------
// Game logic
// ---------------------------------------------------------------------------

function startGame(room) {
  const playerCount = room.players.length;
  const config = PLAYER_CONFIG[playerCount];
  if (!config) return false;

  room.levelConfig = config;
  room.lives = config.lives;
  room.stars = config.stars;
  room.level = 0;
  room.state = 'playing';
  room.playedCards = [];
  room.lastPlayedCard = 0;

  startLevel(room);
  return true;
}

function startLevel(room) {
  room.level++;
  room.deck = createDeck();
  room.playedCards = [];
  room.lastPlayedCard = 0;
  room.shurikenProposer = null;
  room.shurikenVotes = new Map();
  room.shurikenActive = false;

  const cardsPerPlayer = room.level;

  // Deal cards
  for (const player of room.players) {
    player.hand = [];
    for (let i = 0; i < cardsPerPlayer; i++) {
      player.hand.push(room.deck.pop());
    }
    player.hand.sort((a, b) => a - b);
  }

  room.state = 'playing';
}

function playCard(room, playerId, card) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { success: false, reason: 'Player not found' };
  if (room.state !== 'playing') return { success: false, reason: 'Not in playing state' };
  if (room.shurikenActive) return { success: false, reason: 'Shuriken vote in progress' };

  const cardIdx = player.hand.indexOf(card);
  if (cardIdx === -1) return { success: false, reason: 'Card not in hand' };

  // Remove card from hand
  player.hand.splice(cardIdx, 1);

  // Check if any other player has a lower card
  const lowerCards = [];
  for (const p of room.players) {
    for (const c of p.hand) {
      if (c < card) {
        lowerCards.push({ playerId: p.id, nickname: p.nickname, card: c });
      }
    }
  }

  // Place card on pile
  room.playedCards.push({ card, playerId, nickname: player.nickname });
  room.lastPlayedCard = card;

  if (lowerCards.length > 0) {
    // Mistake! Discard all lower cards from all players
    for (const lc of lowerCards) {
      const p = room.players.find(pl => pl.id === lc.playerId);
      if (p) {
        const lcIdx = p.hand.indexOf(lc.card);
        if (lcIdx !== -1) {
          p.hand.splice(lcIdx, 1);
          room.playedCards.push({ card: lc.card, playerId: p.id, nickname: p.nickname, discarded: true });
        }
      }
    }

    // Update last played card to highest of all discarded + played
    const allPlayed = room.playedCards.map(c => c.card);
    room.lastPlayedCard = Math.max(...allPlayed);

    // Lose a life
    room.lives--;

    if (room.lives <= 0) {
      room.state = 'game_over';
      return { success: true, mistake: true, lowerCards, gameOver: true };
    }

    // Check if level is complete after discarding
    const allHandsEmpty = room.players.every(p => p.hand.length === 0);
    if (allHandsEmpty) {
      return { success: true, mistake: true, lowerCards, levelComplete: true };
    }

    return { success: true, mistake: true, lowerCards };
  }

  // No mistake — check if level is complete
  const allHandsEmpty = room.players.every(p => p.hand.length === 0);
  if (allHandsEmpty) {
    return { success: true, levelComplete: true };
  }

  return { success: true };
}

function completeLevelAndReward(room) {
  const level = room.level;
  let reward = null;

  if (STAR_REWARD_LEVELS.has(level) && room.stars < MAX_STARS) {
    room.stars++;
    reward = 'star';
  } else if (LIFE_REWARD_LEVELS.has(level) && room.lives < MAX_LIVES) {
    room.lives++;
    reward = 'life';
  }

  // Check if game is won
  if (room.level >= room.levelConfig.levels) {
    room.state = 'game_won';
    return { won: true, reward };
  }

  room.state = 'between_levels';
  return { won: false, reward };
}

// ---------------------------------------------------------------------------
// Shuriken (throwing star) logic
// ---------------------------------------------------------------------------

function proposeShuriken(room, playerId) {
  if (room.state !== 'playing') return { success: false, reason: 'Not in playing state' };
  if (room.stars <= 0) return { success: false, reason: 'No stars available' };
  if (room.shurikenActive) return { success: false, reason: 'Vote already in progress' };

  // Check that the proposer has cards in hand
  const proposer = room.players.find(p => p.id === playerId);
  if (!proposer || proposer.hand.length === 0) return { success: false, reason: 'You have no cards' };

  room.shurikenActive = true;
  room.shurikenProposer = playerId;
  room.shurikenVotes = new Map();

  // Players with cards must vote; players with no cards auto-agree
  for (const p of room.players) {
    if (p.hand.length === 0) {
      room.shurikenVotes.set(p.id, true);
    }
  }

  // Proposer auto-agrees
  room.shurikenVotes.set(playerId, true);

  return { success: true };
}

function voteShuriken(room, playerId, agree) {
  if (!room.shurikenActive) return { success: false, reason: 'No vote in progress' };

  const player = room.players.find(p => p.id === playerId);
  if (!player) return { success: false, reason: 'Player not found' };

  room.shurikenVotes.set(playerId, agree);

  // Check if someone disagreed
  if (!agree) {
    room.shurikenActive = false;
    room.shurikenProposer = null;
    room.shurikenVotes = new Map();
    return { success: true, resolved: true, used: false, declinedBy: player.nickname };
  }

  // Check if all players with cards have voted
  const playersWithCards = room.players.filter(p => p.hand.length > 0);
  const allVoted = playersWithCards.every(p => room.shurikenVotes.has(p.id));

  if (!allVoted) {
    return { success: true, resolved: false };
  }

  // All agreed — use the star
  const allAgreed = playersWithCards.every(p => room.shurikenVotes.get(p.id) === true);

  if (allAgreed) {
    room.stars--;
    const discardedCards = [];

    // Each player discards their lowest card
    for (const p of room.players) {
      if (p.hand.length > 0) {
        const lowest = p.hand.shift(); // hand is sorted, so first is lowest
        discardedCards.push({ playerId: p.id, nickname: p.nickname, card: lowest });
        room.playedCards.push({ card: lowest, playerId: p.id, nickname: p.nickname, discarded: true });
      }
    }

    // Update last played card
    const allPlayed = room.playedCards.map(c => c.card);
    room.lastPlayedCard = Math.max(...allPlayed);

    room.shurikenActive = false;
    room.shurikenProposer = null;
    room.shurikenVotes = new Map();

    // Check if level is complete
    const allHandsEmpty = room.players.every(p => p.hand.length === 0);

    return { success: true, resolved: true, used: true, discardedCards, levelComplete: allHandsEmpty };
  }

  // Shouldn't reach here since we handle disagree above, but just in case
  room.shurikenActive = false;
  room.shurikenProposer = null;
  room.shurikenVotes = new Map();
  return { success: true, resolved: true, used: false };
}

// ---------------------------------------------------------------------------
// Helper: build game state for a specific player
// ---------------------------------------------------------------------------

function getGameStateForPlayer(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  return {
    code: room.code,
    state: room.state,
    level: room.level,
    totalLevels: room.levelConfig ? room.levelConfig.levels : 0,
    lives: room.lives,
    stars: room.stars,
    maxLives: MAX_LIVES,
    maxStars: MAX_STARS,
    lastPlayedCard: room.lastPlayedCard,
    playedCards: room.playedCards,
    hand: player ? player.hand : [],
    players: room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      isHost: p.isHost,
      connected: p.connected,
      cardCount: p.hand.length
    })),
    shurikenActive: room.shurikenActive,
    shurikenProposer: room.shurikenProposer,
    shurikenVotes: Object.fromEntries(room.shurikenVotes),
    myId: playerId
  };
}

function getLobbyState(room) {
  return {
    code: room.code,
    state: room.state,
    players: room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      isHost: p.isHost,
      connected: p.connected
    }))
  };
}

// ---------------------------------------------------------------------------
// Socket.io events
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {

  // ---- Create room ----
  socket.on('create_room', ({ nickname }, callback) => {
    const room = createRoom(socket, nickname);
    callback({ success: true, roomCode: room.code, lobby: getLobbyState(room) });
  });

  // ---- Join room ----
  socket.on('join_room', ({ roomCode, nickname }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) return callback({ success: false, reason: 'Room not found' });
    if (room.state !== 'lobby') return callback({ success: false, reason: 'Game already in progress' });
    if (room.players.length >= 4) return callback({ success: false, reason: 'Room is full' });

    // Check for duplicate nickname
    const nickTrimmed = (nickname || '').trim();
    if (room.players.some(p => p.nickname.toLowerCase() === nickTrimmed.toLowerCase())) {
      return callback({ success: false, reason: 'Nickname already taken in this room' });
    }

    addPlayer(room, socket, nickTrimmed);

    const lobby = getLobbyState(room);
    callback({ success: true, roomCode: code, lobby });

    // Notify others
    socket.to(code).emit('lobby_update', lobby);
  });

  // ---- Start game ----
  socket.on('start_game', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return callback({ success: false, reason: 'Room not found' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return callback({ success: false, reason: 'Only the host can start' });
    if (room.players.length < 2) return callback({ success: false, reason: 'Need at least 2 players' });
    if (room.state !== 'lobby') return callback({ success: false, reason: 'Game already started' });

    const ok = startGame(room);
    if (!ok) return callback({ success: false, reason: 'Invalid player count' });

    callback({ success: true });

    // Send each player their own game state
    for (const p of room.players) {
      io.to(p.id).emit('game_state', getGameStateForPlayer(room, p.id));
    }
  });

  // ---- Play card ----
  socket.on('play_card', ({ card }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return callback({ success: false, reason: 'Room not found' });

    const result = playCard(room, socket.id, card);
    if (!result.success) return callback(result);

    callback({ success: true });

    if (result.gameOver) {
      for (const p of room.players) {
        io.to(p.id).emit('game_state', getGameStateForPlayer(room, p.id));
      }
      io.to(room.code).emit('game_event', {
        type: 'game_over',
        message: 'No lives remaining. Game over!'
      });
      return;
    }

    if (result.mistake) {
      // Broadcast mistake info
      const player = room.players.find(p => p.id === socket.id);
      io.to(room.code).emit('game_event', {
        type: 'mistake',
        card,
        playedBy: player ? player.nickname : 'Unknown',
        lowerCards: result.lowerCards,
        livesRemaining: room.lives
      });
    } else {
      const player = room.players.find(p => p.id === socket.id);
      io.to(room.code).emit('game_event', {
        type: 'card_played',
        card,
        playedBy: player ? player.nickname : 'Unknown'
      });
    }

    if (result.levelComplete) {
      const levelResult = completeLevelAndReward(room);

      io.to(room.code).emit('game_event', {
        type: 'level_complete',
        level: room.level - (levelResult.won ? 0 : 0),
        reward: levelResult.reward,
        won: levelResult.won
      });
    }

    // Send updated state to everyone
    for (const p of room.players) {
      io.to(p.id).emit('game_state', getGameStateForPlayer(room, p.id));
    }
  });

  // ---- Next level ----
  socket.on('next_level', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return callback({ success: false, reason: 'Room not found' });
    if (room.state !== 'between_levels') return callback({ success: false, reason: 'Not between levels' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return callback({ success: false, reason: 'Only the host can advance' });

    startLevel(room);
    callback({ success: true });

    for (const p of room.players) {
      io.to(p.id).emit('game_state', getGameStateForPlayer(room, p.id));
    }
  });

  // ---- Propose shuriken ----
  socket.on('propose_shuriken', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return callback({ success: false, reason: 'Room not found' });

    const result = proposeShuriken(room, socket.id);
    if (!result.success) return callback(result);

    callback({ success: true });

    const player = room.players.find(p => p.id === socket.id);
    io.to(room.code).emit('game_event', {
      type: 'shuriken_proposed',
      proposer: player ? player.nickname : 'Unknown',
      proposerId: socket.id
    });

    // Check if it auto-resolved (e.g. 2-player and proposer is the only one with cards)
    const playersWithCards = room.players.filter(p => p.hand.length > 0);
    const allVoted = playersWithCards.every(p => room.shurikenVotes.has(p.id));

    if (allVoted) {
      handleShurikenResolution(room);
    } else {
      for (const p of room.players) {
        io.to(p.id).emit('game_state', getGameStateForPlayer(room, p.id));
      }
    }
  });

  // ---- Vote shuriken ----
  socket.on('vote_shuriken', ({ agree }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return callback({ success: false, reason: 'Room not found' });

    const result = voteShuriken(room, socket.id, agree);
    if (!result.success) return callback(result);

    callback({ success: true });

    if (result.resolved) {
      handleShurikenResolution(room, result);
    } else {
      for (const p of room.players) {
        io.to(p.id).emit('game_state', getGameStateForPlayer(room, p.id));
      }
    }
  });

  // ---- Return to lobby ----
  socket.on('return_to_lobby', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return callback({ success: false, reason: 'Room not found' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return callback({ success: false, reason: 'Only the host can do this' });

    room.state = 'lobby';
    room.level = 0;
    room.playedCards = [];
    room.lastPlayedCard = 0;
    room.shurikenActive = false;
    room.shurikenProposer = null;
    room.shurikenVotes = new Map();
    for (const p of room.players) {
      p.hand = [];
    }

    callback({ success: true });
    io.to(room.code).emit('lobby_update', getLobbyState(room));
    io.to(room.code).emit('return_to_lobby');
  });

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    if (room.state === 'lobby') {
      removePlayer(room, socket.id);
      if (rooms.has(room.code)) {
        io.to(room.code).emit('lobby_update', getLobbyState(room));
      }
    } else {
      // Mid-game: mark disconnected
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.connected = false;

        // If all players disconnected, delete room
        if (room.players.every(p => !p.connected)) {
          rooms.delete(room.code);
          return;
        }

        // If player had cards and was part of a shuriken vote, auto-decline
        if (room.shurikenActive && !room.shurikenVotes.has(socket.id)) {
          const result = voteShuriken(room, socket.id, false);
          if (result.resolved) {
            handleShurikenResolution(room, result);
            return;
          }
        }

        // Discard disconnected player's cards (treat as played in order)
        if (player.hand.length > 0) {
          for (const card of player.hand) {
            room.playedCards.push({ card, playerId: player.id, nickname: player.nickname, discarded: true });
          }
          // Check for mistakes from remaining players
          const highestDiscarded = Math.max(...player.hand);
          for (const p of room.players) {
            if (p.id === player.id) continue;
            const lowerCards = p.hand.filter(c => c < highestDiscarded);
            // We don't penalize for these — disconnection is penalty enough
          }
          room.lastPlayedCard = Math.max(room.lastPlayedCard, ...player.hand);
          player.hand = [];

          // Lose a life for the disconnect
          room.lives--;
          if (room.lives <= 0) {
            room.state = 'game_over';
            io.to(room.code).emit('game_event', {
              type: 'game_over',
              message: `${player.nickname} disconnected. No lives remaining. Game over!`
            });
          } else {
            io.to(room.code).emit('game_event', {
              type: 'player_disconnected',
              nickname: player.nickname,
              livesRemaining: room.lives
            });

            // Check if level is complete
            const allHandsEmpty = room.players.every(p => p.hand.length === 0);
            if (allHandsEmpty) {
              const levelResult = completeLevelAndReward(room);
              io.to(room.code).emit('game_event', {
                type: 'level_complete',
                reward: levelResult.reward,
                won: levelResult.won
              });
            }
          }
        }

        // Reassign host if needed
        if (player.isHost) {
          player.isHost = false;
          const newHost = room.players.find(p => p.connected);
          if (newHost) newHost.isHost = true;
        }

        for (const p of room.players) {
          if (p.connected) {
            io.to(p.id).emit('game_state', getGameStateForPlayer(room, p.id));
          }
        }
      }
    }
  });
});

function handleShurikenResolution(room, result) {
  if (!result) {
    // Resolve from current vote state
    const playersWithCards = room.players.filter(p => p.hand.length > 0);
    const allAgreed = playersWithCards.every(p => room.shurikenVotes.get(p.id) === true);

    if (allAgreed) {
      room.stars--;
      const discardedCards = [];
      for (const p of room.players) {
        if (p.hand.length > 0) {
          const lowest = p.hand.shift();
          discardedCards.push({ playerId: p.id, nickname: p.nickname, card: lowest });
          room.playedCards.push({ card: lowest, playerId: p.id, nickname: p.nickname, discarded: true });
        }
      }
      room.lastPlayedCard = Math.max(room.lastPlayedCard, ...discardedCards.map(c => c.card));
      room.shurikenActive = false;
      room.shurikenProposer = null;
      room.shurikenVotes = new Map();

      result = { resolved: true, used: true, discardedCards };

      // Check level complete
      const allHandsEmpty = room.players.every(p => p.hand.length === 0);
      if (allHandsEmpty) {
        result.levelComplete = true;
      }
    }
  }

  if (result.used) {
    io.to(room.code).emit('game_event', {
      type: 'shuriken_used',
      discardedCards: result.discardedCards
    });

    if (result.levelComplete) {
      const levelResult = completeLevelAndReward(room);
      io.to(room.code).emit('game_event', {
        type: 'level_complete',
        reward: levelResult.reward,
        won: levelResult.won
      });
    }
  } else {
    io.to(room.code).emit('game_event', {
      type: 'shuriken_declined',
      declinedBy: result.declinedBy || 'Someone'
    });
  }

  for (const p of room.players) {
    io.to(p.id).emit('game_state', getGameStateForPlayer(room, p.id));
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`The Mind server running on http://localhost:${PORT}`);
});
