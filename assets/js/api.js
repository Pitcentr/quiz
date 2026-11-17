function ApiError(info) {
  this.name = 'ApiError';
  this.isApi = true;
  this.code = info && info.code ? info.code : 'SERVER_ERROR';
  this.message = info && info.message ? info.message : 'Ошибка сервера';
}

function resolveApiUrl() {
  if (QUIZ_CONFIG.API_URL) return QUIZ_CONFIG.API_URL;
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return QUIZ_CONFIG.LOCAL_API_URL;
  return '';
}

function parseJsonBody(text) {
  var raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw error;
  }
}

function apiRequest(action, payload) {
  var url = resolveApiUrl();
  if (!url) {
    return Promise.reject(new ApiError({
      code: 'NO_API',
      message: 'Не задан адрес API. Откройте config.js и вставьте ссылку веб-приложения.'
    }));
  }
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () {
    if (controller) controller.abort();
  }, QUIZ_CONFIG.REQUEST_TIMEOUT_MS || 15000);
  return fetch(url, {
    method: 'POST',
    // text/plain — простой запрос без preflight. Так Google Apps Script отвечает браузеру.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action }, payload || {})),
    signal: controller ? controller.signal : undefined
  }).then(function (response) {
    return response.text();
  }).then(function (text) {
    var json;
    try {
      json = parseJsonBody(text);
    } catch (error) {
      throw new ApiError({
        code: 'BAD_RESPONSE',
        message: 'Сервер вернул непонятный ответ. Проверьте развёртывание Apps Script.'
      });
    }
    if (!json || json.success !== true) {
      throw new ApiError(json && json.error ? json.error : { code: 'SERVER_ERROR', message: 'Ошибка сервера' });
    }
    return json.data;
  }).catch(function (error) {
    if (error && (error.isApi || error.name === 'ApiError')) throw error;
    if (error && error.name === 'AbortError') {
      throw new ApiError({ code: 'TIMEOUT', message: 'Сервер не ответил вовремя' });
    }
    throw new ApiError({ code: 'NETWORK', message: 'Нет соединения с сервером' });
  }).then(function (data) {
    clearTimeout(timer);
    return data;
  }, function (error) {
    clearTimeout(timer);
    throw error;
  });
}
