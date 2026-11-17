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
    // Камера их не читает, поэтому рисуем клетки целыми пикселями без обводки.
    paintCrispQr(element, qr._oQRCode, size || 320);
  } catch (error) {
    element.textContent = 'Не удалось построить QR-код';
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
  for (var row = 0; row < count; row += 1) {
    for (var col = 0; col < count; col += 1) {
      if (model.isDark(row, col)) ctx.fillRect((col + quiet) * cell, (row + quiet) * cell, cell, cell);
    }
  }
  clearNode(element);
  element.appendChild(canvas);
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
    if (options.selected === letter) className += ' picked';
    if (options.correct && options.correct === letter) className += ' right';
    if (options.correct && options.selected === letter && options.selected !== options.correct) className += ' bad';
    var button = h('button', {
      type: 'button',
      class: className,
      onClick: options.interactive ? function () { options.onPick(letter); } : null
    }, [
      h('span', { class: 'key', text: letter }),
      h('span', { class: 'label', text: question.answers[letter] || '' })
    ]);
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

function noteServerTime(isoTime) {
  var parsed = Date.parse(isoTime || '');
  if (!isNaN(parsed)) serverClockOffset = parsed - Date.now();
}

function revealRemaining(closedAt) {
  var closed = Date.parse(closedAt || '');
  if (isNaN(closed)) return 0;
  return Math.max(0, closed + 5000 - (Date.now() + serverClockOffset));
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

function playTick() {
  playTone(180, 0.045, 'square', 0.03);
  playTone(880, 0.06, 'sine', 0.05);
}

function playReveal() {
  playTone(392, 0.2, 'sine', 0.05);
  setTimeout(function () { playTone(523, 0.24, 'sine', 0.05); }, 110);
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

document.addEventListener('pointerdown', function () { audioContext(); });

function showConfetti() {
  clearConfetti();
  var layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  var colors = ['#ffd56a', '#7c5cff', '#3ee0b0', '#ff5d73', '#8ec5ff'];
  for (var i = 0; i < 28; i += 1) {
    var piece = document.createElement('i');
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.animationDelay = (Math.random() * 1.2) + 's';
    piece.style.background = colors[i % colors.length];
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
}
