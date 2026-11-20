// Passa pelos handlers reais de net/gameServer.js usando sockets simulados em memória
// (sem rede): 4 jogadores simultâneos, desconexão, reconexão e erros de entrada.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameServer } from '../net/gameServer.js';

class FakeSocket {
  constructor(io, id) {
    this.io = io;
    this.id = id;
    this.data = {};
    this.handlers = new Map();
    this.inbox = [];
  }
  on(event, fn) {
    this.handlers.set(event, fn);
  }
  call(event, payload) {
    return new Promise((resolve) => this.handlers.get(event)(payload, resolve));
  }
  last(event) {
    return [...this.inbox].reverse().find((m) => m.ev === event)?.payload;
  }
  all(event) {
    return this.inbox.filter((m) => m.ev === event).map((m) => m.payload);
  }
  drop() {
    this.handlers.get('disconnect')?.();
    this.io.sockets.sockets.delete(this.id);
  }
}
class FakeIO {
  constructor() {
    this.sockets = { sockets: new Map() };
    this.onConnection = null;
  }
  on(event, fn) {
    if (event === 'connection') this.onConnection = fn;
  }
  connect(id) {
    const s = new FakeSocket(this, id);
    this.sockets.sockets.set(id, s);
    this.onConnection(s);
    return s;
  }
  to(id) {
    return { emit: (ev, payload) => this.sockets.sockets.get(id)?.inbox.push({ ev, payload }) };
  }
}

function boot(timings = {}) {
  const io = new FakeIO();
  const gs = createGameServer(io, { timings: { turnMs: 400, resultMs: 30, lobbyGraceMs: 40, hostGraceLobbyMs: 60, ...timings } });
  return { io, gs };
}

/** Host + 3 jogadores na mesma sala, prontos para iniciar. */
async function fullLobby(timings) {
  const { io, gs } = boot(timings);
  const host = io.connect('H');
  const created = await host.call('room:create', { nickname: 'Hostão' });
  assert.ok(created.ok, created.error);
  const code = created.code;
  const players = [];
  for (const name of ['Ana', 'Beto', 'Carla']) {
    const s = io.connect('S-' + name);
    const r = await s.call('room:join', { code: code.toLowerCase(), nickname: name }); // código aceita minúsculas
    assert.ok(r.ok, r.error);
    s.token = r.token;
    players.push(s);
  }
  await host.call('room:characters', { list: ['Homem-Aranha', 'Batman', 'Super-Homem', 'Goku'] });
  for (const [i, s] of players.entries()) assert.ok((await s.call('player:suggest', { text: ['Shrek', 'Mario', 'Sonic'][i] })).ok);
  return { io, gs, host, players, code, token: created.token };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('criar e entrar: todos veem os mesmos participantes e o host identificado', async () => {
  const { host, players } = await fullLobby();
  for (const s of [host, ...players]) {
    const st = s.last('state');
    assert.deepEqual(st.players.map((p) => p.nickname), ['Hostão', 'Ana', 'Beto', 'Carla']);
    assert.deepEqual(st.players.map((p) => p.isHost), [true, false, false, false]);
    assert.equal(st.phase, 'lobby');
  }
  assert.equal(host.last('state').you.isHost, true);
  assert.equal(players[0].last('state').you.isHost, false);
});

test('erros de entrada com mensagens claras', async () => {
  const { io, host, code } = await fullLobby();
  const s = io.connect('X');
  assert.equal((await s.call('room:join', { code: 'ZZZZ', nickname: 'Fulano' })).code, 'ROOM_NOT_FOUND');
  assert.equal((await s.call('room:join', { code: code, nickname: '' })).code, 'NICK_INVALID');
  assert.equal((await s.call('room:join', { code: code, nickname: 'ana' })).code, 'NICK_TAKEN');
  assert.equal((await s.call('room:create', { nickname: '#' })).code, 'NICK_INVALID');
  assert.equal(io.sockets.sockets.size, 5);
  await host.call('room:characters', { list: ['a1', 'b2', 'c3'] });
  await host.call('game:start', {});
  const r = await s.call('room:join', { code, nickname: 'Atrasado' });
  assert.equal(r.code, 'ROOM_STARTED'); // sala indisponível: já começou
});

test('sorteio igual para todos, nada vaza e cada um recebe um personagem', async () => {
  const { host, players } = await fullLobby();
  const r = await host.call('game:start', {});
  assert.ok(r.ok, r.error);
  const everyone = [host, ...players];
  const views = everyone.map((s) => s.last('state'));
  assert.ok(views.every((v) => v.phase === 'playing' && v.turn.playerId === views[0].turn.playerId));
  assert.ok(views.every((v) => v.turn.deadline === views[0].turn.deadline)); // mesmo cronômetro

  // visão de cada jogador sobre o personagem dos outros tem que ser idêntica
  const seen = (v, id) => v.players.find((p) => p.id === id).character;
  for (const target of views[0].players) {
    const answers = views.filter((v) => v.you.id !== target.id).map((v) => seen(v, target.id));
    assert.ok(answers[0]);
    assert.ok(answers.every((a) => a === answers[0]), 'jogadores veem personagens diferentes para o mesmo boneco');
    const own = views.find((v) => v.you.id === target.id);
    assert.equal(seen(own, target.id), null, 'jogador vê o próprio personagem');
  }
  const revealed = views[0].players.map((p) => p.character ?? seen(views[1], p.id)).filter(Boolean);
  assert.equal(new Set(revealed).size, revealed.length);

  // clique duplo em iniciar
  const again = await host.call('game:start', {});
  assert.equal(again.code, 'ALREADY_STARTED');
  assert.deepEqual(host.last('state').players.map((p) => p.character), views[0].players.map((p) => p.character));
});

test('só quem tem a vez age; chute errado sincroniza vidas; passar a vez vai à direita', async () => {
  const { host, players, io } = await fullLobby({ turnMs: 3000, resultMs: 40 });
  await host.call('game:start', {});
  const everyone = [host, ...players];
  const state = () => host.last('state');
  const cur = everyone.find((s) => s.last('state').you.id === state().turn.playerId);
  const other = everyone.find((s) => s !== cur);
  const turnId = state().turn.id;

  assert.equal((await other.call('turn:guess', { text: 'Qualquer Coisa', turnId })).code, 'NOT_YOUR_TURN');
  assert.equal((await other.call('turn:pass', { turnId })).code, 'NOT_YOUR_TURN');
  assert.equal((await cur.call('turn:pass', { turnId: turnId + 7 })).code, 'STALE_TURN');

  const wrong = await cur.call('turn:guess', { text: 'Nome Completamente Errado', turnId });
  assert.deepEqual([wrong.ok, wrong.correct, wrong.livesLeft], [true, false, 2]);
  assert.equal((await cur.call('turn:guess', { text: 'Outra Tentativa', turnId })).ok, false); // duplicado
  for (const s of everyone) {
    const me = s.last('state').players.find((p) => p.id === cur.last('state').you.id);
    assert.equal(me.lives, 2, 'vidas diferentes entre jogadores');
  }
  for (const s of everyone) assert.equal(s.all('game:event').filter((e) => e.type === 'wrong-guess').length, 1);

  await sleep(80);
  const seats = state().players.map((p) => p.id);
  const next = state().turn;
  assert.equal(next.playerId, seats[(seats.indexOf(cur.last('state').you.id) + 1) % 4]);
  const nextSock = everyone.find((s) => s.last('state').you.id === next.playerId);
  assert.ok((await nextSock.call('turn:pass', { turnId: next.id })).ok);
  assert.equal(host.last('state').turn.id, next.id + 1);
});

test('chute correto encerra a partida e revela todos para todos', async () => {
  const { host, players, io, gs } = await fullLobby({ turnMs: 3000 });
  await host.call('game:start', {});
  const everyone = [host, ...players];
  const room = [...gs.rooms.values()][0];
  const cur = everyone.find((s) => s.last('state').you.id === room.turn.playerId);
  const answer = room.byId(room.turn.playerId).character;
  const r = await cur.call('turn:guess', { text: answer.toUpperCase(), turnId: room.turn.id });
  assert.equal(r.correct, true);
  for (const s of everyone) {
    const v = s.last('state');
    assert.equal(v.phase, 'finished');
    assert.equal(v.result.winnerId, cur.last('state').you.id);
    assert.ok(v.players.every((p) => p.character));
  }
});

test('desconexão e reconexão: os outros veem o status e o cronômetro não reinicia', async () => {
  const { host, players, io } = await fullLobby({ turnMs: 3000 });
  await host.call('game:start', {});
  const deadline = host.last('state').turn.deadline;
  const victim = players[1];
  const myId = victim.last('state').you.id;

  victim.drop();
  assert.equal(host.last('state').players.find((p) => p.id === myId).connected, false);

  const again = io.connect('S-Beto-2');
  const res = await again.call('room:rejoin', { code: host.last('state').code, token: victim.token });
  assert.ok(res.ok, res.error);
  const st = again.last('state');
  assert.equal(st.you.id, myId);
  assert.equal(st.turn.deadline, deadline); // mesmo relógio
  assert.equal(st.players.find((p) => p.id === myId).character, null); // continua sem ver o próprio
  assert.equal(host.last('state').players.find((p) => p.id === myId).connected, true);
  assert.equal(host.last('state').players.length, 4); // sem duplicado

  const bad = await io.connect('Z').call('room:rejoin', { code: host.last('state').code, token: 'falso' });
  assert.equal(bad.code, 'SESSION_EXPIRED');
});

test('lobby: jogador que cai some da lista; host que sai encerra e a sala vira "encerrada"', async () => {
  const { io, host, players, code } = await fullLobby();
  players[2].drop();
  assert.equal(host.last('state').players.find((p) => p.nickname === 'Carla').connected, false);
  await sleep(90);
  assert.deepEqual(host.last('state').players.map((p) => p.nickname), ['Hostão', 'Ana', 'Beto']);

  await host.call('room:leave', {});
  assert.equal(players[0].last('room:closed').reason, 'host-left');
  assert.equal(host.last('room:closed'), undefined); // quem saiu não recebe o aviso
  const s = io.connect('late');
  assert.equal((await s.call('room:join', { code, nickname: 'Tarde' })).code, 'ROOM_CLOSED');
});

test('host desconectado no lobby: sem transferência; passado o prazo a sala fecha', async () => {
  const { host, players, gs, code } = await fullLobby({ hostGraceLobbyMs: 50 });
  host.drop();
  const st = players[0].last('state');
  assert.equal(st.players.find((p) => p.isHost).connected, false);
  assert.equal(players.filter((s) => s.last('state').you.isHost).length, 0); // ninguém virou host
  await sleep(90);
  assert.equal(players[0].last('room:closed').reason, 'host-timeout');
  assert.ok(!gs.rooms.has(code));
});

test('apenas o host configura; entradas inválidas não derrubam nada', async () => {
  const { host, players } = await fullLobby();
  assert.equal((await players[0].call('room:characters', { list: ['x'] })).code, 'NOT_HOST');
  assert.equal((await players[0].call('game:start', {})).code, 'NOT_HOST');
  assert.equal((await host.call('player:suggest', { text: 'Shrek' })).code, 'NOT_ALLOWED');
  assert.equal((await host.call('room:characters', { list: 'não é lista' })).ok, false);
  assert.equal((await host.call('room:characters', undefined)).ok, false);
  assert.equal((await players[0].call('turn:guess', null)).ok, false);
  assert.ok((await host.call('room:settings', { lives: 99 })).ok);
  assert.equal(host.last('state').settings.lives, 10);
});

test('sweep fecha salas abandonadas', async () => {
  const { host, players, gs, code } = await fullLobby();
  [host, ...players].forEach((s) => s.drop());
  const room = gs.rooms.get(code);
  room.lastActive = Date.now() - 11 * 60_000;
  gs.sweep();
  assert.ok(!gs.rooms.has(code));
  assert.equal(gs.closed.get(code).reason, 'abandoned');
});

test('bots pela rede: só o host adiciona/remove e todos veem a mesma lista', async () => {
  const { io } = boot();
  const host = io.connect('h');
  const guest = io.connect('g');
  const created = await host.call('room:create', { nickname: 'Hosty' });
  await guest.call('room:join', { code: created.code, nickname: 'Visitante' });

  const denied = await guest.call('room:addBot', {});
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'NOT_HOST');

  assert.equal((await host.call('room:addBot', {})).ok, true);
  assert.equal((await host.call('room:addBot', {})).ok, true);
  const seenByGuest = guest.last('state').players;
  assert.equal(seenByGuest.length, 4);
  assert.equal(seenByGuest.filter((p) => p.bot).length, 2);

  const botId = seenByGuest.find((p) => p.bot).id;
  assert.equal((await host.call('room:removeBot', { id: botId })).ok, true);
  assert.equal(guest.last('state').players.length, 3);
  assert.equal((await host.call('room:removeBot', { id: guest.last('state').you.id })).ok, false); // humano não sai por aqui
});

test('criar sala já com o modo CADA UM ESCOLHE e rejeitar modo inválido', async () => {
  const io = new FakeIO();
  createGameServer(io);
  const a = io.connect('a');
  const bad = await a.call('room:create', { nickname: 'Ana', mode: 'xyz' });
  assert.equal(bad.ok, false);
  const ok = await a.call('room:create', { nickname: 'Ana', mode: 'players' });
  assert.equal(ok.ok, true);
  assert.equal(a.last('state').settings.mode, 'players');
  const b = io.connect('b');
  await b.call('room:join', { code: ok.code, nickname: 'Beto' });
  assert.equal((await a.call('player:suggest', { text: 'Goku' })).ok, true); // o host escolhe também
  assert.equal((await b.call('player:suggest', { text: 'Naruto' })).ok, true);
  assert.equal((await a.call('game:start', {})).ok, true);
  const sa = a.last('state'), sb = b.last('state');
  assert.equal(sb.players.find((p) => p.nickname === 'Ana').character, 'Naruto');
  assert.equal(sa.players.find((p) => p.nickname === 'Beto').character, 'Goku');
});

test('modo CADA UM ESCOLHE VÁRIOS pela rede: criar, escolher até 3, iniciar', async () => {
  const io = new FakeIO();
  createGameServer(io);
  const a = io.connect('a');
  const ok = await a.call('room:create', { nickname: 'Ana', mode: 'multi' });
  assert.equal(ok.ok, true);
  const b = io.connect('b');
  await b.call('room:join', { code: ok.code, nickname: 'Beto' });
  assert.equal((await a.call('player:picks', { list: ['A', 'B', 'C', 'D'] })).ok, false);
  assert.equal((await a.call('player:picks', { list: ['Goku', 'Naruto', 'Luffy'] })).ok, true);
  assert.equal((await b.call('player:picks', { list: ['Batman'] })).ok, true);
  assert.equal(a.last('state').lobby.myPicks.length, 3);
  assert.equal((await a.call('game:start', {})).ok, true);
  assert.equal(b.last('state').players.find((p) => p.nickname === 'Ana').character, 'Batman'); // Ana recebe o sorteado do Beto
  assert.ok(['Goku', 'Naruto', 'Luffy'].includes(a.last('state').players.find((p) => p.nickname === 'Beto').character));
});
