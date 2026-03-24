/* ================================================================
   THE MIND — Client
   ================================================================ */

const socket = io();

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const screenLobby = $('#screen-lobby');
const screenGame = $('#screen-game');

// Lobby
const lobbyMenu = $('#lobby-menu');
const lobbyRoom = $('#lobby-room');
const nicknameInput = $('#nickname-input');
const roomCodeInput = $('#room-code-input');
const btnCreate = $('#btn-create');
const btnJoinToggle = $('#btn-join-toggle');
const joinSection = $('#join-section');
const btnJoin = $('#btn-join');
const lobbyError = $('#lobby-error');
const roomCodeValue = $('#room-code-value');
const btnCopyCode = $('#btn-copy-code');
const playersList = $('#players-list');
const btnStart = $('#btn-start');
const roomStatus = $('#room-status');

// Game
const gameLevel = $('#game-level');
const gameTotalLevels = $('#game-total-levels');
const gameLives = $('#game-lives');
const gameStars = $('#game-stars');
const playersBar = $('#players-bar');
const btnHistory = $('#btn-history');
const historyPanel = $('#history-panel');
const btnCloseHistory = $('#btn-close-history');
const historyList = $('#history-list');
const pileCard = $('#pile-card');
const pileCardValue = $('#pile-card-value');
const gameMessage = $('#game-message');
const btnShuriken = $('#btn-shuriken');
const shurikenStatus = $('#shuriken-status');
const shurikenVoteOverlay = $('#shuriken-vote-overlay');
const shurikenProposerText = $('#shuriken-proposer-text');
const shurikenVoteStatus = $('#shuriken-vote-status');
const shurikenVoteButtons = $('#shuriken-vote-buttons');
const btnShurikenAgree = $('#btn-shuriken-agree');
const btnShurikenDecline = $('#btn-shuriken-decline');
const shurikenRevealOverlay = $('#shuriken-reveal-overlay');
const shurikenRevealCards = $('#shuriken-reveal-cards');
const btnCloseReveal = $('#btn-close-reveal');
const hand = $('#hand');
const levelCompleteOverlay = $('#level-complete-overlay');
const levelCompleteTitle = $('#level-complete-title');
const levelCompleteReward = $('#level-complete-reward');
const btnNextLevel = $('#btn-next-level');
const levelCompleteWait = $('#level-complete-wait');
const gameOverOverlay = $('#game-over-overlay');
const gameOverTitle = $('#game-over-title');
const gameOverMessage = $('#game-over-message');
const btnReturnLobby = $('#btn-return-lobby');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let gameState = null;
let myId = null;
let isHost = false;
let messageTimeout = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function showScreen(screen) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

function showError(msg) {
  lobbyError.textContent = msg;
  lobbyError.classList.remove('hidden');
  setTimeout(() => lobbyError.classList.add('hidden'), 4000);
}

function hideAllOverlays() {
  shurikenVoteOverlay.classList.add('hidden');
  shurikenRevealOverlay.classList.add('hidden');
  levelCompleteOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  historyPanel.classList.add('hidden');
}

function showGameMessage(msg, type, duration) {
  if (messageTimeout) clearTimeout(messageTimeout);
  gameMessage.textContent = msg;
  gameMessage.className = 'game-message';
  if (type) gameMessage.classList.add(type);
  if (duration) {
    messageTimeout = setTimeout(() => {
      gameMessage.textContent = '';
      gameMessage.className = 'game-message';
    }, duration);
  }
}

// ---------------------------------------------------------------------------
// Lobby events
// ---------------------------------------------------------------------------

btnCreate.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    showError('Please enter a nickname');
    nicknameInput.focus();
    return;
  }
  btnCreate.disabled = true;
  socket.emit('create_room', { nickname }, (res) => {
    btnCreate.disabled = false;
    if (res.success) {
      enterLobbyRoom(res.lobby, true);
    } else {
      showError(res.reason);
    }
  });
});

btnJoinToggle.addEventListener('click', () => {
  joinSection.classList.toggle('hidden');
  if (!joinSection.classList.contains('hidden')) {
    roomCodeInput.focus();
  }
});

btnJoin.addEventListener('click', () => joinRoom());
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (!joinSection.classList.contains('hidden') && roomCodeInput.value.trim()) {
      joinRoom();
    } else {
      btnCreate.click();
    }
  }
});

function joinRoom() {
  const nickname = nicknameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!nickname) {
    showError('Please enter a nickname');
    nicknameInput.focus();
    return;
  }
  if (!code || code.length < 8) {
    showError('Please enter a valid room code');
    roomCodeInput.focus();
    return;
  }
  btnJoin.disabled = true;
  socket.emit('join_room', { roomCode: code, nickname }, (res) => {
    btnJoin.disabled = false;
    if (res.success) {
      enterLobbyRoom(res.lobby, false);
    } else {
      showError(res.reason);
    }
  });
}

function enterLobbyRoom(lobby, hosting) {
  lobbyMenu.classList.add('hidden');
  lobbyRoom.classList.remove('hidden');
  roomCodeValue.textContent = lobby.code;
  isHost = hosting;
  myId = socket.id;
  updateLobbyPlayers(lobby);
}

function updateLobbyPlayers(lobby) {
  playersList.innerHTML = '';
  let amHost = false;
  for (const p of lobby.players) {
    const li = document.createElement('li');
    li.textContent = p.nickname;
    if (p.id === socket.id) {
      li.textContent += ' (you)';
      if (p.isHost) amHost = true;
    }
    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'player-host-badge';
      badge.textContent = 'HOST';
      li.appendChild(badge);
    }
    playersList.appendChild(li);
  }

  isHost = amHost;

  if (isHost) {
    btnStart.classList.toggle('hidden', lobby.players.length < 2);
    roomStatus.textContent = lobby.players.length < 2
      ? 'Need at least 2 players to start'
      : '';
  } else {
    btnStart.classList.add('hidden');
    roomStatus.textContent = 'Waiting for host to start...';
  }
}

btnCopyCode.addEventListener('click', () => {
  const code = roomCodeValue.textContent;
  const copyIcon = document.getElementById('copy-icon');
  const checkIcon = document.getElementById('check-icon');
  navigator.clipboard.writeText(code).then(() => {
    copyIcon.classList.add('hidden');
    checkIcon.classList.remove('hidden');
    setTimeout(() => {
      checkIcon.classList.add('hidden');
      copyIcon.classList.remove('hidden');
    }, 1500);
  }).catch(() => {
    const range = document.createRange();
    range.selectNode(roomCodeValue);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
});

btnStart.addEventListener('click', () => {
  btnStart.disabled = true;
  socket.emit('start_game', null, (res) => {
    btnStart.disabled = false;
    if (!res.success) showError(res.reason);
  });
});

// Lobby updates from server
socket.on('lobby_update', (lobby) => {
  updateLobbyPlayers(lobby);
});

// ---------------------------------------------------------------------------
// Game state rendering
// ---------------------------------------------------------------------------

socket.on('game_state', (state) => {
  gameState = state;
  myId = state.myId;
  isHost = state.players.find(p => p.id === myId)?.isHost || false;

  showScreen(screenGame);
  renderGame();
});

function renderGame() {
  const s = gameState;
  if (!s) return;

  // Header
  gameLevel.textContent = s.level;
  gameTotalLevels.textContent = '/' + s.totalLevels;

  // Lives (hearts)
  gameLives.innerHTML = '';
  for (let i = 0; i < s.maxLives; i++) {
    const span = document.createElement('span');
    span.textContent = i < s.lives ? '♥' : '♡';
    span.style.color = i < s.lives ? 'var(--life-color)' : 'var(--text-muted)';
    gameLives.appendChild(span);
  }

  // Stars
  gameStars.innerHTML = '';
  for (let i = 0; i < s.maxStars; i++) {
    const span = document.createElement('span');
    span.textContent = i < s.stars ? '★' : '☆';
    span.style.color = i < s.stars ? 'var(--star-color)' : 'var(--text-muted)';
    gameStars.appendChild(span);
  }

  // Players bar — 2 columns, current user first
  playersBar.innerHTML = '';
  const mePlayer = s.players.find(p => p.id === myId);
  const otherPlayersList = s.players.filter(p => p.id !== myId);
  const allOrdered = mePlayer ? [mePlayer, ...otherPlayersList] : [...otherPlayersList];

  // Build rows of 2
  for (let i = 0; i < allOrdered.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'players-bar-row';
    for (let j = i; j < i + 2 && j < allOrdered.length; j++) {
      const p = allOrdered[j];
      const div = document.createElement('div');
      let cls = 'player-bar-item';
      if (p.id === myId) cls += ' is-me';
      if (!p.connected) cls += ' disconnected';
      div.className = cls;
      const youTag = p.id === myId ? ' <span style="font-size:0.65rem;opacity:0.5">(you)</span>' : '';
      const count = p.id === myId ? s.hand.length : p.cardCount;
      div.innerHTML = `
        <span class="player-bar-name">${escapeHtml(p.nickname)}${youTag}</span>
        <span class="player-bar-cards"><span class="player-bar-card-count">${count}</span> cards</span>
      `;
      row.appendChild(div);
    }
    playersBar.appendChild(row);
  }

  // Update history panel if open
  renderHistory(s.playedCards);

  // Pile card
  if (s.lastPlayedCard > 0) {
    pileCard.classList.remove('empty');
    pileCardValue.textContent = s.lastPlayedCard;
  } else {
    pileCard.classList.add('empty');
    pileCardValue.textContent = '—';
  }

  // Shuriken button
  btnShuriken.disabled = s.stars <= 0 || s.shurikenActive || s.state !== 'playing' || s.hand.length === 0;

  // Hand
  renderHand(s.hand);

  // Shuriken vote overlay
  if (s.shurikenActive && s.state === 'playing') {
    shurikenVoteOverlay.classList.remove('hidden');

    const proposer = s.players.find(p => p.id === s.shurikenProposer);
    shurikenProposerText.textContent = proposer
      ? `${proposer.nickname} wants to use a throwing star`
      : 'Someone wants to use a throwing star';

    // Render vote status
    shurikenVoteStatus.innerHTML = '';
    const playersWithCards = s.players.filter(p => p.cardCount > 0);
    for (const p of playersWithCards) {
      const div = document.createElement('div');
      div.className = 'vote-player';
      const voted = s.shurikenVotes[p.id] !== undefined;
      const agreed = s.shurikenVotes[p.id] === true;
      let statusClass = 'vote-waiting';
      let statusIcon = '⏳';
      if (voted && agreed) { statusClass = 'vote-agreed'; statusIcon = '✓'; }
      else if (voted && !agreed) { statusClass = 'vote-declined'; statusIcon = '✗'; }
      div.innerHTML = `
        <span>${escapeHtml(p.nickname)}${p.id === myId ? ' (you)' : ''}</span>
        <span class="vote-icon ${statusClass}">${statusIcon}</span>
      `;
      shurikenVoteStatus.appendChild(div);
    }

    // Show vote buttons only if I haven't voted and I have cards
    const myPlayer = s.players.find(p => p.id === myId);
    const iHaveCards = myPlayer && myPlayer.cardCount > 0;
    const iVoted = s.shurikenVotes[myId] !== undefined;
    shurikenVoteButtons.classList.toggle('hidden', !iHaveCards || iVoted);
  } else {
    shurikenVoteOverlay.classList.add('hidden');
  }

  // Level complete overlay
  if (s.state === 'between_levels') {
    levelCompleteOverlay.classList.remove('hidden');
    levelCompleteTitle.textContent = `Level ${s.level} Complete!`;

    if (isHost) {
      btnNextLevel.classList.remove('hidden');
      levelCompleteWait.classList.add('hidden');
    } else {
      btnNextLevel.classList.add('hidden');
      levelCompleteWait.classList.remove('hidden');
    }
  } else {
    levelCompleteOverlay.classList.add('hidden');
  }

  // Game over overlay
  if (s.state === 'game_over') {
    gameOverOverlay.classList.remove('hidden');
    gameOverTitle.textContent = 'Game Over';
    gameOverTitle.className = '';
    gameOverMessage.textContent = `You reached level ${s.level} of ${s.totalLevels}`;
    btnReturnLobby.classList.toggle('hidden', !isHost);
  } else if (s.state === 'game_won') {
    gameOverOverlay.classList.remove('hidden');
    gameOverTitle.textContent = 'You Won!';
    gameOverTitle.className = 'game-won-title';
    gameOverMessage.textContent = `All ${s.totalLevels} levels completed!`;
    btnReturnLobby.classList.toggle('hidden', !isHost);
  } else {
    gameOverOverlay.classList.add('hidden');
  }
}

function renderHand(cards) {
  // Only re-render if cards changed
  const currentCards = Array.from(hand.children).map(c => parseInt(c.dataset.card));
  const same = cards.length === currentCards.length && cards.every((c, i) => c === currentCards[i]);
  if (same) return;

  hand.innerHTML = '';
  const lowest = cards.length > 0 ? cards[0] : null; // hand is sorted ascending
  cards.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'card dealing';
    if (card !== lowest) div.classList.add('locked');
    div.dataset.card = card;
    div.textContent = card;
    div.style.animationDelay = `${i * 0.05}s`;
    div.addEventListener('click', () => playCardAction(card));
    hand.appendChild(div);
  });
}

function playCardAction(card) {
  if (!gameState || gameState.state !== 'playing' || gameState.shurikenActive) return;

  // Only the lowest card can be played
  if (gameState.hand.length > 0 && card !== gameState.hand[0]) return;

  const cardEl = hand.querySelector(`[data-card="${card}"]`);
  if (cardEl) {
    cardEl.classList.add('played');
  }

  socket.emit('play_card', { card }, (res) => {
    if (!res.success) {
      // Restore card visual
      if (cardEl) cardEl.classList.remove('played');
      showGameMessage(res.reason, 'mistake-msg', 2000);
    }
  });
}

// ---------------------------------------------------------------------------
// Game events (messages, animations)
// ---------------------------------------------------------------------------

socket.on('game_event', (event) => {
  switch (event.type) {
    case 'card_played':
      pileCard.classList.remove('mistake');
      showGameMessage(`${event.playedBy} played ${event.card}`, null, 2000);
      // Quick pulse on pile
      pileCard.classList.add('pulse');
      setTimeout(() => pileCard.classList.remove('pulse'), 600);
      break;

    case 'mistake':
      pileCard.classList.add('mistake');
      setTimeout(() => pileCard.classList.remove('mistake'), 1000);
      const lostCards = event.lowerCards.map(lc => `${lc.nickname}:${lc.card}`).join(', ');
      showGameMessage(
        `${event.playedBy} played ${event.card} — lost cards: ${lostCards}. Lives: ${event.livesRemaining}`,
        'mistake-msg',
        4000
      );
      // Vibrate on mobile if available
      if (navigator.vibrate) navigator.vibrate(200);
      break;

    case 'level_complete': {
      let rewardText = '';
      if (event.reward === 'star') rewardText = 'Reward: +1 Throwing Star ★';
      else if (event.reward === 'life') rewardText = 'Reward: +1 Life ♥';
      else rewardText = 'No reward this level.';
      levelCompleteReward.textContent = rewardText;

      if (event.won) {
        levelCompleteTitle.textContent = 'You Won!';
        levelCompleteTitle.className = 'game-won-title';
        levelCompleteReward.textContent = 'You completed all levels!';
        btnNextLevel.classList.add('hidden');
        levelCompleteWait.textContent = '';
      }
      break;
    }

    case 'game_over':
      showGameMessage(event.message, 'mistake-msg', 0);
      break;

    case 'shuriken_proposed':
      showGameMessage(`${event.proposer} wants to use a throwing star`, null, 0);
      break;

    case 'shuriken_used':
      shurikenVoteOverlay.classList.add('hidden');
      showShurikenReveal(event.discardedCards);
      break;

    case 'shuriken_declined':
      shurikenVoteOverlay.classList.add('hidden');
      showGameMessage(`${event.declinedBy} declined the throwing star`, null, 2000);
      break;

    case 'player_disconnected':
      showGameMessage(`${event.nickname} disconnected. Lives: ${event.livesRemaining}`, 'mistake-msg', 3000);
      if (navigator.vibrate) navigator.vibrate(100);
      break;
  }
});

// ---------------------------------------------------------------------------
// Shuriken voting
// ---------------------------------------------------------------------------

btnShuriken.addEventListener('click', () => {
  socket.emit('propose_shuriken', null, (res) => {
    if (!res.success) {
      showGameMessage(res.reason, 'mistake-msg', 2000);
    }
  });
});

btnShurikenAgree.addEventListener('click', () => {
  socket.emit('vote_shuriken', { agree: true }, (res) => {
    if (!res.success) showGameMessage(res.reason, 'mistake-msg', 2000);
  });
});

btnShurikenDecline.addEventListener('click', () => {
  socket.emit('vote_shuriken', { agree: false }, (res) => {
    if (!res.success) showGameMessage(res.reason, 'mistake-msg', 2000);
  });
});

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

btnHistory.addEventListener('click', () => {
  historyPanel.classList.toggle('hidden');
  if (!historyPanel.classList.contains('hidden') && gameState) {
    renderHistory(gameState.playedCards);
  }
});

btnCloseHistory.addEventListener('click', () => {
  historyPanel.classList.add('hidden');
});

function renderHistory(playedCards) {
  if (!playedCards || historyPanel.classList.contains('hidden')) return;

  historyList.innerHTML = '';

  if (playedCards.length === 0) {
    historyList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:0.85rem;">No cards played yet</div>';
    return;
  }

  // Show in chronological order (newest at top)
  for (let i = playedCards.length - 1; i >= 0; i--) {
    const pc = playedCards[i];
    const div = document.createElement('div');
    div.className = 'history-entry ' + (pc.discarded ? 'discarded' : 'played');
    div.innerHTML = `
      <span class="history-card-num">${pc.card}</span>
      <span class="history-player-name">${escapeHtml(pc.nickname)}</span>
      ${pc.discarded ? '<span class="history-badge">lost</span>' : ''}
    `;
    historyList.appendChild(div);
  }
}

// ---------------------------------------------------------------------------
// Shuriken reveal
// ---------------------------------------------------------------------------

function showShurikenReveal(discardedCards) {
  // Sort lowest to highest
  const sorted = [...discardedCards].sort((a, b) => a.card - b.card);

  shurikenRevealCards.innerHTML = '';
  shurikenRevealOverlay.classList.remove('hidden');

  sorted.forEach((dc, i) => {
    const row = document.createElement('div');
    row.className = 'reveal-card-row';
    row.style.animationDelay = `${i * 0.5}s`;
    row.innerHTML = `
      <div class="reveal-card-value">${dc.card}</div>
      <span class="reveal-card-name">${escapeHtml(dc.nickname)}</span>
    `;
    shurikenRevealCards.appendChild(row);
  });
}

btnCloseReveal.addEventListener('click', () => {
  shurikenRevealOverlay.classList.add('hidden');
});

// ---------------------------------------------------------------------------
// Next level / return to lobby
// ---------------------------------------------------------------------------

btnNextLevel.addEventListener('click', () => {
  btnNextLevel.disabled = true;
  socket.emit('next_level', null, (res) => {
    btnNextLevel.disabled = false;
    if (!res.success) showGameMessage(res.reason, 'mistake-msg', 2000);
  });
});

btnReturnLobby.addEventListener('click', () => {
  socket.emit('return_to_lobby', null, (res) => {
    if (!res.success) showGameMessage(res.reason, 'mistake-msg', 2000);
  });
});

socket.on('return_to_lobby', () => {
  gameState = null;
  hideAllOverlays();
  showScreen(screenLobby);
  lobbyMenu.classList.add('hidden');
  lobbyRoom.classList.remove('hidden');
});

// ---------------------------------------------------------------------------
// Reconnection
// ---------------------------------------------------------------------------

socket.on('disconnect', () => {
  showGameMessage('Connection lost. Reconnecting...', 'mistake-msg', 0);
});

socket.on('connect', () => {
  // If we were in a game, the server-side state is gone for this socket.
  // Show a message to rejoin.
  if (gameState) {
    gameState = null;
    hideAllOverlays();
    showScreen(screenLobby);
    lobbyMenu.classList.remove('hidden');
    lobbyRoom.classList.add('hidden');
    showError('Disconnected from game. Please rejoin.');
  }
});

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
