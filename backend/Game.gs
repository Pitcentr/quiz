function requireRoom_(raw) {
  var code = assertRoom_(raw);
  var game = dbGameByRoom_(code);
  if (!game) throwApp_('ROOM_NOT_FOUND', 'Комната не найдена');
  if (game.status === 'archived') throwApp_('GAME_ARCHIVED', 'Эта комната в архиве');
  return game;
}

function requireHost_(params) {
  var token = params.host_token;
  if (!token || String(token).length < 20) throwApp_('UNAUTHORIZED', 'Нет доступа ведущего');
  var game = dbGameByHostHash_(sha256_(String(token)));
  if (!game) throwApp_('UNAUTHORIZED', 'Нет доступа ведущего');
  if (params.room_code && assertRoom_(params.room_code) !== String(game.room_code)) {
    throwApp_('UNAUTHORIZED', 'Код комнаты не совпадает');
  }
  if (game.status === 'archived') throwApp_('GAME_ARCHIVED', 'Эта комната в архиве');
  return game;
}

function requirePlayer_(params) {
  var token = params.player_token;
  if (!token || String(token).length < 20) throwApp_('PLAYER_NOT_FOUND', 'Сессия игрока не найдена. Присоединитесь снова');
  var player = dbPlayerByToken_(String(token));
  var game = player ? dbGameById_(player.game_id) : null;
  if (!player || !game) throwApp_('PLAYER_NOT_FOUND', 'Сессия игрока не найдена. Присоединитесь снова');
  if (params.room_code && assertRoom_(params.room_code) !== String(game.room_code)) {
    throwApp_('UNAUTHORIZED', 'Код комнаты не совпадает');
  }
  if (game.status === 'archived') throwApp_('GAME_ARCHIVED', 'Эта комната в архиве');
  return { player: player, game: game };
}

function dbGameById_(gameId) {
  var cached = cacheGet_('game:' + gameId);
  if (cached) return hydrateGame_(clone_(cached));
  var found = null;
  dbAllGames_().forEach(function (game) {
    cacheGame_(game);
    if (game.game_id === gameId) found = game;
  });
  return found ? hydrateGame_(clone_(found)) : null;
}

function playerViews_(game, role) {
  var answers = currentAnswers_(game);
  var byPlayer = {};
  answers.forEach(function (answer) { byPlayer[answer.player_id] = answer; });
  var revealChoice = role === 'host' && (game.question_phase === 'closed' || game.question_phase === 'results');
  return dbPlayers_(game.game_id).map(function (player) {
    var answer = byPlayer[player.player_id];
    var view = {
      player_id: player.player_id,
      name: player.name,
      total_score: Number(player.total_score) || 0,
      answered: !!answer
    };
    if (revealChoice) {
      view.answer = answer ? answer.answer : null;
      view.is_correct = !!(answer && answer.is_correct);
      view.points = answer && isScored_(answer) ? Number(answer.points) : 0;
    }
    return view;
  });
}

function snapshot_(game, role) {
  var meta = questionMeta_(game);
  var question = meta.question;
  var reveal = !!question && (role === 'host' || questionOver_(game));
  var snap = {
    server_time: nowIso_(),
    game_id: game.game_id,
    room_code: game.room_code,
    status: game.status,
    question_phase: game.question_phase,
    player_count: dbPlayers_(game.game_id).length,
    answered_count: currentAnswers_(game).length,
    current_question_number: meta.number,
    total_questions: meta.total,
    is_last_question: meta.isLast,
    question_opened_at: game.question_opened_at || '',
    question_closed_at: game.question_closed_at || '',
    question_time_limit: question ? question.time_limit : 0,
    question: questionDto_(question, meta, reveal),
    players: playerViews_(game, role)
  };
  // Рейтинг виден на телевизоре всю игру. Правильный ответ добавляется только после закрытия вопроса.
  if (game.status !== 'waiting') snap.leaderboard = leaderboard_(game);
  return snap;
}

function makeRoomCode_() {
  var used = {};
  dbAllGames_().forEach(function (game) { used[String(game.room_code)] = true; });
  for (var i = 0; i < 40; i++) {
    var code = String(Math.floor(100000 + Math.random() * 900000));
    if (!used[code]) return code;
  }
  throwApp_('CONFLICT', 'Не удалось подобрать код комнаты');
}

function createGame_() {
  return withLock_(function () {
    var totalQuestions = dbQuestions_(true).length;
    var token = makeToken_();
    var created = nowIso_();
    var game = {
      game_id: makeId_('g_'),
      room_code: makeRoomCode_(),
      host_token_hash: sha256_(token),
      status: 'waiting',
      current_question: '',
      question_phase: 'none',
      question_opened_at: '',
      question_closed_at: '',
      questions: [],
      created_at: created,
      updated_at: created
    };
    dbSaveGame_(game);
    cachePut_('players:' + game.game_id, []);
    cachePut_('answers:' + game.game_id, []);
    return {
      game_id: game.game_id,
      room_code: game.room_code,
      host_token: token,
      status: game.status,
      total_questions: totalQuestions,
      server_time: created
    };
  });
}

function startGame_(params) {
  return withLock_(function () {
    var game = requireHost_(params);
    if (game.status === 'finished') throwApp_('ALREADY_FINISHED', 'Игра уже завершена');
    if (game.status !== 'waiting') throwApp_('ALREADY_STARTED', 'Игра уже запущена');
    if (!dbPlayers_(game.game_id).length) throwApp_('NO_PLAYERS', 'Нет подключённых игроков');
    var questions = clone_(dbQuestions_(true));
    if (!questions.length) throwApp_('NO_QUESTIONS', 'В таблице нет активных вопросов');
    var opened = nowIso_();
    game.questions = questions;
    game.current_question = questions[0].id;
    game.question_phase = 'open';
    game.question_opened_at = opened;
    game.question_closed_at = '';
    game.status = 'active';
    game.updated_at = opened;
    dbSaveGame_(game);
    return snapshot_(game, 'host');
  });
}

function showResults_(params) {
  return withLock_(function () {
    var game = requireHost_(params);
    if (game.status !== 'active') throwApp_('GAME_NOT_ACTIVE', 'Игра не активна');
    if (game.question_phase !== 'closed') throwApp_('NOT_CLOSED', 'Сначала завершите вопрос');
    game.question_phase = 'results';
    game.updated_at = nowIso_();
    dbSaveGame_(game);
    return snapshot_(game, 'host');
  });
}

function nextQuestion_(params) {
  return withLock_(function () {
    var game = requireHost_(params);
    if (game.status !== 'active') throwApp_('GAME_NOT_ACTIVE', 'Игра не активна');
    if (game.question_phase !== 'closed' && game.question_phase !== 'results') {
      throwApp_('RESULTS_NOT_READY', 'Сначала завершите вопрос');
    }
    if (game.question_phase === 'closed') {
      var closedAt = Date.parse(game.question_closed_at);
      if (isNaN(closedAt) || Date.now() < closedAt + CONFIG.REVEAL_MS) {
        throwApp_('REVEAL_IN_PROGRESS', 'На экране ещё идёт отсчёт');
      }
    }
    var index = -1;
    for (var i = 0; i < game.questions.length; i++) if (game.questions[i].id === game.current_question) index = i;
    if (index < 0) throwApp_('SERVER_ERROR', 'Текущий вопрос не найден');
    if (index >= game.questions.length - 1) throwApp_('NO_MORE_QUESTIONS', 'Это был последний вопрос');
    var opened = nowIso_();
    game.current_question = game.questions[index + 1].id;
    game.question_phase = 'open';
    game.question_opened_at = opened;
    game.question_closed_at = '';
    game.updated_at = opened;
    dbSaveGame_(game);
    return snapshot_(game, 'host');
  });
}

function finishGame_(params) {
  return withLock_(function () {
    var game = requireHost_(params);
    if (game.status === 'finished') throwApp_('ALREADY_FINISHED', 'Игра уже завершена');
    if (game.status !== 'active') throwApp_('GAME_NOT_ACTIVE', 'Игра ещё не начата');
    if (game.question_phase !== 'closed' && game.question_phase !== 'results') {
      throwApp_('QUESTION_STILL_OPEN', 'Сначала завершите текущий вопрос');
    }
    if (game.question_phase === 'closed') {
      var closedAt = Date.parse(game.question_closed_at);
      if (isNaN(closedAt) || Date.now() < closedAt + CONFIG.REVEAL_MS) {
        throwApp_('REVEAL_IN_PROGRESS', 'На экране ещё идёт отсчёт');
      }
    }
    game.status = 'finished';
    game.updated_at = nowIso_();
    dbSaveGame_(game);
    return finalPayload_(game);
  });
}

function archiveGame_(params) {
  return withLock_(function () {
    var game = requireHost_(params);
    if (game.status === 'active') throwApp_('GAME_STILL_ACTIVE', 'Сначала завершите игру');
    game.status = 'archived';
    game.updated_at = nowIso_();
    dbSaveGame_(game);
    return { room_code: game.room_code, status: 'archived', server_time: game.updated_at };
  });
}

function getPlayers_(params) {
  var game = params.host_token ? requireHost_(params) : requireRoom_(params.room_code);
  var players = dbPlayers_(game.game_id).map(function (player) {
    return {
      player_id: player.player_id,
      name: player.name,
      total_score: Number(player.total_score) || 0,
      joined_at: player.joined_at
    };
  });
  return {
    server_time: nowIso_(),
    room_code: game.room_code,
    status: game.status,
    player_count: players.length,
    players: players
  };
}

function getLeaderboard_(params) {
  var game;
  var role;
  if (params.host_token) {
    game = requireHost_(params);
    role = 'host';
  } else if (params.player_token) {
    var found = requirePlayer_(params);
    game = found.game;
    role = 'player';
  } else {
    game = requireRoom_(params.room_code);
    role = 'public';
  }
  if (game.status === 'waiting') throwApp_('LEADERBOARD_HIDDEN', 'Рейтинг появится после старта');
  return {
    server_time: nowIso_(),
    room_code: game.room_code,
    status: game.status,
    question_phase: game.question_phase,
    leaderboard: leaderboard_(game)
  };
}

function getFinalResults_(params) {
  var game = params.host_token ? requireHost_(params) : requireRoom_(params.room_code);
  if (game.status !== 'finished') throwApp_('NOT_FINISHED', 'Игра ещё не завершена');
  return finalPayload_(game);
}
