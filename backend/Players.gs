function joinGame_(params) {
  return withLock_(function () {
    var name = cleanName_(params.name);
    var game = requireRoom_(params.room_code);
    if (game.status !== 'waiting') {
      throwApp_('GAME_NOT_WAITING', game.status === 'finished' ? 'Игра уже завершена' : 'Игра уже началась, подключиться нельзя');
    }
    var players = dbPlayers_(game.game_id);
    if (players.length >= CONFIG.MAX_PLAYERS) throwApp_('ROOM_FULL', 'В комнате уже 20 игроков');
    var key = name.toLocaleLowerCase('ru');
    for (var i = 0; i < players.length; i++) {
      if (String(players[i].name).toLocaleLowerCase('ru') === key) throwApp_('NAME_TAKEN', 'Это имя уже занято в этой комнате');
    }
    var token = makeToken_();
    var player = {
      player_id: makeId_('p_'),
      game_id: game.game_id,
      name: name,
      token_hash: sha256_(token),
      total_score: 0,
      joined_at: nowIso_()
    };
    dbSavePlayer_(player);
    game.updated_at = player.joined_at;
    dbSaveGame_(game);
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

function reconnectPlayer_(params) {
  var found = requirePlayer_(params);
  var player = found.player;
  var game = found.game;
  var meta = questionMeta_(game);
  var question = meta.question;
  var mine = question ? findAnswer_(game, player.player_id, question.id) : null;
  var board = leaderboard_(game);
  var row = null;
  for (var i = 0; i < board.length; i++) if (board[i].player_id === player.player_id) row = board[i];
  var response = {
    server_time: nowIso_(),
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
      player_count: dbPlayers_(game.game_id).length,
      answered_count: currentAnswers_(game).length,
      current_question_number: meta.number,
      total_questions: meta.total,
      is_last_question: meta.isLast,
      question_opened_at: game.question_opened_at || '',
      question_closed_at: game.question_closed_at || '',
      question_time_limit: question ? question.time_limit : 0
    },
    question: questionDto_(question, meta, questionOver_(game)),
    submitted_answer: mine ? mine.answer : null,
    can_answer: canAnswer_(game, player),
    round_result: null,
    leaderboard: null,
    final_result: null
  };
  if ((game.question_phase === 'closed' || game.question_phase === 'results') && question) {
    response.round_result = {
      question_id: question.id,
      your_answer: mine ? mine.answer : null,
      correct_answer: question.correct_answer,
      is_correct: !!(mine && mine.is_correct),
      points: mine && isScored_(mine) ? Number(mine.points) : 0,
      total_score: Number(player.total_score) || 0,
      place: row ? row.place : null
    };
  }
  if (game.question_phase === 'results') response.leaderboard = board;
  if (game.status === 'finished') {
    response.final_result = finalPayload_(game);
    response.player.place = row ? row.place : null;
  }
  return response;
}
