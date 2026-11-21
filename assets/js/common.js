function h(tag, attrs, children) {
  var node = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach(function (key) {
    var value = attrs[key];
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  (children || []).forEach(function (child) {
    if (child === null || child === undefined || child === false) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function hashString(value) {
  var hash = 2166136261;
  var text = String(value || 'player');
  for (var i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function svgNode(tag, attrs) {
  var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach(function (key) {
    node.setAttribute(key, attrs[key]);
  });
  return node;
}

function playerAvatar(seed) {
  var hash = hashString(seed);
  var colors = ['#7c5cff', '#3ee0b0', '#ff5d73', '#ffb020', '#4c8dff', '#e06cff', '#ff7a45', '#46d6ff'];
  var skins = ['#ffe1c7', '#f3c094', '#d99058', '#a86b3c', '#8d5524', '#ffe8dc'];
  var bg = colors[hash % colors.length];
  var skin = skins[(hash >>> 3) % skins.length];
  var kind = (hash >>> 7) % 5;
  var eyes = (hash >>> 11) % 3;
  var mouth = (hash >>> 14) % 3;
  var svg = svgNode('svg', { class: 'avatar', viewBox: '0 0 64 64', 'aria-hidden': 'true' });
  svg.appendChild(svgNode('circle', { cx: '32', cy: '32', r: '32', fill: bg }));
  if (kind === 1) {
    svg.appendChild(svgNode('circle', { cx: '16', cy: '18', r: '8', fill: skin }));
    svg.appendChild(svgNode('circle', { cx: '48', cy: '18', r: '8', fill: skin }));
  } else if (kind === 2) {
    svg.appendChild(svgNode('ellipse', { cx: '14', cy: '24', rx: '7', ry: '10', fill: skin }));
    svg.appendChild(svgNode('ellipse', { cx: '50', cy: '24', rx: '7', ry: '10', fill: skin }));
  } else if (kind === 3) {
    svg.appendChild(svgNode('path', { d: 'M18 24 L22 8 L28 22 Z', fill: '#fff4d6' }));
    svg.appendChild(svgNode('path', { d: 'M46 24 L42 8 L36 22 Z', fill: '#fff4d6' }));
  } else if (kind === 4) {
    svg.appendChild(svgNode('line', { x1: '32', y1: '14', x2: '32', y2: '4', stroke: '#fff', 'stroke-width': '3', 'stroke-linecap': 'round' }));
    svg.appendChild(svgNode('circle', { cx: '32', cy: '4', r: '3', fill: '#fff' }));
  }
  svg.appendChild(svgNode('circle', { cx: '32', cy: '36', r: '16', fill: skin }));
  if (eyes === 2) {
    svg.appendChild(svgNode('path', { d: 'M22 34 Q26 30 30 34', fill: 'none', stroke: '#1c2233', 'stroke-width': '2', 'stroke-linecap': 'round' }));
    svg.appendChild(svgNode('circle', { cx: '40', cy: '34', r: '2.4', fill: '#1c2233' }));
  } else {
    var r = eyes === 1 ? '3.2' : '2.3';
    svg.appendChild(svgNode('circle', { cx: '26', cy: '34', r: r, fill: '#1c2233' }));
    svg.appendChild(svgNode('circle', { cx: '40', cy: '34', r: r, fill: '#1c2233' }));
  }
  if (mouth === 1) {
    svg.appendChild(svgNode('path', { d: 'M27 44 H37', fill: 'none', stroke: '#1c2233', 'stroke-width': '2', 'stroke-linecap': 'round' }));
  } else if (mouth === 2) {
    svg.appendChild(svgNode('ellipse', { cx: '32', cy: '45', rx: '4', ry: '3', fill: '#1c2233' }));
  } else {
    svg.appendChild(svgNode('path', { d: 'M26 43 Q32 49 38 43', fill: 'none', stroke: '#1c2233', 'stroke-width': '2', 'stroke-linecap': 'round' }));
  }
  if ((hash >>> 18) % 2 === 0) {
    svg.appendChild(svgNode('circle', { cx: '22', cy: '40', r: '2', fill: '#ff8aa0', opacity: '0.8' }));
    svg.appendChild(svgNode('circle', { cx: '42', cy: '40', r: '2', fill: '#ff8aa0', opacity: '0.8' }));
  }
  return svg;
}

function plural(n, one, few, many) {
  var n10 = n % 10;
  var n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

function formatRoom(code) {
  var value = String(code || '');
  return value.length === 6 ? value.slice(0, 3) + ' ' + value.slice(3) : value;
}

function formatMs(ms) {
  var seconds = Math.max(0, Math.ceil(ms / 1000));
  var minutes = Math.floor(seconds / 60);
  var rest = seconds % 60;
  if (minutes <= 0) return String(seconds);
  return minutes + ':' + (rest < 10 ? '0' : '') + rest;
}

function statusLabel(status) {
  return {
    waiting: 'Ожидание игроков',
    active: 'Игра идёт',
    finished: 'Игра завершена',
    archived: 'В архиве'
  }[status] || status || '';
}

function phaseLabel(phase) {
  return {
    none: 'Ожидание',
    open: 'Приём ответов',
    closed: 'Вопрос завершён',
    results: 'Результаты'
  }[phase] || '';
}

function joinNames(list) {
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + ' и ' + list[1];
  return list.slice(0, -1).join(', ') + ' и ' + list[list.length - 1];
}

function winnerText(rows) {
  var winners = (rows || []).filter(function (row) { return row.place === 1; }).map(function (row) { return row.name; });
  if (!winners.length) return 'Игра завершена';
  if (winners.length === 1) return 'Победитель — ' + winners[0];
  return 'Победители — ' + joinNames(winners);
}

function validateName(value) {
  var name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 20) return 'Имя должно содержать от 2 до 20 символов';
  if (!/^[\p{L}\p{N} \-']+$/u.test(name)) return 'Имя содержит недопустимые символы';
  return '';
}

function pageParams() {
  var search = new URLSearchParams(window.location.search);
  var hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  return {
    room: String(hash.get('room') || search.get('room') || '').replace(/\s+/g, ''),
    token: hash.get('token') || ''
  };
}

function appUrl(file) {
  return new URL(file, window.location.href).href;
}

function playerLink(room) {
  var url = new URL('player.html', window.location.href);
  url.searchParams.set('room', room);
  return url.href;
}

function hostLink(room, token) {
  var url = new URL('host.html', window.location.href);
  url.hash = 'room=' + encodeURIComponent(room) + '&token=' + encodeURIComponent(token);
  return url.href;
}

function readJson(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || 'null');
  } catch (error) {
    return null;
  }
}

function loadScreenSession() {
  return readJson(sessionStorage, 'quiz_screen');
}

function saveScreenSession(data) {
  sessionStorage.setItem('quiz_screen', JSON.stringify(data));
}

function clearScreenSession() {
  sessionStorage.removeItem('quiz_screen');
}

function savePlayerSession(data) {
  sessionStorage.setItem('quiz_player', JSON.stringify(data));
  localStorage.setItem('quiz_player_' + data.room_code, JSON.stringify(data));
}

function loadPlayerSession(room) {
  var tab = readJson(sessionStorage, 'quiz_player');
  if (tab && (!room || tab.room_code === room)) return tab;
  if (!room) return null;
  return readJson(localStorage, 'quiz_player_' + room);
}

function clearPlayerSession(room) {
  sessionStorage.removeItem('quiz_player');
  if (room) localStorage.removeItem('quiz_player_' + room);
}

function loadHostSession() {
  var params = pageParams();
  if (params.room && params.token) {
    var data = { room_code: params.room, host_token: params.token };
    sessionStorage.setItem('quiz_host', JSON.stringify(data));
    return data;
  }
  return readJson(sessionStorage, 'quiz_host');
}

function toast(message) {
  var box = document.getElementById('toasts');
  if (!box) return;
  var item = h('div', { class: 'toast', text: message });
  box.appendChild(item);
  setTimeout(function () {
    item.remove();
  }, 3800);
}

function setConnection(online) {
  var net = document.getElementById('net');
  if (!net) return;
  net.className = online ? 'net' : 'net off';
  net.textContent = online ? '' : 'Нет связи с сервером. Повторяем подключение…';
}

function confirmDialog(options) {
  return new Promise(function (resolve) {
    var root = document.getElementById('modal');
    var settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      root.className = 'modal';
      clearNode(root);
      resolve(value);
    }
    function onKey(event) {
      if (event.key === 'Escape') finish(false);
    }
    clearNode(root);
    root.className = 'modal show';
    var confirmButton = h('button', {
      class: 'btn ' + (options.danger ? 'danger' : 'primary'),
      type: 'button',
      text: options.confirmText || 'Подтвердить',
      onClick: function () { finish(true); }
    });
    root.appendChild(h('div', { class: 'modal-card' }, [
      h('h2', { text: options.title || 'Подтвердите' }),
      h('p', { text: options.text || '' }),
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn ghost', type: 'button', text: 'Отмена', onClick: function () { finish(false); } }),
        confirmButton
      ])
    ]));
    document.addEventListener('keydown', onKey);
    confirmButton.focus();
  });
}

function pollEvery(ms, fn) {
  var stopped = false;
  var running = false;
  function tick() {
    if (stopped || running) return;
    running = true;
    Promise.resolve().then(fn).then(function () {
      running = false;
    }, function () {
      running = false;
    });
  }
  tick();
  var id = setInterval(tick, ms);
  return function () {
    stopped = true;
    clearInterval(id);
  };
}

function createSyncedTimer(onTick) {
  var offset = 0;
  var deadline = 0;
  var total = 1;
  var id = 0;
  function remaining() {
    return Math.max(0, deadline - (Date.now() + offset));
  }
  function tick() {
    onTick(remaining(), total);
  }
  return {
    sync: function (serverTime, openedAt, seconds) {
      var server = Date.parse(serverTime);
      var opened = Date.parse(openedAt);
      if (!server || !opened || !seconds) return;
      offset = server - Date.now();
      deadline = opened + seconds * 1000;
      total = seconds * 1000;
      tick();
    },
    start: function () {
      if (id) return;
      id = setInterval(tick, 200);
      tick();
    },
    stop: function () {
      clearInterval(id);
      id = 0;
    }
  };
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      toast('Скопировано');
    }, function () {
      toast(text);
    });
    return;
  }
  toast(text);
}

function brandNode() {
  return h('div', { class: 'brand' }, [
    h('span', { class: 'logo', 'aria-hidden': 'true', text: '?' }),
    h('div', {}, [
      h('strong', { text: 'КВИЗ' }),
      h('small', { text: 'Живая викторина' })
    ])
  ]);
}

function topbar(right) {
  return h('header', { class: 'topbar' }, [brandNode(), right || h('span')]);
}

function mountQr(element, text, size, level) {
  clearNode(element);
  if (typeof QRCode === 'undefined') {
    element.textContent = 'QR-код недоступен';
    return;
  }
  try {
    var qr = new QRCode(element, {
      text: text,
      width: size || 320,
      height: size || 320,
      colorDark: '#101218',
      colorLight: '#ffffff',
      correctLevel: level || QRCode.CorrectLevel.M
    });
    // Библиотека обводит клетки линией, и между ними появляются белые щели.
    // Готовый рисунок кладём в img: в Safari холст с height:auto часто остаётся пустым.
    paintCrispQr(element, qr._oQRCode, size || 320);
  } catch (error) {
    clearNode(element);
    element.appendChild(h('p', { class: 'qr-error', text: 'Не удалось построить QR-код' }));
  }
}

function paintCrispQr(element, model, maxPx) {
  if (!model || typeof model.getModuleCount !== 'function' || typeof model.isDark !== 'function') return;
  var count = model.getModuleCount();
  var quiet = 4;
  var cells = count + quiet * 2;
  var cell = Math.max(4, Math.floor(maxPx / cells));
  var side = cell * cells;
  var canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = '#101218';
  var dark = 0;
  for (var row = 0; row < count; row += 1) {
    for (var col = 0; col < count; col += 1) {
      if (!model.isDark(row, col)) continue;
      dark += 1;
      ctx.fillRect((col + quiet) * cell, (row + quiet) * cell, cell, cell);
    }
  }
  if (!dark) {
    clearNode(element);
    element.appendChild(h('p', { class: 'qr-error', text: 'Не удалось построить QR-код' }));
    return;
  }
  var image = document.createElement('img');
  image.alt = 'QR-код';
  image.width = side;
  image.height = side;
  image.src = canvas.toDataURL('image/png');
  clearNode(element);
  element.appendChild(image);
}

function joinPageLink() {
  return new URL('player.html', window.location.href).href;
}

function linkLabel(url) {
  try {
    var parsed = new URL(url);
    return (parsed.host + parsed.pathname).replace(/\/$/, '');
  } catch (error) {
    return url;
  }
}

function paintOptions(container, question, options) {
  clearNode(container);
  ['A', 'B', 'C', 'D'].forEach(function (letter) {
    var className = 'opt ' + letter.toLowerCase();
    var people = options.faces && options.faces[letter];
    if (options.selected === letter) className += ' picked';
    if (options.correct && options.correct === letter) className += ' right';
    if (options.blink && options.correct === letter) className += ' blink';
    if (options.correct && options.selected === letter && options.selected !== options.correct) className += ' bad';
    if (people && people.length) className += ' has-faces';
    var line = h('span', { class: 'opt-line' }, [
      h('span', { class: 'key', text: letter }),
      h('span', { class: 'label', text: question.answers[letter] || '' })
    ]);
    var children = [line];
    if (people && people.length) {
      children.push(h('span', { class: 'faces' }, people.map(function (player, index) {
        var face = h('span', { class: 'face', title: player.name }, [
          playerAvatar(player.player_id || player.name),
          h('span', { class: 'face-name', text: player.name })
        ]);
        face.style.animationDelay = Math.min(index, 8) * 45 + 'ms';
        return face;
      })));
    }
    var button = h('button', {
      type: 'button',
      class: className,
      'data-letter': letter,
      onClick: options.interactive ? function () { options.onPick(letter); } : null
    }, children);
    if (!options.interactive || options.locked) button.disabled = true;
    container.appendChild(button);
  });
}

function meterNode(current, total) {
  var pct = total ? Math.max(0, Math.min(100, ((current - 1) / total) * 100)) : 0;
  return h('div', { class: 'meter' }, [
    h('span', { id: 'meter-bar', style: 'width:' + pct + '%' })
  ]);
}

function updateMeter(current, total) {
  var bar = document.getElementById('meter-bar');
  if (!bar || !total) return;
  var pct = Math.max(0, Math.min(100, ((current - 1) / total) * 100));
  bar.style.width = pct + '%';
}

function isTransient(error) {
  return error && ['NETWORK', 'TIMEOUT', 'BAD_RESPONSE', 'CONFLICT', 'SERVER_ERROR'].indexOf(error.code) !== -1;
}

function clearConfetti() {
  var old = document.querySelector('.confetti');
  if (old) old.remove();
}

var serverClockOffset = 0;
var audioCtx = null;
var PICKS_MS = 1000;
var COUNTDOWN_MS = 6000;
var BLINK_MS = 5000;
var REVEAL_MS = PICKS_MS + COUNTDOWN_MS + BLINK_MS;
var revealAnchor = 0;

function noteServerTime(isoTime) {
  var parsed = Date.parse(isoTime || '');
  if (!isNaN(parsed)) serverClockOffset = parsed - Date.now();
}

function serverNow() {
  return Date.now() + serverClockOffset;
}

function elapsedSince(closedAt) {
  var closed = Date.parse(closedAt || '');
  if (isNaN(closed)) return 0;
  return serverNow() - closed;
}

function noteRevealStart() {
  if (!revealAnchor) revealAnchor = Date.now();
}

function clearRevealStart() {
  revealAnchor = 0;
}

function revealElapsed(closedAt) {
  if (revealAnchor) return Date.now() - revealAnchor;
  return elapsedSince(closedAt);
}

function revealRemaining(closedAt) {
  return Math.max(0, REVEAL_MS - revealElapsed(closedAt));
}

function revealPhase(closedAt) {
  var elapsed = revealElapsed(closedAt);
  if (elapsed < PICKS_MS) return 'picks';
  if (elapsed < PICKS_MS + COUNTDOWN_MS) return 'countdown';
  if (elapsed < REVEAL_MS) return 'blink';
  return 'done';
}

function countdownNumber(closedAt) {
  var into = revealElapsed(closedAt) - PICKS_MS;
  if (into < 0) return 5;
  return Math.max(0, 5 - Math.floor(into / 1000));
}

function clearAutoAdvance(state) {
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.key = '';
}

function armAutoAdvance(state, data, credentials, onDone) {
  if (!state || !credentials || !credentials.host_token || !data) return;
  if (data.status !== 'active' || (data.question_phase !== 'closed' && data.question_phase !== 'results')) {
    clearAutoAdvance(state);
    clearRevealStart();
    return;
  }
  if (data.question_phase === 'closed') noteRevealStart();
  var qid = data.question && data.question.id ? data.question.id : '';
  var key = qid + ':' + data.question_phase;
  if (state.key === key && state.timer) return;
  clearAutoAdvance(state);
  state.key = key;
  var delay = data.question_phase === 'closed'
    ? revealRemaining(data.question_closed_at)
    : 0;
  state.timer = setTimeout(function () {
    state.timer = null;
    sendAdvance(data.is_last_question ? 'finishGame' : 'nextQuestion', credentials, 0, onDone);
  }, delay + 300);
}

function sendAdvance(action, credentials, attempt, onDone) {
  apiRequest(action, {
    host_token: credentials.host_token,
    room_code: credentials.room_code
  }).then(function () {
    if (onDone) onDone();
  }).catch(function (error) {
    var code = error && error.code;
    if (attempt < 1 && (code === 'CONFLICT' || code === 'NETWORK' || code === 'TIMEOUT')) {
      setTimeout(function () { sendAdvance(action, credentials, attempt + 1, onDone); }, 800);
      return;
    }
    if (['REVEAL_IN_PROGRESS', 'RESULTS_NOT_READY', 'NO_MORE_QUESTIONS', 'QUESTION_STILL_OPEN', 'ALREADY_FINISHED', 'GAME_NOT_ACTIVE', 'QUESTION_NOT_OPEN'].indexOf(code) === -1) {
      toast(error && error.message ? error.message : 'Не удалось перейти дальше');
    }
    if (onDone) onDone();
  });
}

function audioContext() {
  var Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  if (!audioCtx) audioCtx = new Context();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, type, volume) {
  var ctx = audioContext();
  if (!ctx) return;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  var now = ctx.currentTime;
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume || 0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function playTick(beat) {
  var last = beat === 0;
  playTone(last ? 523 : 880, last ? 0.16 : 0.1, 'sine', 0.14);
  playTone(last ? 784 : 1320, last ? 0.22 : 0.08, 'triangle', 0.07);
}

function playReveal() {
  playTone(392, 0.2, 'sine', 0.05);
  setTimeout(function () { playTone(523, 0.24, 'sine', 0.05); }, 110);
}

function playAnswerLock() {
  playTone(494, 0.07, 'sine', 0.045);
  setTimeout(function () { playTone(740, 0.11, 'triangle', 0.05); }, 55);
}

function playAnswerShow() {
  playTone(196, 0.32, 'sine', 0.04);
  [523, 659, 784, 1047].forEach(function (freq, index) {
    setTimeout(function () { playTone(freq, 0.32, 'triangle', 0.06); }, 90 + index * 130);
  });
}

var GONG_TRACKS = ['assets/audio/gong.mp3', 'assets/audio/gong.wav', 'assets/audio/gong.m4a', 'assets/audio/gong.ogg'];

function playGong() {
  var audio = new Audio();
  var index = 0;
  var started = false;
  function tone() {
    if (started) return;
    started = true;
    playGongTone();
  }
  audio.preload = 'auto';
  audio.volume = 1;
  audio.addEventListener('error', function () {
    if (started) return;
    index += 1;
    if (index >= GONG_TRACKS.length) {
      tone();
      return;
    }
    audio.src = new URL(GONG_TRACKS[index], window.location.href).href;
  });
  audio.addEventListener('playing', function () { started = true; });
  function start() {
    var pending = audio.play();
    if (pending && pending.catch) pending.catch(tone);
  }
  audio.addEventListener('canplay', function onReady() {
    audio.removeEventListener('canplay', onReady);
    start();
  });
  audio.src = new URL(GONG_TRACKS[0], window.location.href).href;
}

function playGongTone() {
  var ctx = audioContext();
  if (!ctx) return;
  var now = ctx.currentTime;
  var master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.7, now + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
  master.connect(ctx.destination);
  [92, 138, 184, 233, 294, 370].forEach(function (freq, index) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = index % 2 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq * 1.03, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 1.5);
    gain.gain.setValueAtTime(index === 0 ? 0.85 : 0.22 / index, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2 - index * 0.12);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 2.4);
  });
  var duration = 0.16;
  var length = Math.floor(ctx.sampleRate * duration);
  var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  var data = buffer.getChannelData(0);
  for (var i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
  var noise = ctx.createBufferSource();
  var filter = ctx.createBiquadFilter();
  var noiseGain = ctx.createGain();
  noise.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = 220;
  filter.Q.value = 0.7;
  noiseGain.gain.setValueAtTime(0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(now);
  noise.stop(now + duration);
}

function playRankOpen() {
  playTone(165, 0.28, 'sine', 0.05);
  setTimeout(function () { playTone(220, 0.24, 'sine', 0.045); }, 120);
  setTimeout(function () { playTone(330, 0.36, 'triangle', 0.05); }, 240);
}

function playAward() {
  [523, 659, 784, 1046].forEach(function (freq, index) {
    setTimeout(function () { playTone(freq, 0.18, 'triangle', 0.05); }, index * 90);
  });
}

function playCoin() {
  playTone(988, 0.07, 'square', 0.025);
  setTimeout(function () { playTone(1480, 0.1, 'sine', 0.04); }, 45);
}

var waitBed = null;
var closingQuestionId = '';

var WAIT_TRACKS = ['assets/audio/wait.m4a', 'assets/audio/wait.mp3', 'assets/audio/wait.ogg', 'assets/audio/wait.wav'];

function ensureWaitBed() {
  if (waitBed) return waitBed;
  var audio = new Audio();
  var bed = { audio: audio, alive: true, index: 0, want: false, fade: null };
  waitBed = bed;
  audio.loop = true;
  audio.volume = 0.048;
  audio.preload = 'auto';
  audio.addEventListener('playing', function () { bed.started = true; });
  audio.addEventListener('error', function () {
    if (!bed.alive || waitBed !== bed || bed.started) return;
    bed.index += 1;
    if (bed.index >= WAIT_TRACKS.length) return;
    audio.src = new URL(WAIT_TRACKS[bed.index], window.location.href).href;
  });
  audio.addEventListener('canplaythrough', function () {
    bed.ready = true;
    if (bed.want) playWaitBed();
  });
  bed.play = playWaitBed;
  audio.src = new URL(WAIT_TRACKS[0], window.location.href).href;
  return bed;
}

function playWaitBed() {
  var bed = waitBed;
  if (!bed || !bed.alive || !bed.want) return;
  if (bed.fade) {
    clearInterval(bed.fade);
    bed.fade = null;
  }
  bed.audio.volume = 0.048;
  var pending = bed.audio.play();
  if (pending && pending.catch) pending.catch(function () {});
}

function startWaitBed() {
  var bed = ensureWaitBed();
  bed.want = true;
  playWaitBed();
}

function preloadWaitBed() {
  ensureWaitBed();
}

function stopWaitBed(immediate) {
  if (!waitBed) return;
  var bed = waitBed;
  var audio = bed.audio;
  bed.want = false;
  if (bed.fade) clearInterval(bed.fade);
  if (!audio) return;
  if (immediate) {
    bed.fade = null;
    audio.pause();
    return;
  }
  bed.fade = setInterval(function () {
    if (bed.want) {
      clearInterval(bed.fade);
      bed.fade = null;
      return;
    }
    var next = Math.max(0, audio.volume - 0.1);
    audio.volume = next;
    if (next > 0) return;
    clearInterval(bed.fade);
    bed.fade = null;
    audio.pause();
  }, 40);
}

function closeIfEveryoneAnswered(data, credentials, onDone) {
  if (!credentials || !credentials.host_token || !data) return;
  if (data.status !== 'active' || data.question_phase !== 'open') {
    closingQuestionId = '';
    return;
  }
  if (!data.player_count || Number(data.answered_count) < Number(data.player_count)) return;
  var qid = data.question && data.question.id ? data.question.id : '';
  if (!qid || closingQuestionId === qid) return;
  closingQuestionId = qid;
  apiRequest('finishQuestion', {
    host_token: credentials.host_token,
    room_code: credentials.room_code
  }).then(function () {
    if (onDone) onDone();
  }).catch(function (error) {
    var code = error && error.code;
    if (code === 'QUESTION_NOT_OPEN' || code === 'GAME_NOT_ACTIVE') {
      if (onDone) onDone();
      return;
    }
    closingQuestionId = '';
    if (code !== 'CONFLICT' && code !== 'NETWORK' && code !== 'TIMEOUT') {
      toast(error && error.message ? error.message : 'Не удалось закрыть вопрос');
    }
  });
}

document.addEventListener('pointerdown', function () {
  audioContext();
  if (waitBed && waitBed.play) waitBed.play();
});

function showConfetti() {
  clearConfetti();
  var layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  var colors = ['#ffd56a', '#7c5cff', '#3ee0b0', '#ff5d73', '#8ec5ff', '#fff4d0', '#ff9f43'];
  for (var i = 0; i < 90; i += 1) {
    var piece = document.createElement('i');
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.animationDelay = (Math.random() * 2.8) + 's';
    piece.style.animationDuration = (2.2 + Math.random() * 2.4) + 's';
    piece.style.background = colors[i % colors.length];
    piece.style.width = (6 + Math.round(Math.random() * 8)) + 'px';
    piece.style.height = (10 + Math.round(Math.random() * 14)) + 'px';
    piece.style.setProperty('--drift', Math.round(Math.random() * 180 - 90) + 'px');
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
}
