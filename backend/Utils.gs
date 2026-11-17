var TIME_FIELDS_ = {
  created_at: true,
  updated_at: true,
  question_opened_at: true,
  question_closed_at: true,
  joined_at: true,
  answered_at: true
};

function throwApp_(code, message) {
  var error = new Error(message);
  error.code = code;
  throw error;
}

function nowIso_() {
  return new Date().toISOString();
}

function clone_(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareNames_(a, b) {
  return String(a).localeCompare(String(b), 'ru');
}

function sha256_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var current = (bytes[i] + 256) % 256;
    var part = current.toString(16);
    hex += part.length === 1 ? '0' + part : part;
  }
  return hex;
}

function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function makeToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function makeId_(prefix) {
  return prefix + Utilities.getUuid();
}

function cleanName_(raw) {
  var name = String(raw == null ? '' : raw).replace(/[\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim();
  name = name.replace(/^[=+\-@]+/, '');
  if (name.length < 2 || name.length > 20) throwApp_('NAME_INVALID', 'Имя должно содержать от 2 до 20 символов');
  if (!/^[\p{L}\p{N} \-']+$/u.test(name)) throwApp_('NAME_INVALID', 'Имя содержит недопустимые символы');
  return name;
}

function assertRoom_(raw) {
  var code = String(raw || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) throwApp_('INVALID_INPUT', 'Код комнаты должен состоять из 6 цифр');
  return code;
}

function isScored_(answer) {
  return !!(answer && answer.points !== null && answer.points !== undefined && answer.points !== '');
}

function isActive_(value) {
  if (value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  if (value === '' || value === null || value === undefined) return true;
  return ['false', '0', 'нет', 'no', 'n', 'off'].indexOf(String(value).trim().toLowerCase()) === -1;
}

function normalizeQuestion_(raw, index) {
  var orderValue = Number(raw && raw.order);
  var order = isFinite(orderValue) ? orderValue : index + 1;
  var pointsValue = Number(raw && raw.points);
  var timeValue = Number(raw && raw.time_limit);
  var question = {
    id: String((raw && raw.id) || '').trim() || ('q' + order),
    order: order,
    question: String((raw && raw.question) || '').trim(),
    answers: {
      A: String((raw && raw.answer_a) || '').trim(),
      B: String((raw && raw.answer_b) || '').trim(),
      C: String((raw && raw.answer_c) || '').trim(),
      D: String((raw && raw.answer_d) || '').trim()
    },
    correct_answer: String((raw && raw.correct_answer) || '').trim().toUpperCase(),
    points: isFinite(pointsValue) && pointsValue > 0 ? Math.round(pointsValue) : 100,
    time_limit: isFinite(timeValue) ? Math.round(timeValue) : 20,
    active: isActive_(raw ? raw.active : true)
  };
  if (!question.active) return null;
  if (!question.question || !question.answers.A || !question.answers.B || !question.answers.C || !question.answers.D) return null;
  if (['A', 'B', 'C', 'D'].indexOf(question.correct_answer) === -1) return null;
  if (question.time_limit < 5) question.time_limit = 5;
  if (question.time_limit > 300) question.time_limit = 300;
  return question;
}

function prepareQuestions_(list) {
  var seen = {};
  var prepared = [];
  (list || []).forEach(function (raw, index) {
    var question = normalizeQuestion_(raw, index);
    if (!question || seen[question.id]) return;
    seen[question.id] = true;
    prepared.push(question);
  });
  prepared.sort(function (a, b) {
    return a.order - b.order || String(a.id).localeCompare(String(b.id));
  });
  return prepared;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throwApp_('CONFLICT', 'Сервер занят, повторите через секунду');
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function respond_(success, data, error) {
  return ContentService.createTextOutput(JSON.stringify({
    success: success,
    data: data,
    error: error
  })).setMimeType(ContentService.MimeType.JSON);
}

function normalizeError_(error) {
  if (error && error.code) return { code: String(error.code), message: String(error.message || 'Ошибка') };
  Logger.log(error && error.stack ? error.stack : error);
  return { code: 'SERVER_ERROR', message: 'Внутренняя ошибка сервера' };
}

function parseRequest_(e) {
  var params = {};
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (key) {
      params[key] = e.parameter[key];
    });
  }
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      Object.keys(body || {}).forEach(function (key) {
        params[key] = body[key];
      });
    } catch (error) {
      throwApp_('INVALID_INPUT', 'Некорректный запрос');
    }
  }
  if (!params.action) params.action = 'ping';
  return params;
}

function fromCell_(header, value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.toISOString();
  if (TIME_FIELDS_[header]) {
    if (value === '') return '';
    if (typeof value === 'number') return new Date(value).toISOString();
    var parsed = Date.parse(String(value));
    return isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
  }
  if (header === 'room_code') {
    var room = String(value).replace(/\.0$/, '');
    if (/^\d+$/.test(room) && room.length < 6) room = ('000000' + room).slice(-6);
    return room;
  }
  if (header === 'points' || header === 'total_score' || header === 'order' || header === 'time_limit') {
    if (value === '') return '';
    var number = Number(value);
    return isNaN(number) ? '' : number;
  }
  if (header === 'is_correct') {
    if (value === true || value === false) return value;
    var flag = String(value).toLowerCase();
    if (flag === 'true') return true;
    if (flag === 'false') return false;
    return '';
  }
  return value;
}

function toCell_(header, value) {
  if (TIME_FIELDS_[header]) {
    if (value === '' || value === null || value === undefined) return '';
    var ms = typeof value === 'number' ? value : Date.parse(value);
    return isNaN(ms) ? '' : ms;
  }
  if (value === undefined || value === null) return '';
  return value;
}
