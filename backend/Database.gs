function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = CONFIG.SPREADSHEET_ID || props.getProperty('SPREADSHEET_ID') || '';
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (error) {
      throwApp_('SERVER_ERROR', 'Не удалось открыть таблицу. Проверьте SPREADSHEET_ID и права скрипта.');
    }
  }
  var active = null;
  try {
    active = SpreadsheetApp.getActive();
  } catch (error) {
    active = null;
  }
  if (active) return active;
  var created = SpreadsheetApp.create('Викторина — база');
  props.setProperty('SPREADSHEET_ID', created.getId());
  Logger.log('Создана таблица: ' + created.getUrl());
  Logger.log('ID сохранён в свойствах скрипта: ' + created.getId());
  return created;
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throwApp_('SERVER_ERROR', 'Нет листа ' + name + '. Запустите setupDatabase в редакторе Apps Script.');
  return sheet;
}

function headersOf_(sheet) {
  var last = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, last).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
}

function readObjects_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  var headers = values[0].map(function (value) { return String(value || '').trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = { _row: r + 1 };
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = fromCell_(headers[c], values[r][c]);
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) rows.push(obj);
  }
  return rows;
}

function findRow_(sheet, header, value) {
  var headers = headersOf_(sheet);
  var column = headers.indexOf(header);
  if (column < 0 || sheet.getLastRow() < 2) return 0;
  var values = sheet.getRange(2, column + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(value)) return i + 2;
  }
  return 0;
}

function writeObject_(sheetName, idHeader, obj) {
  var sheet = getSheet_(sheetName);
  var headers = headersOf_(sheet);
  if (obj._row) {
    var idColumn = headers.indexOf(idHeader);
    var current = idColumn >= 0 ? String(sheet.getRange(obj._row, idColumn + 1).getValue() || '') : '';
    if (current !== String(obj[idHeader])) obj._row = findRow_(sheet, idHeader, obj[idHeader]);
  }
  var row = headers.map(function (header) { return toCell_(header, obj[header]); });
  if (!obj._row) {
    sheet.appendRow(row);
    obj._row = sheet.getLastRow();
  } else {
    sheet.getRange(obj._row, 1, 1, headers.length).setValues([row]);
  }
  return obj;
}

function cacheGet_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function cachePut_(key, value, ttl) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), ttl || CONFIG.CACHE_TTL);
  } catch (error) {
    Logger.log('Не удалось записать кэш ' + key);
  }
}

function cacheGame_(game) {
  cachePut_('game:' + game.game_id, clone_(game));
  cachePut_('room:' + game.room_code, game.game_id);
  if (game.host_token_hash) cachePut_('ht:' + game.host_token_hash, game.game_id);
}

function hydrateGame_(game) {
  if (!game.questions || !game.questions.length) {
    try {
      game.questions = game.questions_json ? JSON.parse(game.questions_json) : [];
    } catch (error) {
      game.questions = [];
    }
  }
  if (!Array.isArray(game.questions)) game.questions = [];
  if (!game.question_phase) game.question_phase = 'none';
  if (!game.status) game.status = 'waiting';
  return game;
}

function dbQuestions_(force) {
  if (!force) {
    var cached = cacheGet_('questions:active');
    if (cached) return cached;
  }
  var list = prepareQuestions_(readObjects_('Questions'));
  cachePut_('questions:active', list, CONFIG.QUESTION_CACHE_TTL);
  return list;
}

function dbAllGames_() {
  return readObjects_('Games').map(hydrateGame_);
}

function dbGameByRoom_(code) {
  var gameId = cacheGet_('room:' + code);
  if (typeof gameId === 'string') {
    var cached = cacheGet_('game:' + gameId);
    if (cached) return hydrateGame_(clone_(cached));
  }
  var found = null;
  dbAllGames_().forEach(function (game) {
    cacheGame_(game);
    if (String(game.room_code) === String(code)) found = game;
  });
  return found ? hydrateGame_(clone_(found)) : null;
}

function dbGameByHostHash_(hash) {
  var gameId = cacheGet_('ht:' + hash);
  if (typeof gameId === 'string') {
    var cached = cacheGet_('game:' + gameId);
    if (cached) return hydrateGame_(clone_(cached));
  }
  var found = null;
  dbAllGames_().forEach(function (game) {
    cacheGame_(game);
    if (safeEqual_(String(game.host_token_hash || ''), hash)) found = game;
  });
  return found ? hydrateGame_(clone_(found)) : null;
}

function dbSaveGame_(game) {
  game.questions_json = JSON.stringify(game.questions || []);
  writeObject_('Games', 'game_id', game);
  cacheGame_(game);
  return game;
}

function dbPlayers_(gameId) {
  var cached = cacheGet_('players:' + gameId);
  if (cached) return clone_(cached);
  var rows = readObjects_('Players').filter(function (player) { return player.game_id === gameId; });
  rows.forEach(function (player) { player.total_score = Number(player.total_score || 0); });
  rows.sort(function (a, b) {
    return String(a.joined_at).localeCompare(String(b.joined_at)) || compareNames_(a.name, b.name);
  });
  cachePut_('players:' + gameId, rows);
  rows.forEach(function (player) {
    cachePut_('pt:' + player.token_hash, { player_id: player.player_id, game_id: player.game_id });
  });
  return clone_(rows);
}

function dbSavePlayer_(player) {
  player.total_score = Number(player.total_score || 0);
  writeObject_('Players', 'player_id', player);
  var list = cacheGet_('players:' + player.game_id);
  if (list) {
    var index = -1;
    for (var i = 0; i < list.length; i++) if (list[i].player_id === player.player_id) index = i;
    if (index >= 0) list[index] = clone_(player);
    else list.push(clone_(player));
    cachePut_('players:' + player.game_id, list);
  }
  cachePut_('pt:' + player.token_hash, { player_id: player.player_id, game_id: player.game_id });
}

function dbPlayerByToken_(token) {
  var hash = sha256_(token);
  var ref = cacheGet_('pt:' + hash);
  if (ref) {
    var cachedPlayers = dbPlayers_(ref.game_id);
    for (var i = 0; i < cachedPlayers.length; i++) {
      if (cachedPlayers[i].player_id === ref.player_id && safeEqual_(cachedPlayers[i].token_hash, hash)) return cachedPlayers[i];
    }
  }
  var rows = readObjects_('Players');
  var match = null;
  rows.forEach(function (player) {
    player.total_score = Number(player.total_score || 0);
    if (safeEqual_(String(player.token_hash || ''), hash)) match = player;
  });
  if (!match) return null;
  var sameGame = rows.filter(function (player) { return player.game_id === match.game_id; });
  cachePut_('players:' + match.game_id, sameGame);
  cachePut_('pt:' + hash, { player_id: match.player_id, game_id: match.game_id });
  return clone_(match);
}

function dbAnswers_(gameId) {
  var cached = cacheGet_('answers:' + gameId);
  if (cached) return clone_(cached);
  var rows = readObjects_('Answers').filter(function (answer) { return answer.game_id === gameId; });
  cachePut_('answers:' + gameId, rows);
  return clone_(rows);
}

function dbSaveAnswer_(answer) {
  writeObject_('Answers', 'id', answer);
  var list = cacheGet_('answers:' + answer.game_id);
  if (list) {
    var index = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === answer.id) index = i;
    if (index >= 0) list[index] = clone_(answer);
    else list.push(clone_(answer));
    cachePut_('answers:' + answer.game_id, list);
  }
}

function ensureSheet_(ss, name, headers, note) {
  var sheet = ss.getSheetByName(name);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(name);
    created = true;
  }
  if (created || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var current = headersOf_(sheet);
    headers.forEach(function (header) {
      if (current.indexOf(header) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
        current.push(header);
      }
    });
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, Math.max(headersOf_(sheet).length, 1)).setFontWeight('bold');
  if (note) sheet.getRange(1, 1).setNote(note);
  headers.forEach(function (header) {
    if (header === 'points' || header === 'total_score' || header === 'order' || header === 'time_limit') return;
    if (TIME_FIELDS_[header]) return;
    var index = headersOf_(sheet).indexOf(header);
    if (index >= 0) sheet.getRange(1, index + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
  return sheet;
}

function setupDatabase() {
  var ss = getSpreadsheet_();
  ensureSheet_(ss, 'Questions', QUESTION_HEADERS, 'Не удаляйте заголовки. Новые вопросы добавляйте строками ниже. Изменения попадут в следующую игру.');
  ensureSheet_(ss, 'Games', GAME_HEADERS, 'Служебный лист. Игры архивируются, а не удаляются во время сессии.');
  ensureSheet_(ss, 'Players', PLAYER_HEADERS, '');
  ensureSheet_(ss, 'Answers', ANSWER_HEADERS, '');
  var questions = ss.getSheetByName('Questions');
  if (questions.getLastRow() < 2) {
    var headers = headersOf_(questions);
    SEED_QUESTIONS.forEach(function (question) {
      questions.appendRow(headers.map(function (header) {
        var value = question[header];
        return value === undefined || value === null ? '' : value;
      }));
    });
  }
  questions.setColumnWidth(3, 460);
  Logger.log('Таблицы готовы: ' + ss.getUrl());
  try {
    ss.toast('Листы викторины готовы');
  } catch (error) {
    // В автономном скрипте всплывающее уведомление таблицы недоступно.
  }
}

function archiveOldGames() {
  var cutoff = Date.now() - (CONFIG.ARCHIVE_AFTER_DAYS || 7) * 24 * 60 * 60 * 1000;
  var count = withLock_(function () {
    var archived = 0;
    dbAllGames_().forEach(function (game) {
      if (game.status !== 'finished') return;
      var stamp = Date.parse(game.updated_at);
      if (!isNaN(stamp) && stamp < cutoff) {
        game.status = 'archived';
        game.updated_at = nowIso_();
        dbSaveGame_(game);
        archived++;
      }
    });
    return archived;
  });
  Logger.log('В архив отправлено игр: ' + count);
  return count;
}
