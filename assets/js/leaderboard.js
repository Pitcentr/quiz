function rankedRows(rows) {
  var copy = (rows || []).map(function (row) {
    return {
      player_id: row.player_id,
      name: row.name,
      total_score: Number(row.total_score) || 0,
      last_points: Number(row.last_points) || 0
    };
  });
  copy.sort(function (a, b) {
    return b.total_score - a.total_score || String(a.name).localeCompare(String(b.name), 'ru');
  });
  var place = 0;
  var previous = null;
  copy.forEach(function (row, index) {
    if (previous === null || row.total_score !== previous) {
      place = index + 1;
      previous = row.total_score;
    }
    row.place = place;
  });
  return copy;
}

function animateAward(container, rows) {
  var byId = {};
  (rows || []).forEach(function (row) { byId[row.player_id] = row; });
  Array.prototype.forEach.call(container.querySelectorAll('.lb-row'), function (item, index) {
    var row = byId[item.dataset.id];
    if (!row || !row.last_points) return;
    item.classList.add('awarding');
    var totalNode = item.querySelector('.lb-total');
    var from = row.total_score - row.last_points;
    var to = row.total_score;
    var start = null;
    setTimeout(playCoin, index * 90);
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / 800);
      var eased = 1 - Math.pow(1 - t, 3);
      if (totalNode) totalNode.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

function renderLeaderboard(container, rows, options) {
  options = options || {};
  if (options.ceremony && container.dataset.ceremony !== 'live') {
    container.dataset.ceremony = 'preview';
    var preview = (rows || []).map(function (row) {
      return {
        player_id: row.player_id,
        name: row.name,
        total_score: Math.max(0, Number(row.total_score) - Number(row.last_points || 0)),
        last_points: 0
      };
    });
    renderLeaderboard(container, rankedRows(preview), {
      compact: options.compact,
      scoresOnly: options.scoresOnly
    });
    setTimeout(function () {
      if (!container.isConnected) return;
      container.dataset.ceremony = 'live';
      container.dataset.sig = '';
      renderLeaderboard(container, rows, {
        compact: options.compact,
        scoresOnly: options.scoresOnly,
        award: true
      });
      playAward();
      animateAward(container, rows);
    }, 700);
    return;
  }
  var list = rows || [];
  var signature = list.map(function (row) {
    return [row.player_id, row.place, row.total_score, row.last_points, row.name, options.showStatus ? (row.answered ? 1 : 0) : ''].join(':');
  }).join('|');
  if (container.dataset.sig === signature) return;
  var previous = new Map();
  Array.prototype.forEach.call(container.querySelectorAll('.lb-row'), function (node) {
    previous.set(node.dataset.id, node.getBoundingClientRect());
  });
  container.dataset.sig = signature;
  container.classList.add('lb');
  if (options.compact) container.classList.add('compact');
  if (options.scoresOnly) container.classList.add('scores-only');
  if (options.showStatus) container.classList.add('with-status');
  if (options.award) container.classList.add('awarding-board');
  clearNode(container);
  if (!list.length) {
    container.appendChild(h('p', { class: 'empty', text: 'Рейтинг появится после первого вопроса.' }));
    return;
  }
  container.appendChild(h('div', { class: 'lb-head' }, [
    h('span', { text: 'Место' }),
    h('span', { text: 'Игрок' }),
    options.showStatus ? h('span', { text: 'Статус' }) : null,
    h('span', { class: 'lb-last', text: 'Вопрос' }),
    h('span', { text: 'Всего' })
  ]));
  var nodes = [];
  list.forEach(function (row, index) {
    var medal = row.place === 1 ? ' gold' : row.place === 2 ? ' silver' : row.place === 3 ? ' bronze' : '';
    if (options.award && row.last_points) medal += ' awarding';
    var last = row.last_points ? '+' + row.last_points : '0';
    var status = options.showStatus
      ? h('span', { class: 'lb-status ' + (row.answered ? 'ok' : 'wait'), text: row.answered ? 'ответил' : 'ждём' })
      : null;
    var item = h('div', { class: 'lb-row' + medal + (previous.size ? '' : ' lb-enter') }, [
      h('span', { class: 'lb-place', text: String(row.place) }),
      h('span', { class: 'lb-name' }, [
        playerAvatar(row.player_id || row.name),
        h('span', { class: 'who', text: row.name })
      ]),
      status,
      h('span', { class: 'lb-last' + (row.last_points ? ' plus' : ''), text: last }),
      h('span', { class: 'lb-total', text: String(row.total_score) })
    ]);
    item.dataset.id = row.player_id;
    item.style.animationDelay = previous.size ? '0s' : Math.min(index * 0.04, 0.4) + 's';
    container.appendChild(item);
    nodes.push(item);
  });
  if (!previous.size) return;
  nodes.forEach(function (item) {
    var old = previous.get(item.dataset.id);
    if (!old || !old.top) {
      item.classList.add('lb-enter');
      return;
    }
    var shift = old.top - item.getBoundingClientRect().top;
    if (Math.abs(shift) < 2) return;
    item.style.transform = 'translateY(' + shift + 'px)';
    item.style.transition = 'none';
    requestAnimationFrame(function () {
      item.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1)';
      item.style.transform = '';
    });
  });
}

function renderPodium(container, rows) {
  clearNode(container);
  var groups = { 1: [], 2: [], 3: [] };
  (rows || []).forEach(function (row) {
    if (groups[row.place]) groups[row.place].push(row);
  });
  [
    { place: 2, cls: 'second', label: '2' },
    { place: 1, cls: 'first', label: '1' },
    { place: 3, cls: 'third', label: '3' }
  ].forEach(function (slot) {
    var people = groups[slot.place];
    var faces = h('div', { class: 'podium-faces' });
    people.forEach(function (person) {
      faces.appendChild(playerAvatar(person.player_id || person.name));
    });
    container.appendChild(h('article', { class: 'podium-slot ' + slot.cls }, [
      h('div', { class: 'podium-rank', text: people.length ? slot.label : '—' }),
      people.length ? faces : null,
      h('h3', { text: people.length ? people.map(function (person) { return person.name; }).join(', ') : '—' }),
      h('p', { text: people.length ? people[0].total_score + ' ' + plural(people[0].total_score, 'балл', 'балла', 'баллов') : '' })
    ]));
  });
}
