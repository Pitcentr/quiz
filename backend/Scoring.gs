function questionMeta_(game) {
  if (game.status === 'waiting') {
    return { number: 0, total: dbQuestions_(false).length, isLast: false, question: null };
  }
  var list = game.questions || [];
  var index = -1;
  for (var i = 0; i < list.length; i++) if (list[i].id === game.current_question) index = i;
  return {
    number: index >= 0 ? index + 1 : 0,
    total: list.length,
    isLast: index >= 0 && index === list.length - 1,
    question: index >= 0 ? list[index] : null
  };
}

function currentQuestion_(game) {
  var meta = questionMeta_(game);
  if (!meta.question) throwApp_('SERVER_ERROR', 'Текущий вопрос не найден');
  return meta.question;
}

function currentAnswers_(game) {
  if (!game.current_question) return [];
  return dbAnswers_(game.game_id).filter(function (answer) {
    return answer.question_id === game.current_question;
  });
}

function findAnswer_(game, playerId, questionId) {
  var answers = dbAnswers_(game.game_id);
  for (var i = 0; i < answers.length; i++) {
    if (answers[i].player_id === playerId && answers[i].question_id === questionId) return answers[i];
  }
  return null;
}

function questionOver_(game) {
  return game.question_phase === 'closed' || game.question_phase === 'results' || game.status === 'finished';
}

function questionDto_(question, meta, reveal) {
  if (!question) return null;
  var dto = {
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

function leaderboard_(game) {
  var lastPoints = {};
  currentAnswers_(game).forEach(function (answer) {
    if (isScored_(answer)) lastPoints[answer.player_id] = Number(answer.points);
  });
  var rows = dbPlayers_(game.game_id).map(function (player) {
    return {
      player_id: player.player_id,
      name: player.name,
      total_score: Number(player.total_score) || 0,
      last_points: Object.prototype.hasOwnProperty.call(lastPoints, player.player_id) ? lastPoints[player.player_id] : 0
    };
  });
  rows.sort(function (a, b) {
    return b.total_score - a.total_score || compareNames_(a.name, b.name);
  });
  var place = 0;
  var previous = null;
  rows.forEach(function (row, index) {
    if (previous === null || row.total_score !== previous) {
      place = index + 1;
      previous = row.total_score;
    }
    row.place = place;
  });
  return rows;
}

function finalPayload_(game) {
  var board = leaderboard_(game);
  function byPlace(place) {
    return board.filter(function (row) { return row.place === place; });
  }
  return {
    server_time: nowIso_(),
    game_id: game.game_id,
    room_code: game.room_code,
    status: 'finished',
    winners: byPlace(1),
    podium: { first: byPlace(1), second: byPlace(2), third: byPlace(3) },
    leaderboard: board
  };
}

function canAnswer_(game, player) {
  if (game.status !== 'active' || game.question_phase !== 'open') return false;
  var meta = questionMeta_(game);
  if (!meta.question) return false;
  if (findAnswer_(game, player.player_id, meta.question.id)) return false;
  return true;
}
