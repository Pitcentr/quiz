import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Игровая логика викторины.
 * Этот модуль — эталон поведения для backend/*.gs.
 * Баллы, правильность и статус считаются только здесь.
 * Токены в состоянии не хранятся: только SHA-256.
 */

const VERSION = '1.0.0';
const MAX_PLAYERS = 20;
const REVEAL_MS = 5000;
const MIN_NAME = 2;
const MAX_NAME = 20;

const seedQuestions = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'questions.json'), 'utf8')
);

function throwApp(code, message) {
  const error = new Error(message);
  error.code = code;
  error.expose = true;
  throw error;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareNames(a, b) {
  return String(a).localeCompare(String(b), 'ru');
}

function isActive(value) {
  if (value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  if (value === '' || value === null || value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  return !['false', '0', 'нет', 'no', 'n', 'off'].includes(normalized);
}

export function normalizeQuestion(raw, index) {
  const orderValue = Number(raw && raw.order);
  const order = Number.isFinite(orderValue) ? orderValue : index + 1;
  const id = String((raw && raw.id) || '').trim() || 'q' + order;
  const correct = String((raw && raw.correct_answer) || '').trim().toUpperCase();
  const pointsValue = Number(raw && raw.points);
  const timeValue = Number(raw && raw.time_limit);
  const question = {
    id,
    order,
    question: String((raw && raw.question) || '').trim(),
    answers: {
      A: String((raw && raw.answer_a) || '').trim(),
      B: String((raw && raw.answer_b) || '').trim(),
      C: String((raw && raw.answer_c) || '').trim(),
      D: String((raw && raw.answer_d) || '').trim()
    },
    correct_answer: correct,
    points: Number.isFinite(pointsValue) && pointsValue > 0 ? Math.round(pointsValue) : 100,
    time_limit: Number.isFinite(timeValue) ? Math.round(timeValue) : 20,
    active: isActive(raw ? raw.active : true)
  };
  if (!question.active) return null;
  if (!question.question || !question.answers.A || !question.answers.B || !question.answers.C || !question.answers.D) {
    return null;
  }
  if (!['A', 'B', 'C', 'D'].includes(question.correct_answer)) return null;
  if (question.time_limit < 5) question.time_limit = 5;
  if (question.time_limit > 300) question.time_limit = 300;
  return question;
}

export function prepareQuestions(list) {
  const seen = new Set();
  const prepared = [];
  (list || []).forEach((raw, index) => {
    const question = normalizeQuestion(raw, index);
    if (!question || seen.has(question.id)) return;
    seen.add(question.id);
    prepared.push(question);
  });
  prepared.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return prepared;
}

function cleanName(raw) {
  let name = String(raw ?? '').replace(/[\u0000-\u001F]/g, '').trim().replace(/\s+/g, ' ');
  name = name.replace(/^[=+\-@]+/u, '');
  if (name.length < MIN_NAME || name.length > MAX_NAME) {
    throwApp('NAME_INVALID', 'Имя должно содержать от 2 до 20 символов');
  }
  if (!/^[\p{L}\p{N} \-']+$/u.test(name)) {
    throwApp('NAME_INVALID', 'Имя содержит недопустимые символы');
  }
  return name;
}

function normalizeRoom(raw) {
  return String(raw || '').replace(/\s+/g, '');
}

function assertRoom(raw) {
  const code = normalizeRoom(raw);
  if (!/^\d{6}$/.test(code)) throwApp('INVALID_INPUT', 'Код комнаты должен состоять из 6 цифр');
  return code;
}

function isScored(answer) {
  return answer && answer.points !== null && answer.points !== undefined && answer.points !== '';
}

export function createQuizEngine(options = {}) {
  const nowFn = options.now || (() => Date.now());
  const source = Object.prototype.hasOwnProperty.call(options, 'questions') ? options.questions : seedQuestions;
  const state = {
    questions: prepareQuestions(source),
    games: new Map(),
    rooms: new Map(),
    hostHashes: new Map(),
    players: new Map(),
    playersByGame: new Map(),
    playerHashes: new Map(),
    answers: new Map(),
    answersByGame: new Map()
  };

  let running = false;
  const queue = [];

  function nowMs() {
    return nowFn();
  }

  function drain() {
    if (running) return;
    const job = queue.shift();
    if (!job) return;
    running = true;
    try {
      job();
    } finally {
      running = false;
      drain();
    }
  }

  function withLock(fn) {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        try {
          resolve(fn());
        } catch (error) {
          reject(error);
        }
      });
      drain();
    });
  }

  function playersFor(gameId) {
    return (state.playersByGame.get(gameId) || []).map((id) => state.players.get(id));
  }

  function answersFor(gameId) {
    return (state.answersByGame.get(gameId) || []).map((id) => state.answers.get(id));
  }

  function currentAnswers(game) {
    if (!game.current_question) return [];
    return answersFor(game.game_id).filter((answer) => answer.question_id === game.current_question);
  }

  function findAnswer(game, playerId, questionId) {
    return answersFor(game.game_id).find((answer) => answer.player_id === playerId && answer.question_id === questionId) || null;
  }

  function questionMeta(game) {
    if (game.status === 'waiting') {
      return { number: 0, total: state.questions.length, isLast: false, question: null };
    }
    const list = game.questions || [];
    const index = list.findIndex((item) => item.id === game.current_question);
    return {
      number: index >= 0 ? index + 1 : 0,
      total: list.length,
      isLast: index >= 0 && index === list.length - 1,
      question: index >= 0 ? list[index] : null
    };
  }

  function currentQuestion(game) {
    const meta = questionMeta(game);
    if (!meta.question) throwApp('SERVER_ERROR', 'Текущий вопрос не найден');
    return meta.question;
  }

  function requireRoom(raw) {
    const code = assertRoom(raw);
    const gameId = state.rooms.get(code);
    const game = gameId ? state.games.get(gameId) : null;
    if (!game) throwApp('ROOM_NOT_FOUND', 'Комната не найдена');
    if (game.status === 'archived') throwApp('GAME_ARCHIVED', 'Эта комната в архиве');
    return game;
  }

  function requireHost(params) {
    const token = params.host_token;
    if (!token || typeof token !== 'string' || token.length < 20) {
      throwApp('UNAUTHORIZED', 'Нет доступа ведущего');
    }
    const gameId = state.hostHashes.get(sha256(token));
    const game = gameId ? state.games.get(gameId) : null;
    if (!game) throwApp('UNAUTHORIZED', 'Нет доступа ведущего');
    if (params.room_code && assertRoom(params.room_code) !== game.room_code) {
      throwApp('UNAUTHORIZED', 'Код комнаты не совпадает');
    }
    if (game.status === 'archived') throwApp('GAME_ARCHIVED', 'Эта комната в архиве');
    return game;
  }

  function requirePlayer(params) {
    const token = params.player_token;
    if (!token || typeof token !== 'string' || token.length < 20) {
      throwApp('PLAYER_NOT_FOUND', 'Сессия игрока не найдена. Присоединитесь снова');
    }
    const playerId = state.playerHashes.get(sha256(token));
    const player = playerId ? state.players.get(playerId) : null;
    const game = player ? state.games.get(player.game_id) : null;
    if (!player || !game) throwApp('PLAYER_NOT_FOUND', 'Сессия игрока не найдена. Присоединитесь снова');
    if (params.room_code && assertRoom(params.room_code) !== game.room_code) {
      throwApp('UNAUTHORIZED', 'Код комнаты не совпадает');
    }
    if (game.status === 'archived') throwApp('GAME_ARCHIVED', 'Эта комната в архиве');
    return { player, game };
  }

  function resolveGame(params) {
    if (params.host_token) return { game: requireHost(params), role: 'host', player: null };
    if (params.player_token) {
      const found = requirePlayer(params);
      return { game: found.game, role: 'player', player: found.player };
    }
    return { game: requireRoom(params.room_code), role: 'public', player: null };
  }

  function leaderboard(game) {
    const lastPoints = new Map();
    currentAnswers(game).forEach((answer) => {
      if (isScored(answer)) lastPoints.set(answer.player_id, Number(answer.points));
    });
    const rows = playersFor(game.game_id).map((player) => ({
      player_id: player.player_id,
      name: player.name,
      total_score: Number(player.total_score) || 0,
      last_points: lastPoints.has(player.player_id) ? lastPoints.get(player.player_id) : 0
    }));
    rows.sort((a, b) => b.total_score - a.total_score || compareNames(a.name, b.name));
    let place = 0;
    let previous = null;
    rows.forEach((row, index) => {
      if (previous === null || row.total_score !== previous) {
        place = index + 1;
        previous = row.total_score;
      }
      row.place = place;
    });
    return rows;
  }

  function questionDto(question, meta, reveal) {
    if (!question) return null;
    const dto = {
      id: question.id,
      number: meta.number,
      total: meta.total,
      question: question.question,
      answers: {
        A: question.answers.A,
        B: question.answers.B,
        C: question.answers.C,
        D: question.answers.D
      },
      points: question.points,
      time_limit: question.time_limit
    };
    if (reveal) dto.correct_answer = question.correct_answer;
    return dto;
  }

  function playerViews(game, role) {
    const answers = currentAnswers(game);
    const byPlayer = new Map(answers.map((answer) => [answer.player_id, answer]));
    const showPicks = ['closed', 'results'].includes(game.question_phase) || game.status === 'finished';
    return playersFor(game.game_id).map((player) => {
      const answer = byPlayer.get(player.player_id);
      const view = {
        player_id: player.player_id,
        name: player.name,
        total_score: Number(player.total_score) || 0,
        answered: Boolean(answer)
      };
      if (showPicks) view.answer = answer ? answer.answer : null;
      if (role === 'host' && showPicks) {
        view.is_correct = Boolean(answer && answer.is_correct);
        view.points = answer && isScored(answer) ? Number(answer.points) : 0;
      }
      return view;
    });
  }

  function snapshot(game, role) {
    const meta = questionMeta(game);
    const question = meta.question;
    const questionOver = ['closed', 'results'].includes(game.question_phase) || game.status === 'finished';
    const reveal = Boolean(question) && (role === 'host' || questionOver);
    const snap = {
      server_time: iso(nowMs()),
      game_id: game.game_id,
      room_code: game.room_code,
      status: game.status,
      question_phase: game.question_phase,
      player_count: playersFor(game.game_id).length,
      answered_count: currentAnswers(game).length,
      current_question_number: meta.number,
      total_questions: meta.total,
      is_last_question: meta.isLast,
      question_opened_at: game.question_opened_at || '',
      question_closed_at: game.question_closed_at || '',
      question_time_limit: question ? question.time_limit : 0,
      question: questionDto(question, meta, reveal),
      players: playerViews(game, role)
    };
    // Рейтинг на телевизоре виден всё время игры. Правильный вариант добавляется отдельно, только после закрытия.
    if (game.status !== 'waiting') snap.leaderboard = leaderboard(game);
    return snap;
  }

  function finalPayload(game) {
    const board = leaderboard(game);
    const byPlace = (place) => board.filter((row) => row.place === place);
    return {
      server_time: iso(nowMs()),
      game_id: game.game_id,
      room_code: game.room_code,
      status: 'finished',
      winners: byPlace(1),
      podium: { first: byPlace(1), second: byPlace(2), third: byPlace(3) },
      leaderboard: board
    };
  }

  function canAnswer(game, player) {
    if (game.status !== 'active' || game.question_phase !== 'open') return false;
    const meta = questionMeta(game);
    if (!meta.question) return false;
    if (findAnswer(game, player.player_id, meta.question.id)) return false;
    return true;
  }

  function roomCode() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const code = String(randomInt(100000, 1000000));
      if (!state.rooms.has(code)) return code;
    }
    throwApp('CONFLICT', 'Не удалось подобрать код комнаты');
  }

  function createGame() {
    return withLock(() => {
      const token = randomBytes(32).toString('hex');
      const hash = sha256(token);
      const created = iso(nowMs());
      const game = {
        game_id: 'g_' + randomUUID(),
        room_code: roomCode(),
        host_token_hash: hash,
        status: 'waiting',
        current_question: '',
        question_phase: 'none',
        question_opened_at: '',
        question_closed_at: '',
        questions: [],
        created_at: created,
        updated_at: created
      };
      state.games.set(game.game_id, game);
      state.rooms.set(game.room_code, game.game_id);
      state.hostHashes.set(hash, game.game_id);
      state.playersByGame.set(game.game_id, []);
      state.answersByGame.set(game.game_id, []);
      return {
        game_id: game.game_id,
        room_code: game.room_code,
        host_token: token,
        status: game.status,
        total_questions: state.questions.length,
        server_time: created
      };
    });
  }

  function joinGame(params) {
    return withLock(() => {
      const name = cleanName(params.name);
      const game = requireRoom(params.room_code);
      if (game.status !== 'waiting') {
        throwApp('GAME_NOT_WAITING', game.status === 'finished' ? 'Игра уже завершена' : 'Игра уже началась, подключиться нельзя');
      }
      const players = playersFor(game.game_id);
      if (players.length >= MAX_PLAYERS) throwApp('ROOM_FULL', 'В комнате уже 20 игроков');
      const key = name.toLocaleLowerCase('ru');
      if (players.some((player) => player.name.toLocaleLowerCase('ru') === key)) {
        throwApp('NAME_TAKEN', 'Это имя уже занято в этой комнате');
      }
      const token = randomBytes(32).toString('hex');
      const player = {
        player_id: 'p_' + randomUUID(),
        game_id: game.game_id,
        name,
        token_hash: sha256(token),
        total_score: 0,
        joined_at: iso(nowMs())
      };
      state.players.set(player.player_id, player);
      state.playersByGame.get(game.game_id).push(player.player_id);
      state.playerHashes.set(player.token_hash, player.player_id);
      game.updated_at = player.joined_at;
      return {
        player_id: player.player_id,
        player_token: token,
        game_id: game.game_id,
        room_code: game.room_code,
        name: player.name,
        server_time: player.joined_at
      };
    });
  }

  function startGame(params) {
    return withLock(() => {
      const game = requireHost(params);
      if (game.status === 'finished') throwApp('ALREADY_FINISHED', 'Игра уже завершена');
      if (game.status !== 'waiting') throwApp('ALREADY_STARTED', 'Игра уже запущена');
      if (!playersFor(game.game_id).length) throwApp('NO_PLAYERS', 'Нет подключённых игроков');
      const questions = clone(state.questions);
      if (!questions.length) throwApp('NO_QUESTIONS', 'В таблице нет активных вопросов');
      const opened = iso(nowMs());
      game.questions = questions;
      game.current_question = questions[0].id;
      game.question_phase = 'open';
      game.question_opened_at = opened;
      game.question_closed_at = '';
      game.status = 'active';
      game.updated_at = opened;
      return snapshot(game, 'host');
    });
  }

  function submitAnswer(params) {
    return withLock(() => {
      const { player, game } = requirePlayer(params);
      if (game.status !== 'active') throwApp('GAME_NOT_ACTIVE', 'Игра не активна');
      if (game.question_phase !== 'open') throwApp('QUESTION_CLOSED', 'Приём ответов закрыт');
      if (!params.question_id) throwApp('INVALID_INPUT', 'Не указан вопрос');
      if (String(params.question_id) !== String(game.current_question)) {
        throwApp('WRONG_QUESTION', 'Этот вопрос уже не актуален');
      }
      const choice = String(params.answer || '').trim().toUpperCase();
      if (!['A', 'B', 'C', 'D'].includes(choice)) throwApp('INVALID_ANSWER', 'Выберите вариант A, B, C или D');
      const existing = findAnswer(game, player.player_id, game.current_question);
      if (existing) {
        if (existing.answer === choice) {
          return {
            accepted: true,
            already: true,
            question_id: existing.question_id,
            answer: existing.answer,
            server_time: iso(nowMs())
          };
        }
        throwApp('ALREADY_ANSWERED', 'Ответ уже принят и не меняется');
      }
      // Повтор той же отправки после обрыва сети не создаёт второй ответ.
      // Чужой player_id и присланные баллы игнорируются: игрок определяется только токеном.
      // Вопрос не закрывается по таймеру. Его закрывает ведущий или последний ответ.
      const answer = {
        id: 'a_' + randomUUID(),
        game_id: game.game_id,
        player_id: player.player_id,
        question_id: game.current_question,
        answer: choice,
        is_correct: null,
        points: null,
        answered_at: iso(nowMs())
      };
      state.answers.set(answer.id, answer);
      state.answersByGame.get(game.game_id).push(answer.id);
      game.updated_at = answer.answered_at;
      // Последний ответ закрывает вопрос сам: ведущему не нужно нажимать «Завершить».
      const closed = everyoneAnswered(game);
      if (closed) closeOpenQuestion(game);
      return {
        accepted: true,
        already: false,
        closed,
        question_id: answer.question_id,
        answer: choice,
        server_time: answer.answered_at
      };
    });
  }

  function everyoneAnswered(game) {
    const players = playersFor(game.game_id);
    return players.length > 0 && currentAnswers(game).length >= players.length;
  }

  function closeOpenQuestion(game) {
    const question = currentQuestion(game);
    const byPlayer = new Map(currentAnswers(game).map((answer) => [answer.player_id, answer]));
    // Начисление выполняется один раз при переходе open -> closed.
    // Уже заполненные points пропускаются, чтобы повторный вызов не удвоил счёт.
    playersFor(game.game_id).forEach((player) => {
      const answer = byPlayer.get(player.player_id);
      if (!answer || isScored(answer)) return;
      const correct = answer.answer === question.correct_answer;
      const points = correct ? question.points : 0;
      answer.is_correct = correct;
      answer.points = points;
      player.total_score = Number(player.total_score || 0) + points;
    });
    const closed = iso(nowMs());
    game.question_phase = 'closed';
    game.question_closed_at = closed;
    game.updated_at = closed;
  }

  function finishQuestion(params) {
    return withLock(() => {
      const game = requireHost(params);
      if (game.status !== 'active') throwApp('GAME_NOT_ACTIVE', 'Игра не активна');
      if (game.question_phase !== 'open') throwApp('QUESTION_NOT_OPEN', 'Вопрос уже завершён или ещё не открыт');
      closeOpenQuestion(game);
      return snapshot(game, 'host');
    });
  }

  function showResults(params) {
    return withLock(() => {
      const game = requireHost(params);
      if (game.status !== 'active') throwApp('GAME_NOT_ACTIVE', 'Игра не активна');
      if (game.question_phase !== 'closed') throwApp('NOT_CLOSED', 'Сначала завершите вопрос');
      game.question_phase = 'results';
      game.updated_at = iso(nowMs());
      return snapshot(game, 'host');
    });
  }

  function nextQuestion(params) {
    return withLock(() => {
      const game = requireHost(params);
      if (game.status !== 'active') throwApp('GAME_NOT_ACTIVE', 'Игра не активна');
      if (game.question_phase !== 'closed' && game.question_phase !== 'results') {
        throwApp('RESULTS_NOT_READY', 'Сначала завершите вопрос');
      }
      if (game.question_phase === 'closed') {
        const closedAt = Date.parse(game.question_closed_at);
        if (Number.isNaN(closedAt) || nowMs() < closedAt + REVEAL_MS) {
          throwApp('REVEAL_IN_PROGRESS', 'На экране ещё показ ответа');
        }
      }
      const index = game.questions.findIndex((item) => item.id === game.current_question);
      if (index < 0) throwApp('SERVER_ERROR', 'Текущий вопрос не найден');
      if (index >= game.questions.length - 1) throwApp('NO_MORE_QUESTIONS', 'Это был последний вопрос');
      const next = game.questions[index + 1];
      const opened = iso(nowMs());
      game.current_question = next.id;
      game.question_phase = 'open';
      game.question_opened_at = opened;
      game.question_closed_at = '';
      game.updated_at = opened;
      return snapshot(game, 'host');
    });
  }

  function finishGame(params) {
    return withLock(() => {
      const game = requireHost(params);
      if (game.status === 'finished') throwApp('ALREADY_FINISHED', 'Игра уже завершена');
      if (game.status !== 'active') throwApp('GAME_NOT_ACTIVE', 'Игра ещё не начата');
      if (!['closed', 'results'].includes(game.question_phase)) {
        throwApp('QUESTION_STILL_OPEN', 'Сначала завершите текущий вопрос');
      }
      if (game.question_phase === 'closed') {
        const closedAt = Date.parse(game.question_closed_at);
        if (Number.isNaN(closedAt) || nowMs() < closedAt + REVEAL_MS) {
          throwApp('REVEAL_IN_PROGRESS', 'На экране ещё показ ответа');
        }
      }
      game.status = 'finished';
      game.updated_at = iso(nowMs());
      return finalPayload(game);
    });
  }

  function archiveGame(params) {
    return withLock(() => {
      const game = requireHost(params);
      if (game.status === 'active') throwApp('GAME_STILL_ACTIVE', 'Сначала завершите игру');
      game.status = 'archived';
      game.updated_at = iso(nowMs());
      return { room_code: game.room_code, status: 'archived', server_time: game.updated_at };
    });
  }

  function reconnectPlayer(params) {
    const { player, game } = requirePlayer(params);
    const meta = questionMeta(game);
    const question = meta.question;
    const questionOver = ['closed', 'results'].includes(game.question_phase) || game.status === 'finished';
    const mine = question ? findAnswer(game, player.player_id, question.id) : null;
    const board = leaderboard(game);
    const row = board.find((item) => item.player_id === player.player_id);
    const response = {
      server_time: iso(nowMs()),
      player: {
        player_id: player.player_id,
        name: player.name,
        total_score: Number(player.total_score) || 0,
        place: (game.question_phase === 'closed' || game.question_phase === 'results' || game.status === 'finished') && row ? row.place : null
      },
      game: {
        game_id: game.game_id,
        room_code: game.room_code,
        status: game.status,
        question_phase: game.question_phase,
        player_count: playersFor(game.game_id).length,
        answered_count: currentAnswers(game).length,
        current_question_number: meta.number,
        total_questions: meta.total,
        is_last_question: meta.isLast,
        question_opened_at: game.question_opened_at || '',
        question_closed_at: game.question_closed_at || '',
        question_time_limit: question ? question.time_limit : 0
      },
      question: questionDto(question, meta, questionOver),
      submitted_answer: mine ? mine.answer : null,
      can_answer: canAnswer(game, player),
      round_result: null,
      leaderboard: null,
      final_result: null
    };
    if (['closed', 'results'].includes(game.question_phase) && question) {
      response.round_result = {
        question_id: question.id,
        your_answer: mine ? mine.answer : null,
        correct_answer: question.correct_answer,
        is_correct: Boolean(mine && mine.is_correct),
        points: mine && isScored(mine) ? Number(mine.points) : 0,
        total_score: Number(player.total_score) || 0,
        place: row ? row.place : null
      };
    }
    if (game.question_phase === 'results') response.leaderboard = board;
    if (game.status === 'finished') {
      response.final_result = finalPayload(game);
      response.player.place = row ? row.place : null;
    }
    return response;
  }

  function getAnswerStatus(params) {
    const resolved = resolveGame(params);
    const game = resolved.game;
    const answers = currentAnswers(game);
    const payload = {
      server_time: iso(nowMs()),
      question_id: game.current_question || '',
      question_phase: game.question_phase,
      status: game.status,
      answered_count: answers.length,
      player_count: playersFor(game.game_id).length
    };
    if (resolved.player) {
      const mine = answers.find((answer) => answer.player_id === resolved.player.player_id);
      payload.answered = Boolean(mine);
      payload.answer = mine ? mine.answer : null;
      payload.accepted = Boolean(mine);
      return payload;
    }
    const reveal = resolved.role === 'host' && ['closed', 'results'].includes(game.question_phase);
    const byPlayer = new Map(answers.map((answer) => [answer.player_id, answer]));
    payload.players = playersFor(game.game_id).map((player) => {
      const answer = byPlayer.get(player.player_id);
      const item = { player_id: player.player_id, name: player.name, answered: Boolean(answer) };
      if (reveal) {
        item.answer = answer ? answer.answer : null;
        item.is_correct = Boolean(answer && answer.is_correct);
        item.points = answer && isScored(answer) ? Number(answer.points) : 0;
      }
      return item;
    });
    return payload;
  }

  function getQuestionResults(params) {
    const resolved = resolveGame(params);
    const game = resolved.game;
    if (game.status !== 'finished' && !['closed', 'results'].includes(game.question_phase)) {
      throwApp('RESULTS_NOT_READY', 'Результаты вопроса ещё не готовы');
    }
    const question = currentQuestion(game);
    const byPlayer = new Map(currentAnswers(game).map((answer) => [answer.player_id, answer]));
    let people = playersFor(game.game_id);
    if (resolved.player) people = people.filter((player) => player.player_id === resolved.player.player_id);
    return {
      server_time: iso(nowMs()),
      question_id: question.id,
      correct_answer: question.correct_answer,
      points_available: question.points,
      results: people.map((player) => {
        const answer = byPlayer.get(player.player_id);
        return {
          player_id: player.player_id,
          name: player.name,
          answer: answer ? answer.answer : null,
          is_correct: Boolean(answer && answer.is_correct),
          points: answer && isScored(answer) ? Number(answer.points) : 0
        };
      })
    };
  }

  function getLeaderboard(params) {
    const resolved = resolveGame(params);
    const game = resolved.game;
    if (game.status === 'waiting') throwApp('LEADERBOARD_HIDDEN', 'Рейтинг появится после старта');
    return {
      server_time: iso(nowMs()),
      room_code: game.room_code,
      status: game.status,
      question_phase: game.question_phase,
      leaderboard: leaderboard(game)
    };
  }

  function dispatch(action, params) {
    switch (action) {
      case 'ping':
        return { ok: true, version: VERSION, server_time: iso(nowMs()) };
      case 'createGame':
        return createGame();
      case 'getGame':
        return params.host_token ? snapshot(requireHost(params), 'host') : snapshot(requireRoom(params.room_code), 'public');
      case 'joinGame':
        return joinGame(params);
      case 'reconnectPlayer':
        return reconnectPlayer(params);
      case 'getPlayers':
        return (() => {
          const game = params.host_token ? requireHost(params) : requireRoom(params.room_code);
          const players = playersFor(game.game_id).map((player) => ({
            player_id: player.player_id,
            name: player.name,
            total_score: Number(player.total_score) || 0,
            joined_at: player.joined_at
          }));
          return {
            server_time: iso(nowMs()),
            room_code: game.room_code,
            status: game.status,
            player_count: players.length,
            players
          };
        })();
      case 'startGame':
        return startGame(params);
      case 'getCurrentQuestion': {
        const resolved = resolveGame(params);
        const snap = snapshot(resolved.game, resolved.role);
        const payload = {
          server_time: snap.server_time,
          status: snap.status,
          question_phase: snap.question_phase,
          question_opened_at: snap.question_opened_at,
          question_time_limit: snap.question_time_limit,
          question: snap.question
        };
        if (resolved.player) {
          payload.submitted_answer = null;
          const question = snap.question;
          if (question) {
            const mine = findAnswer(resolved.game, resolved.player.player_id, question.id);
            payload.submitted_answer = mine ? mine.answer : null;
          }
          payload.can_answer = canAnswer(resolved.game, resolved.player);
        }
        return payload;
      }
      case 'submitAnswer':
        return submitAnswer(params);
      case 'getAnswerStatus':
        return getAnswerStatus(params);
      case 'finishQuestion':
        return finishQuestion(params);
      case 'showResults':
        return showResults(params);
      case 'getQuestionResults':
        return getQuestionResults(params);
      case 'getLeaderboard':
        return getLeaderboard(params);
      case 'nextQuestion':
        return nextQuestion(params);
      case 'finishGame':
        return finishGame(params);
      case 'getFinalResults': {
        const game = params.host_token ? requireHost(params) : requireRoom(params.room_code);
        if (game.status !== 'finished') throwApp('NOT_FINISHED', 'Игра ещё не завершена');
        return finalPayload(game);
      }
      case 'archiveGame':
        return archiveGame(params);
      default:
        throwApp('UNKNOWN_ACTION', 'Неизвестный метод');
    }
  }

  function failure(error) {
    if (error && error.expose && error.code) {
      return { success: false, data: null, error: { code: error.code, message: error.message } };
    }
    console.error(error);
    return { success: false, data: null, error: { code: 'SERVER_ERROR', message: 'Внутренняя ошибка сервера' } };
  }

  function handle(action, params) {
    const input = params && typeof params === 'object' && !Array.isArray(params) ? Object.assign({}, params) : null;
    if (!input) {
      return Promise.resolve(failure({ expose: true, code: 'INVALID_INPUT', message: 'Некорректный запрос' }));
    }
    const name = String(action || input.action || '').trim();
    delete input.action;
    try {
      const data = dispatch(name, input);
      if (data && typeof data.then === 'function') {
        return data.then((value) => ({ success: true, data: value, error: null }), failure);
      }
      return Promise.resolve({ success: true, data, error: null });
    } catch (error) {
      return Promise.resolve(failure(error));
    }
  }

  return { handle, _internal: state, version: VERSION };
}
