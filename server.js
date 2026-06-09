const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// rooms: Map<code, { players: [{id, name}], hostId: string }>
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function makeDeck() {
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const suits = ['♠','♥','♦','♣'];
  const d = [];
  for (const suit of suits) for (const rank of ranks) d.push({ rank, suit });
  return d;
}

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('lobbyUpdate', {
    players: room.players.map(p => p.name),
    hostName: room.players.find(p => p.id === room.hostId)?.name ?? ''
  });
}

io.on('connection', (socket) => {
  let roomCode = null;

  socket.on('createRoom', ({ name }) => {
    roomCode = makeCode();
    rooms.set(roomCode, { players: [{ id: socket.id, name }], hostId: socket.id, round: 0 });
    socket.join(roomCode);
    socket.emit('roomCreated', { code: roomCode });
    socket.emit('setHost', true);
    broadcast(roomCode);
  });

  socket.on('joinRoom', ({ code, name }) => {
    const key = code.toUpperCase().trim();
    const room = rooms.get(key);
    if (!room) { socket.emit('joinError', 'Room not found.'); return; }
    roomCode = key;
    room.players.push({ id: socket.id, name });
    socket.join(roomCode);
    socket.emit('joinedRoom', { code: roomCode });
    socket.emit('setHost', false);
    broadcast(roomCode);
  });

  socket.on('deal', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;
    room.round++;
    room.deck = shuffle(makeDeck());
    for (const player of room.players) {
      io.to(player.id).emit('cardsDealt', { cards: [room.deck.pop(), room.deck.pop()], round: room.round });
    }
  });

  socket.on('drawCard', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || !room.deck || room.deck.length === 0) return;
    socket.emit('cardDrawn', { card: room.deck.pop() });
  });

  socket.on('disconnect', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) { rooms.delete(roomCode); return; }
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
      io.to(room.hostId).emit('setHost', true);
    }
    broadcast(roomCode);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
