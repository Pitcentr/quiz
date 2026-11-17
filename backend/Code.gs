function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    return respond_(true, dispatch_(parseRequest_(e)), null);
  } catch (error) {
    return respond_(false, null, normalizeError_(error));
  }
}

function dispatch_(params) {
  var action = String(params.action || '').trim();
  switch (action) {
    case 'ping':
      return { ok: true, version: CONFIG.VERSION, server_time: nowIso_() };
    case 'createGame':
      return createGame_();
    case 'getGame':
      return params.host_token ? snapshot_(requireHost_(params), 'host') : snapshot_(requireRoom_(params.room_code), 'public');
    case 'joinGame':
      return joinGame_(params);
    case 'reconnectPlayer':
      return reconnectPlayer_(params);
    case 'getPlayers':
      return getPlayers_(params);
    case 'startGame':
      return startGame_(params);
    case 'getCurrentQuestion':
      return getCurrentQuestion_(params);
    case 'submitAnswer':
      return submitAnswer_(params);
    case 'getAnswerStatus':
      return getAnswerStatus_(params);
    case 'finishQuestion':
      return finishQuestion_(params);
    case 'showResults':
      return showResults_(params);
    case 'getQuestionResults':
      return getQuestionResults_(params);
    case 'getLeaderboard':
      return getLeaderboard_(params);
    case 'nextQuestion':
      return nextQuestion_(params);
    case 'finishGame':
      return finishGame_(params);
    case 'getFinalResults':
      return getFinalResults_(params);
    case 'archiveGame':
      return archiveGame_(params);
    default:
      throwApp_('UNKNOWN_ACTION', 'Неизвестный метод');
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Викторина')
    .addItem('Создать листы и вопросы', 'setupDatabase')
    .addItem('Архивировать старые игры', 'archiveOldGames')
    .addItem('Самопроверка', 'runSelfCheck')
    .addToUi();
}

function runSelfCheck() {
  setupDatabase();
  var created = createGame_();
  var joined = joinGame_({ room_code: created.room_code, name: 'Тестер' });
  var started = startGame_({ host_token: created.host_token, room_code: created.room_code });
  submitAnswer_({
    player_token: joined.player_token,
    question_id: started.question.id,
    answer: started.question.correct_answer
  });
  finishQuestion_({ host_token: created.host_token, room_code: created.room_code });
  var blocked = false;
  try {
    finishQuestion_({ host_token: created.host_token, room_code: created.room_code });
  } catch (error) {
    blocked = error.code === 'QUESTION_NOT_OPEN';
  }
  if (!blocked) throw new Error('Повторное начисление не заблокировано');
  showResults_({ host_token: created.host_token, room_code: created.room_code });
  var finals = finishGame_({ host_token: created.host_token, room_code: created.room_code });
  if (!finals.winners.length || finals.winners[0].total_score !== started.question.points) {
    throw new Error('Итоговый счёт не сошёлся');
  }
  archiveGame_({ host_token: created.host_token, room_code: created.room_code });
  Logger.log('Самопроверка пройдена. Комната ' + created.room_code + ' архивирована.');
}
