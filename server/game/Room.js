// Lógica de uma sala. Não conhece sockets: quem usa (net/gameServer.js) recebe os
// callbacks onChange/onEvent/onClose e entrega a visão personalizada a cada jogador.
//
// O Host é um jogador como os outros (boneco, personagem, vidas e turnos). A diferença
// é só de autoridade: configura a lista de personagens, as vidas e inicia a partida.

import { randomBytes, randomUUID } from 'node:crypto';
import { canDrawOnePerPlayer, distribute, drawOnePerPlayer, keysOf } from './draw.js';
import { isGuessCorrect, nameKey } from './fuzzy.js';

export class GameError extends Error {
  constructor(message, code = 'INVALID') {
    super(message);
    this.code = code;
  }
}

export const LIMITS = {
  minPlayers: 2, // incluindo o host
  maxPlayers: 10,
  nickname: 16,
  character: 40,
  characters: 100,
  maxLives: 10,
  maxPicks: 3, // modo CADA UM ESCOLHE VÁRIOS
};

const DEFAULT_TIMINGS = {
  turnMs: 30_000, // duração de cada turno
  resultMs: 2_500, // pausa curta depois de um chute errado, para todos verem a reação
  lobbyGraceMs: 15_000, // tempo para recarregar a página no lobby sem perder o lugar
  hostGraceLobbyMs: 60_000, // host desconectado no lobby: a sala espera e depois fecha
  hostGraceGameMs: 300_000, // host desconectado durante a partida
  botThinkMs: [2_500, 6_000], // tempo que um bot "pensa" antes de jogar (min, max)
};

const BOT_NAMES = ['Bot Ana', 'Bot Beto', 'Bot Carla', 'Bot Davi', 'Bot Eva', 'Bot Fábio', 'Bot Gabi', 'Bot Hugo', 'Bot Iris'];

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const tidy = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const newToken = () => randomBytes(16).toString('hex');
const unref = (t) => {
  t.unref?.();
  return t;
};

export class Room {
  static cleanNickname(raw) {
    const nick = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (nick.length < 2) throw new GameError('O nickname precisa de pelo menos 2 caracteres.', 'NICK_INVALID');
    if (nick.length > LIMITS.nickname) throw new GameError(`O nickname pode ter no máximo ${LIMITS.nickname} caracteres.`, 'NICK_INVALID');
    if (!/[\p{L}\p{N}]/u.test(nick) || /[\u0000-\u001f<>]/.test(nick)) {
      throw new GameError('Nickname inválido. Use letras ou números.', 'NICK_INVALID');
    }
    return nick;
  }

  constructor(code, { onChange, onEvent, onClose, timings } = {}) {
    this.code = code;
    this.onChange = onChange ?? (() => {});
    this.onEvent = onEvent ?? (() => {});
    this.onClose = onClose ?? (() => {});
    this.timings = { ...DEFAULT_TIMINGS, ...timings };

    this.phase = 'lobby'; // lobby | playing | finished | closed
    this.settings = { lives: 3, mode: 'host' }; // mode: 'host' (HOST ESCOLHE) | 'players' (CADA UM ESCOLHE) | 'multi' (CADA UM ESCOLHE VÁRIOS)
    this.characters = []; // lista do host, destinada aos jogadores comuns
    this.players = []; // inclui o host (isHost) no assento 0
    this.turn = null; // { id, playerId, step:'action'|'result', deadline, duration }
    this.turnSeq = 0;
    this.eventSeq = 0;
    this.gameNo = 0; // sobe a cada partida iniciada (o cliente usa para zerar a caderneta)
    this.result = null; // { winnerId|null }
    this.timer = null;
    this.hostTimer = null;
    this.botTimer = null;
    this.lastActive = Date.now();
  }

  // ---------- infraestrutura ----------
  changed() {
    this.lastActive = Date.now();
    this.onChange(this);
  }
  emit(evt) {
    this.onEvent({ id: ++this.eventSeq, ...evt });
  }
  setTimer(ms, fn) {
    this.clearTimer();
    this.timer = unref(
      setTimeout(() => {
        this.timer = null;
        fn();
      }, ms),
    );
  }
  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  clearBotTimer() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }
  destroy() {
    this.clearTimer();
    this.clearBotTimer();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
    this.players.forEach((p) => p.dropTimer && clearTimeout(p.dropTimer));
  }
  get host() {
    return this.players.find((p) => p.isHost);
  }
  byId(id) {
    return this.players.find((p) => p.id === id);
  }
  bySocket(socketId) {
    return socketId ? this.players.find((p) => p.socketId === socketId) : undefined;
  }
  isAbandoned() {
    const humans = this.players.filter((p) => !p.bot);
    return humans.every((p) => !p.connected) && Date.now() - this.lastActive > 10 * 60_000;
  }

  assertHost(id) {
    if (this.host?.id !== id) throw new GameError('Apenas o host pode fazer isso.', 'NOT_HOST');
  }
  assertLobby() {
    if (this.phase !== 'lobby') throw new GameError('Isso só pode ser feito antes da partida começar.', 'NOT_LOBBY');
  }
  /** Valida uma ação de turno (chutar/passar). turnId evita que um clique atrasado atinja o turno seguinte. */
  assertAction(id, turnId) {
    if (this.phase !== 'playing' || !this.turn) throw new GameError('Não há partida em andamento.', 'NO_GAME');
    if (this.turn.playerId !== id) throw new GameError('Não é a sua vez.', 'NOT_YOUR_TURN');
    if (turnId !== undefined && turnId !== this.turn.id) throw new GameError('Essa vez já passou.', 'STALE_TURN');
    if (this.turn.step !== 'action') throw new GameError('Essa ação não está disponível agora.', 'STALE_TURN');
    return this.turn;
  }

  // ---------- entrada e saída ----------
  makePlayer(socketId, rawNickname, isHost) {
    const nickname = Room.cleanNickname(rawNickname);
    if (this.players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase())) {
      throw new GameError('Esse nickname já está em uso na sala.', 'NICK_TAKEN');
    }
    const player = {
      id: randomUUID().slice(0, 8),
      token: newToken(),
      socketId,
      nickname,
      isHost,
      connected: true,
      character: null,
      suggestion: null,
      lives: 0,
      eliminated: false,
      seat: this.players.length,
      dropTimer: null,
      bot: false,
      botTurns: 0,
    };
    this.players.push(player);
    return player;
  }

  createHost(socketId, nickname) {
    if (this.players.length) throw new GameError('A sala já tem host.', 'INVALID');
    return this.makePlayer(socketId, nickname, true);
  }

  addPlayer(socketId, nickname) {
    if (this.phase === 'closed') throw new GameError('Esta sala foi encerrada.', 'ROOM_CLOSED');
    if (this.phase !== 'lobby') throw new GameError('Sala indisponível: a partida já começou.', 'ROOM_STARTED');
    if (this.players.length >= LIMITS.maxPlayers) {
      throw new GameError(`Sala indisponível: ela já está cheia (${LIMITS.maxPlayers} jogadores).`, 'ROOM_FULL');
    }
    return this.makePlayer(socketId, nickname, false);
  }

  rejoin(token, socketId) {
    const who = token ? this.players.find((p) => p.token === token) : null;
    if (!who) throw new GameError('Sessão expirada. Entre na sala novamente.', 'SESSION_EXPIRED');
    if (who.dropTimer) clearTimeout(who.dropTimer);
    who.dropTimer = null;
    if (who.isHost && this.hostTimer) {
      clearTimeout(this.hostTimer);
      this.hostTimer = null;
    }
    who.connected = true;
    who.socketId = socketId;
    this.changed();
    return who;
  }

  disconnect(socketId) {
    const who = this.bySocket(socketId);
    if (!who) return;
    who.connected = false;
    who.socketId = null;
    if (who.isHost) {
      // Sem transferência de autoridade: a sala espera o host voltar e, se ele não voltar, fecha.
      if (this.hostTimer) clearTimeout(this.hostTimer);
      const ms = this.phase === 'lobby' ? this.timings.hostGraceLobbyMs : this.timings.hostGraceGameMs;
      this.hostTimer = unref(setTimeout(() => this.close('host-timeout'), ms));
    } else if (this.phase === 'lobby') {
      who.dropTimer = unref(
        setTimeout(() => {
          if (!who.connected && this.phase === 'lobby') this.removePlayer(who.id);
        }, this.timings.lobbyGraceMs),
      );
    }
    this.changed();
  }

  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
    this.players.forEach((p, i) => (p.seat = i));
    this.changed();
  }

  /** Saída voluntária. Se o host sai, a sala fecha (a autoridade nunca muda de mãos). */
  leave(id) {
    const p = this.byId(id);
    if (!p) return;
    if (p.isHost) return this.close('host-left', { except: p.socketId });
    if (this.phase === 'lobby') return this.removePlayer(id);

    p.connected = false;
    p.socketId = null;
    if (!p.eliminated) {
      p.eliminated = true;
      p.lives = 0;
    }
    if (this.phase === 'playing') {
      if (this.players.every((x) => x.eliminated)) return this.finish(null);
      if (this.turn?.playerId === id) return this.passTurn();
    }
    this.changed();
  }

  close(reason, opts = {}) {
    if (this.phase === 'closed') return;
    this.destroy();
    this.phase = 'closed';
    this.turn = null;
    this.onClose(this, reason, opts);
  }

  // ---------- bots ----------
  /** O host completa a sala com um jogador controlado pelo servidor (só no lobby). */
  addBot(by) {
    this.assertHost(by);
    this.assertLobby();
    if (this.settings.mode !== 'host') throw new GameError('Neste modo não há bots: eles não escolhem personagem.', 'NOT_ALLOWED');
    if (this.players.length >= LIMITS.maxPlayers) {
      throw new GameError(`A sala já está cheia (${LIMITS.maxPlayers} jogadores).`, 'ROOM_FULL');
    }
    const taken = new Set(this.players.map((p) => p.nickname.toLowerCase()));
    let nickname = BOT_NAMES.find((n) => !taken.has(n.toLowerCase()));
    for (let i = 2; !nickname; i++) if (!taken.has(`bot ${i}`)) nickname = `Bot ${i}`;
    const bot = {
      id: randomUUID().slice(0, 8),
      token: null,
      socketId: null,
      nickname,
      isHost: false,
      connected: true, // bots nunca "caem"
      character: null,
      suggestion: null,
      lives: 0,
      eliminated: false,
      seat: this.players.length,
      dropTimer: null,
      bot: true,
      botTurns: 0,
    };
    this.players.push(bot);
    this.changed();
    return bot;
  }

  removeBot(by, botId) {
    this.assertHost(by);
    this.assertLobby();
    const bot = this.byId(botId);
    if (!bot?.bot) throw new GameError('Bot não encontrado.', 'INVALID');
    this.removePlayer(botId);
  }

  /**
   * Jogada de um bot. Passa pelas mesmas funções dos humanos (guess/pass), então toda regra
   * (turno, vidas, eliminação, vitória) vale igual. A "chance de acertar" cresce a cada turno,
   * simulando que ele vai deduzindo quem é.
   */
  scheduleBot() {
    this.clearBotTimer();
    const turn = this.turn;
    const bot = this.byId(turn?.playerId);
    if (!bot?.bot || this.phase !== 'playing' || turn.step !== 'action') return;
    const [lo, hi] = this.timings.botThinkMs;
    const ms = lo + Math.random() * Math.max(0, hi - lo);
    this.botTimer = unref(
      setTimeout(() => {
        this.botTimer = null;
        if (this.phase !== 'playing' || this.turn?.id !== turn.id || this.turn.step !== 'action' || bot.eliminated) return;
        bot.botTurns += 1;
        try {
          const knows = Math.random() < Math.min(0.6, 0.07 * bot.botTurns);
          if (knows) return void this.guess(bot.id, bot.character, turn.id);
          if (Math.random() < 0.25) {
            const wrong = shuffle(this.characters.concat(['Fulano de Tal'])).find((c) => nameKey(c) !== nameKey(bot.character));
            return void this.guess(bot.id, wrong, turn.id);
          }
          this.pass(bot.id, turn.id);
        } catch {
          /* o turno mudou no meio: nada a fazer */
        }
      }, ms),
    );
  }

  // ---------- configuração do lobby ----------
  setSettings(by, { lives, mode } = {}) {
    this.assertHost(by);
    this.assertLobby();
    if (mode !== undefined) this.setMode(mode);
    if (lives !== undefined) {
      const n = Math.round(Number(lives));
      if (!Number.isFinite(n)) throw new GameError('Número de vidas inválido.');
      this.settings.lives = Math.min(LIMITS.maxLives, Math.max(1, n));
    }
    this.changed();
  }

  /**
   * Modo de partida. 'host': o host cadastra a lista e os outros sugerem (HOST ESCOLHE).
   * 'players': cada jogador escolhe 1 personagem e ele é sorteado para outro jogador (CADA UM ESCOLHE).
   * Trocar de modo descarta as escolhas já enviadas, pois elas têm significados diferentes.
   */
  setMode(mode) {
    if (mode !== 'host' && mode !== 'players' && mode !== 'multi') throw new GameError('Modo de partida inválido.', 'INVALID');
    if (mode === this.settings.mode) return;
    if (mode !== 'host' && this.players.some((p) => p.bot)) {
      throw new GameError('Neste modo não há bots (eles não escolhem personagem). Remova os bots primeiro.', 'NOT_ALLOWED');
    }
    this.settings.mode = mode;
    this.players.forEach((p) => {
      p.suggestion = null;
      p.picks = [];
    });
  }

  /** Substitui a lista de personagens do host (adicionar, remover e corrigir passam por aqui). */
  setCharacters(by, list) {
    this.assertHost(by);
    this.assertLobby();
    if (this.settings.mode !== 'host') throw new GameError('A lista do host só existe no modo HOST ESCOLHE.', 'NOT_ALLOWED');
    if (!Array.isArray(list)) throw new GameError('Lista de personagens inválida.');
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const name = tidy(raw, LIMITS.character);
      const key = nameKey(name);
      if (!key || seen.has(key)) continue; // vazio, só símbolos ou repetido
      seen.add(key);
      out.push(name);
      if (out.length >= LIMITS.characters) break;
    }
    this.characters = out;
    this.changed();
  }

  /** Cada jogador comum envia um personagem para o sorteio do host. Pode trocar até a partida começar. */
  suggest(id, text) {
    this.assertLobby();
    const p = this.byId(id);
    if (!p) throw new GameError('Jogador não encontrado.');
    if (this.settings.mode === 'multi') throw new GameError('Neste modo você escolhe até 3 personagens.', 'NOT_ALLOWED');
    const picks = this.settings.mode === 'players';
    if (p.isHost && !picks) throw new GameError('O host cadastra a lista de personagens; quem sugere são os outros jogadores.', 'NOT_ALLOWED');
    const name = tidy(text, LIMITS.character);
    if (!nameKey(name)) throw new GameError('Digite um nome válido (use letras ou números).', 'INVALID');
    if (picks) {
      // um personagem só pode aparecer uma vez na mesa (a mensagem não revela quem o escolheu)
      const key = nameKey(name);
      if (this.players.some((o) => o.id !== p.id && o.suggestion && nameKey(o.suggestion) === key)) {
        throw new GameError('Esse personagem já foi escolhido por outro jogador. Escolha outro.', 'DUPLICATE');
      }
    }
    p.suggestion = name;
    this.changed();
  }

  /** Modo CADA UM ESCOLHE VÁRIOS: o jogador define (substitui) sua seleção de 1 a 3 personagens diferentes. */
  setPicks(id, list) {
    this.assertLobby();
    if (this.settings.mode !== 'multi') throw new GameError('Este modo de partida não usa seleção múltipla.', 'NOT_ALLOWED');
    const p = this.byId(id);
    if (!p || p.bot) throw new GameError('Jogador não encontrado.');
    if (!Array.isArray(list)) throw new GameError('Seleção inválida.', 'INVALID');
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const name = tidy(raw, LIMITS.character);
      const key = nameKey(name);
      if (!key || seen.has(key)) continue; // vazio ou repetido na própria lista
      seen.add(key);
      out.push(name);
    }
    if (out.length > LIMITS.maxPicks) throw new GameError(`Escolha no máximo ${LIMITS.maxPicks} personagens.`, 'INVALID');
    p.picks = out; // lista vazia = desfaz a confirmação
    this.changed();
  }

  readiness() {
    const missing = [];
    const commons = this.players.filter((p) => !p.isHost);
    if (this.players.length < LIMITS.minPlayers) missing.push('Aguarde pelo menos mais um jogador entrar na sala.');
    const offline = this.players.filter((p) => !p.connected).map((p) => p.nickname);
    if (offline.length) missing.push(`Sem conexão: ${offline.join(', ')}.`);
    if (this.settings.mode === 'multi') {
      const waiting = this.players.filter((p) => !(p.picks?.length)).map((p) => p.nickname);
      if (waiting.length) missing.push(`Faltam escolhas de: ${waiting.join(', ')}.`);
      else if (!canDrawOnePerPlayer(this.players.map((p) => p.picks))) {
        missing.push('Há personagens repetidos entre as escolhas e não dá para sortear um diferente para cada jogador. Alguém precisa acrescentar outro personagem.');
      }
      return { ok: missing.length === 0, missing, needed: this.players.length };
    }
    if (this.settings.mode === 'players') {
      const waiting = this.players.filter((p) => !p.suggestion).map((p) => p.nickname);
      if (waiting.length) missing.push(`Faltam escolhas de: ${waiting.join(', ')}.`);
      return { ok: missing.length === 0, missing, needed: this.players.length };
    }
    const humans = commons.filter((p) => !p.bot);
    const pending = humans.filter((p) => !p.suggestion).map((p) => p.nickname);
    if (pending.length) missing.push(`Faltam sugestões de: ${pending.join(', ')}.`);
    // sem nenhum jogador humano comum, não há sugestão para o host: o personagem dele sai da própria lista
    const needed = commons.length + (commons.length > 0 && humans.length === 0 ? 1 : 0);
    if (commons.length && this.characters.length < needed) {
      missing.push(`Cadastre pelo menos ${needed} personagem(ns) (você tem ${this.characters.length}).`);
    }
    return { ok: missing.length === 0, missing, needed };
  }

  // ---------- partida ----------
  /**
   * Sorteio feito aqui, de uma vez só (síncrono): não há como dois cliques ou duas
   * reconexões produzirem resultados diferentes. Todos recebem o mesmo estado.
   */
  start(by) {
    this.assertHost(by);
    if (this.phase !== 'lobby') throw new GameError('A partida já começou.', 'ALREADY_STARTED');
    const ready = this.readiness();
    if (!ready.ok) throw new GameError(ready.missing.join(' '), 'NOT_READY');

    if (this.settings.mode === 'multi') this.drawMulti();
    else if (this.settings.mode === 'players') this.drawPicks();
    else this.drawFromHost();
    this.beginGame();
  }

  /**
   * CADA UM ESCOLHE: embaralha as escolhas até ninguém ficar com a própria (derangement).
   * Todos escolheram exatamente 1 e todas as escolhas são usadas, uma vez cada.
   */
  drawPicks() {
    const ps = this.players;
    const picks = ps.map((p) => p.suggestion);
    let order;
    do {
      order = shuffle(picks.map((_, i) => i));
    } while (order.some((src, i) => src === i));
    ps.forEach((p, i) => (p.character = picks[order[i]]));
  }

  /**
   * CADA UM ESCOLHE VÁRIOS: 1) sorteia 1 personagem da seleção de cada jogador (sem repetir personagem);
   * 2) distribui os sorteados entre os jogadores, ninguém recebendo o sorteado da própria seleção.
   */
  drawMulti() {
    const ps = this.players;
    const lists = ps.map((p) => p.picks ?? []);
    const idx = drawOnePerPlayer(lists);
    if (!idx) throw new GameError('Não deu para sortear: há personagens repetidos entre as escolhas. Alguém precisa acrescentar outro.', 'DRAW_FAILED');
    const drawn = ps.map((_, i) => lists[i][idx[i]]);
    const assign = distribute(drawn.map(nameKey), lists.map(keysOf));
    if (!assign) throw new GameError('Não deu para distribuir os personagens.', 'DRAW_FAILED');
    ps.forEach((p, i) => (p.character = drawn[assign[i]]));
  }

  drawFromHost() {
    const host = this.host;
    const commons = this.players.filter((p) => !p.isHost);

    // 1-3. sorteia uma sugestão para o host (se ela coincidir com um nome da lista,
    // tenta outra, para nunca haver o mesmo personagem em dois bonecos)
    let chosen = null;
    let pool = null;
    const humans = commons.filter((p) => !p.bot);
    for (const s of shuffle(humans.map((p) => p.suggestion))) {
      const key = nameKey(s);
      const available = this.characters.filter((c) => nameKey(c) !== key);
      if (available.length >= commons.length) {
        chosen = s;
        pool = available;
        break;
      }
    }
    if (!chosen && humans.length === 0 && this.characters.length > commons.length) {
      // só bots: o host recebe um nome da própria lista
      const all = shuffle(this.characters);
      chosen = all[0];
      pool = all.slice(1);
    }
    if (!chosen) {
      throw new GameError('Não deu para sortear: as sugestões coincidem com nomes da sua lista. Cadastre mais personagens.', 'DRAW_FAILED');
    }

    // 4-6. distribui os personagens do host entre os jogadores comuns, sem reposição
    const picked = shuffle(pool).slice(0, commons.length);
    commons.forEach((p, i) => (p.character = picked[i]));
    host.character = chosen;
  }

  beginGame() {
    this.players.forEach((p) => {
      p.picks = [];
      p.suggestion = null; // sugestões consumidas: a sorteada saiu do conjunto e as demais não têm mais uso
      p.lives = this.settings.lives;
      p.eliminated = false;
      p.botTurns = 0;
    });

    this.gameNo += 1;
    this.phase = 'playing';
    this.result = null;
    const first = this.players[Math.floor(Math.random() * this.players.length)];
    this.emit({ type: 'game-start', playerId: first.id, mode: this.settings.mode });
    this.beginTurn(first.id);
  }

  beginTurn(playerId) {
    const ms = this.timings.turnMs;
    this.turn = { id: ++this.turnSeq, playerId, step: 'action', deadline: Date.now() + ms, duration: ms };
    this.setTimer(ms, () => this.passTurn()); // tempo esgotado: passa a vez, sem perder vida
    this.scheduleBot();
    this.changed();
  }

  guess(id, text, turnId) {
    const turn = this.assertAction(id, turnId);
    const attempt = tidy(text, 80);
    if (!nameKey(attempt)) throw new GameError('Digite o nome do seu personagem.', 'INVALID');
    const player = this.byId(id);

    if (isGuessCorrect(attempt, player.character)) {
      this.finish(id);
      return { correct: true };
    }

    player.lives = Math.max(0, player.lives - 1);
    const eliminated = player.lives === 0;
    if (eliminated) player.eliminated = true;

    const ms = this.timings.resultMs;
    turn.step = 'result';
    turn.deadline = Date.now() + ms;
    turn.duration = ms;
    this.emit({ type: 'wrong-guess', playerId: id, text: attempt, eliminated, livesLeft: player.lives });
    this.setTimer(ms, () => this.passTurn());
    this.changed();
    return { correct: false, eliminated, livesLeft: player.lives };
  }

  pass(id, turnId) {
    this.assertAction(id, turnId);
    this.passTurn();
  }

  /** Próximo jogador ativo à direita (assento seguinte). Eliminados nunca recebem turno. */
  passTurn() {
    if (this.phase !== 'playing') return;
    if (this.players.every((p) => p.eliminated)) return this.finish(null);

    const n = this.players.length;
    const current = this.byId(this.turn?.playerId);
    const start = current ? current.seat : -1;

    let next = null;
    let fallback = null;
    for (let k = 1; k <= n; k++) {
      const p = this.players[(start + k + n) % n];
      if (p.eliminated) continue;
      fallback ??= p;
      if (p.connected) {
        next = p;
        break;
      }
    }
    this.beginTurn((next ?? fallback).id);
  }

  finish(winnerId) {
    this.clearTimer();
    this.clearBotTimer();
    this.phase = 'finished';
    this.turn = null;
    this.result = { winnerId };
    this.emit({ type: 'game-end', playerId: winnerId });
    this.changed();
  }

  /** Volta ao lobby (nova partida ou partida abortada pelo host). Cada jogador sugere de novo. */
  reset(by) {
    this.assertHost(by);
    if (this.phase === 'lobby') throw new GameError('A sala já está no lobby.', 'NOT_STARTED');
    this.clearTimer();
    this.clearBotTimer();
    this.phase = 'lobby';
    this.turn = null;
    this.result = null;
    this.players = this.players.filter((p) => p.connected);
    this.players.forEach((p, i) => {
      p.seat = i;
      p.character = null;
      p.suggestion = null;
      p.picks = [];
      p.lives = 0;
      p.eliminated = false;
    });
    this.changed();
  }

  // ---------- visão personalizada ----------
  /**
   * O que um jogador pode saber. REGRA CRÍTICA: o personagem de um jogador ativo
   * nunca é enviado a ele. Só os outros o veem; ele próprio só depois de eliminado
   * ou no fim da partida. As sugestões dos outros e a lista do host nunca saem do
   * servidor, exceto a própria sugestão (para quem a enviou) e a lista (para o host).
   */
  viewFor(viewerId) {
    const me = this.byId(viewerId);
    const isHost = !!me?.isHost;
    const inGame = this.phase === 'playing' || this.phase === 'finished';
    const reveal = this.phase === 'finished';
    const lobby = this.phase === 'lobby';

    return {
      code: this.code,
      phase: this.phase,
      gameNo: this.gameNo,
      serverTime: Date.now(),
      you: { id: viewerId, isHost },
      settings: { lives: this.settings.lives, mode: this.settings.mode },
      lobby: lobby
        ? {
            characters: isHost && this.settings.mode === 'host' ? [...this.characters] : null,
            mySuggestion: this.settings.mode === 'multi' || (isHost && this.settings.mode === 'host') ? null : me?.suggestion ?? null,
            myPicks: this.settings.mode === 'multi' ? [...(me?.picks ?? [])] : null,
            ready: isHost ? this.readiness() : null,
          }
        : null,
      players: this.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        seat: p.seat,
        isHost: p.isHost,
        connected: p.connected,
        lives: p.lives,
        eliminated: p.eliminated,
        bot: p.bot,
        submitted: lobby && (!p.isHost || this.settings.mode !== 'host') && !p.bot ? (this.settings.mode === 'multi' ? !!p.picks?.length : !!p.suggestion) : null,
        character: inGame && (reveal || p.id !== viewerId || p.eliminated) ? p.character : null,
      })),
      turn: this.turn ? { ...this.turn } : null,
      result: this.result,
    };
  }
}
