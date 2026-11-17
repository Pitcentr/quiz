function submitAnswer_(params) {
  return withLock_(function () {
    var found = requirePlayer_(params);
    var player = found.player;
    var game = found.game;
    if (game.status !== 'active') throwApp_('GAME_NOT_ACTIVE', 'Игра не активна');
    if (game.question_phase !== 'open') throwApp_('QUESTION_CLOSED', 'Приём ответов закрыт');
    if (!params.question_id || String(params.question_id).length > 80) throwApp_('INVALID_INPUT', 'Не указан вопрос');
    if (String(params.question_id) !== String(game.current_question)) throwApp_('WRONG_QUESTION', 'Этот вопрос уже не актуален');
    var choice = String(params.answer || '').trim().toUpperCase();
    if (['A', 'B', 'C', 'D'].indexOf(choice) === -1) throwApp_('INVALID_ANSWER', 'Выберите вариант A, B, C или D');
    var existing = findAnswer_(game, player.player_id, game.current_question);
    if (existing) {
      if (existing.answer === choice) {
        return {
          accepted: true,
          already: true,
          question_id: existing.question_id,
          answer: existing.answer,
          server_time: nowIso_()
        };
      }
      throwApp_('ALREADY_ANSWERED', 'Ответ уже принят и не меняется');
    }
    // Баллы и чужой player_id из браузера игнорируются: игрока определяет только токен.
    // Приём ответов закрывает ведущий, а не таймер. Кто не ответил, получит 0 при завершении вопроса.
    var answer = {
      id: makeId_('a_'),
      game_id: game.game_id,
      player_id: player.player_id,
      question_id: game.current_question,
      answer: choice,
      is_correct: '',
      points: '',
      answered_at: nowIso_()
    };
    dbSaveAnswer_(answer);
    game.updated_at = answer.answered_at;
    dbSaveGame_(game);
    return {
      accepted: true,
      already: false,
      question_id: answer.question_id,
      answer: choice,
      server_time: answer.answered_at
    };
  });
}

function finishQuestion_(params) {
  return withLock_(function () {
    var game = requireHost_(params);
    if (game.status !== 'active') throwApp_('GAME_NOT_ACTIVE', 'Игра не активна');
    if (game.question_phase !== 'open') throwApp_('QUESTION_NOT_OPEN', 'Вопрос уже завершён или ещё не открыт');
    var question = currentQuestion_(game);
    var byPlayer = {};
    currentAnswers_(game).forEach(function (answer) { byPlayer[answer.player_id] = answer; });
    // Переход open -> closed начисляет баллы один раз. Повторный вызов сюда не доходит,
    // а уже заполненное поле points страхует от двойного суммирования при сбое посередине.
    dbPlayers_(game.game_id).forEach(function (player) {
      var answer = byPlayer[player.player_id];
      if (!answer || isScored_(answer)) return;
      var correct = answer.answer === question.correct_answer;
      answer.is_correct = correct;
      answer.points = correct ? question.points : 0;
      player.total_score = Number(player.total_score || 0) + answer.points;
      dbSaveAnswer_(answer);
      dbSavePlayer_(player);
    });
    var closed = nowIso_();
    game.question_phase = 'closed';
    game.question_closed_at = closed;
    game.updated_at = closed;
    dbSaveGame_(game);
    return snapshot_(game, 'host');
  });
}

function getCurrentQuestion_(params) {
  var game;
  var role;
  var player = null;
  if (params.player_token) {
    var found = requirePlayer_(params);
    game = found.game;
    player = found.player;
    role = 'player';
  } else if (params.host_token) {
    game = requireHost_(params);
    role = 'host';
  } else {
    game = requireRoom_(params.room_code);
    role = 'public';
  }
  var snap = snapshot_(game, role);
  var payload = {
    server_time: snap.server_time,
    status: snap.status,
    question_phase: snap.question_phase,
    question_opened_at: snap.question_opened_at,
    question_time_limit: snap.question_time_limit,
    question: snap.question
  };
  if (player) {
    payload.submitted_answer = null;
    if (snap.question) {
      var mine = findAnswer_(game, player.player_id, snap.question.id);
      payload.submitted_answer = mine ? mine.answer : null;
    }
    payload.can_answer = canAnswer_(game, player);
  }
  return payload;
}

function getAnswerStatus_(params) {
  var game;
  var role = 'public';
  var player = null;
  if (params.player_token) {
    var foundPlayer = requirePlayer_(params);
    game = foundPlayer.game;
    player = foundPlayer.player;
    role = 'player';
  } else if (params.host_token) {
    game = requireHost_(params);
    role = 'host';
  } else {
    game = requireRoom_(params.room_code);
  }
  var answers = currentAnswers_(game);
  var payload = {
    server_time: nowIso_(),
    question_id: game.current_question || '',
    question_phase: game.question_phase,
    status: game.status,
    answered_count: answers.length,
    player_count: dbPlayers_(game.game_id).length
  };
  if (player) {
    var mine = null;
    for (var i = 0; i < answers.length; i++) if (answers[i].player_id === player.player_id) mine = answers[i];
    payload.answered = !!mine;
    payload.answer = mine ? mine.answer : null;
    payload.accepted = !!mine;
    return payload;
  }
  var reveal = role === 'host' && (game.question_phase === 'closed' || game.question_phase === 'results');
  var byPlayer = {};
  answers.forEach(function (answer) { byPlayer[answer.player_id] = answer; });
  payload.players = dbPlayers_(game.game_id).map(function (person) {
    var answer = byPlayer[person.player_id];
    var item = { player_id: person.player_id, name: person.name, answered: !!answer };
    if (reveal) {
      item.answer = answer ? answer.answer : null;
      item.is_correct = !!(answer && answer.is_correct);
      item.points = answer && isScored_(answer) ? Number(answer.points) : 0;
    }
    return item;
  });
  return payload;
}

function getQuestionResults_(params) {
  var game;
  var player = null;
  if (params.player_token) {
    var found = requirePlayer_(params);
    game = found.game;
    player = found.player;
  } else if (params.host_token) {
    game = requireHost_(params);
  } else {
    game = requireRoom_(params.room_code);
  }
  if (game.status !== 'finished' && game.question_phase !== 'closed' && game.question_phase !== 'results') {
    throwApp_('RESULTS_NOT_READY', 'Результаты вопроса ещё не готовы');
  }
  var question = currentQuestion_(game);
  var byPlayer = {};
  currentAnswers_(game).forEach(function (answer) { byPlayer[answer.player_id] = answer; });
  var people = dbPlayers_(game.game_id);
  if (player) people = people.filter(function (person) { return person.player_id === player.player_id; });
  return {
    server_time: nowIso_(),
    question_id: question.id,
    correct_answer: question.correct_answer,
    points_available: question.points,
    results: people.map(function (person) {
      var answer = byPlayer[person.player_id];
      return {
        player_id: person.player_id,
        name: person.name,
        answer: answer ? answer.answer : null,
        is_correct: !!(answer && answer.is_correct),
        points: answer && isScored_(answer) ? Number(answer.points) : 0
      };
    })
  };
}
