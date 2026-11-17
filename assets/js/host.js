(function () {
  var app = document.getElementById('app');
  var session = loadHostSession();
  var snapshot = null;
  var stopPoll = null;
  var revealWatch = null;
  var busy = false;

  function stopRevealWatch() {
    if (revealWatch) {
      clearInterval(revealWatch);
      revealWatch = null;
    }
  }

  function setScreen(node) {
    stopRevealWatch();
    clearNode(app);
    app.appendChild(node);
  }

  function renderMissing() {
    app.dataset.key = 'missing';
    setScreen(h('div', { class: 'shell host' }, [
      topbar(),
      h('section', { class: 'card' }, [
        h('h1', { text: 'Нужен код ведущего' }),
        h('p', { class: 'lead', text: 'Откройте эту страницу по QR-коду с экрана игры. Обычная ссылка без кода не управляет комнатой.' })
      ])
    ]));
  }

  function ensurePoll() {
    if (stopPoll) return;
    stopPoll = pollEvery(QUIZ_CONFIG.POLL_HOST_MS, refresh);
  }

  function refresh() {
    if (!session) return Promise.resolve();
    return apiRequest('getGame', {
      host_token: session.host_token,
      room_code: session.room_code
    }).then(function (data) {
      noteServerTime(data.server_time);
      snapshot = data;
      setConnection(true);
      render(data);
    }).catch(function (error) {
      if (error.code === 'UNAUTHORIZED' || error.code === 'GAME_ARCHIVED' || error.code === 'ROOM_NOT_FOUND') {
        if (stopPoll) stopPoll();
        stopPoll = null;
        sessionStorage.removeItem('quiz_host');
        setScreen(h('div', { class: 'shell host' }, [
          topbar(),
          h('section', { class: 'card' }, [
            h('h1', { text: 'Нет доступа' }),
            h('p', { class: 'lead', text: error.message })
          ])
        ]));
        return;
      }
      setConnection(false);
    });
  }

  function keyOf(data) {
    var qid = data.question ? data.question.id : '';
    return data.status + ':' + data.question_phase + ':' + qid;
  }

  function render(data) {
    var key = keyOf(data);
    if (app.dataset.key === key) {
      update(data);
      return;
    }
    app.dataset.key = key;
    mount(data);
  }

  function mount(data) {
    document.title = 'КВИЗ · ведущий ' + formatRoom(data.room_code);
    var people = h('div', { id: 'host-people' });
    var questionBlock = data.question ? questionCard(data) : h('section', { class: 'card host-q' }, [
      h('h1', { text: 'Игроки подключаются' }),
      h('p', { class: 'lead', id: 'host-wait', text: 'Когда все на месте, начните игру. Войти после старта уже нельзя.' })
    ]);
    setScreen(h('div', { class: 'shell host' }, [
      topbar(h('div', { class: 'pill', id: 'host-phase', text: phaseText(data) })),
      h('section', { class: 'stats' }, [
        stat('Код', formatRoom(data.room_code), 'host-room'),
        stat('Игроки', String(data.player_count), 'host-count'),
        stat('Ответили', data.player_count ? data.answered_count + ' / ' + data.player_count : '—', 'host-answered')
      ]),
      questionBlock,
      h('section', { class: 'card' }, [
        h('h2', { text: 'Участники' }),
        people
      ]),
      data.leaderboard ? h('section', { class: 'card' }, [
        h('h2', { text: 'Рейтинг' }),
        h('div', { id: 'host-board' })
      ]) : null,
      h('div', { class: 'actions' }, [actionButton(data)])
    ]));
    renderPeople(people, data);
    if (data.leaderboard) renderLeaderboard(document.getElementById('host-board'), data.leaderboard, { compact: true });
    watchReveal(data);
  }

  function stat(label, value, id) {
    return h('article', { class: 'card stat' }, [
      h('span', { text: label }),
      h('strong', { id: id, text: value })
    ]);
  }

  function phaseText(data) {
    if (data.status === 'waiting') return statusLabel(data.status);
    if (data.status === 'finished') return statusLabel(data.status);
    return phaseLabel(data.question_phase);
  }

  function questionCard(data) {
    var question = data.question;
    var reveal = data.question_phase === 'closed' || data.question_phase === 'results';
    var options = h('div', { class: 'options stack', id: 'options' });
    paintOptions(options, question, {
      interactive: false,
      correct: reveal ? question.correct_answer : null,
      locked: true
    });
    return h('section', { class: 'card host-q' }, [
      h('div', { class: 'split' }, [
        h('p', { class: 'eyebrow', text: 'Вопрос ' + question.number + ' из ' + question.total })
      ]),
      meterNode(question.number, question.total),
      h('h1', { class: 'q-text', text: question.question }),
      options,
      reveal && question.correct_answer ? h('p', {
        class: 'correct-line',
        text: 'Верный ответ: ' + question.correct_answer + ' · ' + question.answers[question.correct_answer]
      }) : null
    ]);
  }

  function actionButton(data) {
    if (data.status === 'waiting') return button('Начать игру', false, confirmStart);
    if (data.status === 'finished') {
      return h('div', { class: 'action-row' }, [
        h('a', { class: 'btn primary', href: appUrl('index.html'), text: 'Создать новую игру' }),
        button('Архивировать', true, confirmArchive)
      ]);
    }
    if (data.question_phase === 'open') return button('Завершить вопрос', true, confirmFinishQuestion);
    if (data.question_phase === 'closed' || data.question_phase === 'results') {
      var last = !!data.is_last_question;
      var left = data.question_phase === 'closed' ? revealRemaining(data.question_closed_at) : 0;
      var label = last ? 'Завершить игру' : 'Далее';
      var node = button(left > 0 ? 'Ответ на экране · ' + Math.ceil(left / 1000) : label, last, last ? confirmFinishGame : confirmNext, 'host-action');
      if (left > 0) node.disabled = true;
      return node;
    }
    return h('span');
  }

  function button(text, danger, onClick, id) {
    var attrs = {
      class: 'btn block ' + (danger ? 'danger' : 'primary'),
      type: 'button',
      text: text,
      onClick: onClick
    };
    if (id) attrs.id = id;
    return h('button', attrs);
  }

  function confirmStart() {
    confirmDialog({
      title: 'Начать игру?',
      text: 'Новые игроки уже не смогут подключиться. На экране откроется первый вопрос.',
      confirmText: 'Начать'
    }).then(function (ok) { if (ok) run('startGame'); });
  }

  function confirmFinishQuestion() {
    confirmDialog({
      title: 'Завершить вопрос?',
      text: 'Приём ответов остановится. Кто не ответил, получит 0. На экране появится правильный ответ, затем рейтинг.',
      confirmText: 'Завершить',
      danger: true
    }).then(function (ok) { if (ok) run('finishQuestion'); });
  }

  function confirmNext() {
    confirmDialog({
      title: 'Следующий вопрос?',
      text: 'Игроки сразу увидят новый вопрос.',
      confirmText: 'Далее'
    }).then(function (ok) { if (ok) run('nextQuestion'); });
  }

  function confirmFinishGame() {
    confirmDialog({
      title: 'Завершить игру?',
      text: 'Будет показан итоговый рейтинг. Изменить баллы после этого нельзя.',
      confirmText: 'Завершить',
      danger: true
    }).then(function (ok) { if (ok) run('finishGame'); });
  }

  function confirmArchive() {
    confirmDialog({
      title: 'Архивировать комнату?',
      text: 'Код перестанет открываться. Результаты останутся в таблице.',
      confirmText: 'В архив',
      danger: true
    }).then(function (ok) { if (ok) run('archiveGame'); });
  }

  function run(action) {
    if (busy || !session) return;
    busy = true;
    apiRequest(action, { host_token: session.host_token, room_code: session.room_code }).then(function () {
      return refresh();
    }).catch(function (error) {
      toast(error.message || 'Не получилось выполнить действие');
    }).then(function () {
      busy = false;
    });
  }

  function renderPeople(container, data) {
    var players = data.players || [];
    var sig = players.map(function (player) {
      return [player.player_id, player.answered ? 1 : 0, player.answer || '', player.points || 0, player.total_score].join(':');
    }).join('|');
    if (container.dataset.sig === sig) return;
    container.dataset.sig = sig;
    clearNode(container);
    if (!players.length) {
      container.appendChild(h('p', { class: 'empty', text: 'Никто ещё не подключился.' }));
      return;
    }
    var reveal = data.question_phase === 'closed' || data.question_phase === 'results';
    players.forEach(function (player) {
      var mark = '•';
      var markClass = 'mark';
      if (data.question_phase === 'open') {
        mark = player.answered ? '✓' : '•';
        if (player.answered) markClass += ' ok';
      } else if (reveal) {
        mark = player.answered ? (player.is_correct ? '✓' : '✕') : '–';
        markClass += player.is_correct ? ' ok' : player.answered ? ' bad' : '';
      }
      container.appendChild(h('div', { class: 'person' }, [
        h('span', { class: markClass, text: mark }),
        h('span', { class: 'nm', text: player.name }),
        h('span', { class: 'pts', text: reveal ? String(player.points || 0) : (player.answered ? 'ответил' : '') })
      ]));
    });
  }

  function watchReveal(data) {
    stopRevealWatch();
    if (!data || data.question_phase !== 'closed') return;
    revealWatch = setInterval(function () {
      var button = document.getElementById('host-action');
      if (!button || !snapshot) return;
      var left = revealRemaining(snapshot.question_closed_at);
      var label = snapshot.is_last_question ? 'Завершить игру' : 'Далее';
      if (left > 0) {
        button.disabled = true;
        button.textContent = 'Ответ на экране · ' + Math.ceil(left / 1000);
      } else if (button.disabled) {
        button.disabled = false;
        button.textContent = label;
      }
    }, 200);
  }

  function update(data) {
    var phase = document.getElementById('host-phase');
    if (phase) phase.textContent = phaseText(data);
    var count = document.getElementById('host-count');
    if (count) count.textContent = String(data.player_count);
    var answered = document.getElementById('host-answered');
    if (answered) answered.textContent = data.player_count ? data.answered_count + ' / ' + data.player_count : '—';
    var people = document.getElementById('host-people');
    if (people) renderPeople(people, data);
    if (data.question) updateMeter(data.question.number, data.question.total);
    var board = document.getElementById('host-board');
    if (board && data.leaderboard) renderLeaderboard(board, data.leaderboard, { compact: true });
  }

  if (!session || !session.host_token || !session.room_code) {
    renderMissing();
  } else {
    setScreen(h('div', { class: 'shell host' }, [
      topbar(),
      h('section', { class: 'card' }, [h('h1', { text: 'Подключаемся…' })])
    ]));
    refresh().then(ensurePoll);
  }
})();
