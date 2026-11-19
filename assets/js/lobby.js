(function () {
  var app = document.getElementById('app');
  var session = loadScreenSession();
  var snapshot = null;
  var stopPoll = null;
  var revealClock = null;
  var creating = false;
  var heardQuestion = '';
  var heardAnswers = 0;
  var advanceState = { timer: null, key: '' };
  var closedBoard = null;

  function stopReveal() {
    if (revealClock) {
      clearInterval(revealClock);
      revealClock = null;
    }
  }

  function setScreen(node) {
    stopReveal();
    stopWaitBed();
    clearConfetti();
    clearNode(app);
    app.appendChild(node);
  }

  function setupCard() {
    return h('section', { class: 'card home-card' }, [
      h('p', { class: 'eyebrow', text: 'Экран ведущего' }),
      h('h1', { text: 'Соберите команду у экрана' }),
      h('p', { class: 'lead', text: 'Создайте комнату, покажите два QR-кода и запустите вопросы, когда все будут на месте.' }),
      h('div', { class: 'steps' }, [
        step('1', 'Создайте игру на этом экране'),
        step('2', 'Игроки сканируют первый код'),
        step('3', 'Ведущий открывает панель вторым кодом')
      ]),
      h('button', {
        class: 'btn primary block',
        type: 'button',
        id: 'create-btn',
        text: 'Создать игру',
        onClick: createGame
      })
    ]);
  }

  function step(num, text) {
    return h('div', {}, [
      h('span', { class: 'num', text: num }),
      h('span', { text: text })
    ]);
  }

  function renderCreate(note) {
    app.dataset.key = 'create';
    document.title = 'КВИЗ — живая викторина';
    var screen = h('div', { class: 'shell' }, [topbar(), setupCard()]);
    if (!resolveApiUrl()) {
      screen.appendChild(h('p', { class: 'warn', text: 'Укажите адрес Google Apps Script в config.js. Для проверки на этом компьютере выполните npm start и откройте http://127.0.0.1:8787/' }));
    }
    if (note) screen.appendChild(h('p', { class: 'warn', text: note }));
    setScreen(screen);
  }

  function createGame() {
    if (creating) return;
    creating = true;
    var button = document.getElementById('create-btn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Создаём…';
    }
    apiRequest('createGame', {}).then(function (data) {
      session = {
        game_id: data.game_id,
        room_code: data.room_code,
        host_token: data.host_token
      };
      saveScreenSession(session);
      return refresh();
    }).catch(function (error) {
      creating = false;
      toast(error.message || 'Не удалось создать игру');
      if (button) {
        button.disabled = false;
        button.textContent = 'Создать игру';
      }
    }).then(function () {
      creating = false;
      ensurePoll();
    });
  }

  function ensurePoll() {
    if (stopPoll || !session) return;
    stopPoll = pollEvery(QUIZ_CONFIG.POLL_SCREEN_MS, refresh);
  }

  function refresh() {
    if (!session) return Promise.resolve();
    return apiRequest('getGame', { room_code: session.room_code }).then(function (data) {
      noteServerTime(data.server_time);
      snapshot = data;
      setConnection(true);
      render(data);
    }).catch(function (error) {
      if (error.code === 'GAME_ARCHIVED' || error.code === 'ROOM_NOT_FOUND') {
        clearAutoAdvance(advanceState);
        if (stopPoll) stopPoll();
        stopPoll = null;
        clearScreenSession();
        session = null;
        snapshot = null;
        renderCreate(error.message);
        return;
      }
      setConnection(false);
      if (!snapshot) {
        app.dataset.key = 'offline';
        setScreen(h('div', { class: 'shell' }, [
          topbar(),
          h('section', { class: 'card' }, [
            h('h1', { text: 'Подключаемся…' }),
            h('p', { class: 'muted', text: error.message })
          ])
        ]));
      }
    });
  }

  function viewOf(data) {
    if (!data) return 'create';
    if (data.status === 'finished') return 'final';
    if (data.status === 'waiting') return 'lobby';
    if (data.question_phase === 'open') return 'question';
    if (data.question_phase === 'closed' || data.question_phase === 'results') {
      if (countdownRemaining(data.question_closed_at) > 0) return 'countdown';
      return 'answer';
    }
    return 'lobby';
  }

  function render(data) {
    closeIfEveryoneAnswered(data, session, refresh);
    rememberClosedBoard(data);
    armAutoAdvance(advanceState, data, session, refresh);
    var view = viewOf(data);
    var qid = data.question ? data.question.id : '';
    var key = view + ':' + qid;
    if (app.dataset.key === key) {
      update(view, data);
      return;
    }
    app.dataset.key = key;
    if (view === 'lobby') mountLobby(data);
    else if (view === 'question') mountQuestion(data);
    else if (view === 'countdown') mountCountdown(data);
    else if (view === 'answer') mountAnswer(data);
    else if (view === 'final') mountFinal(data);
  }

  function mountLobby(data) {
    document.title = 'КВИЗ · ' + formatRoom(data.room_code);
    var grid = h('div', { class: 'player-grid', id: 'player-grid' });
    var screen = h('div', { class: 'shell' }, [
      topbar(screenBar(statusLabel(data.status), 'phase-pill')),
      h('section', { class: 'lobby' }, [
        h('div', { class: 'card lobby-main' }, [
          h('p', { class: 'eyebrow', text: 'Код комнаты' }),
          h('div', { class: 'room-code', id: 'room-code', text: formatRoom(data.room_code) }),
          h('div', { class: 'code-actions' }, [
            h('button', { class: 'btn ghost', type: 'button', text: 'Скопировать код', onClick: function () { copyText(data.room_code); } })
          ]),
          playerFallback(data.room_code),
          h('p', { class: 'muted', id: 'question-count', text: questionCountText(data) }),
          h('div', { class: 'qr-grid' }, [
            qrCard('Игроки', 'Сканируйте, чтобы войти', 'qr-player'),
            session.host_token
              ? qrCard('Ведущий', 'Панель управления', 'qr-host', hostFallback(data.room_code, session.host_token))
              : h('article', { class: 'qr-card' }, [
                h('h2', { text: 'Ведущий' }),
                h('p', { text: 'QR ведущего доступен на устройстве, где создали игру.' })
              ])
          ])
        ]),
        h('aside', { class: 'card players-panel' }, [
          h('div', { class: 'panel-head' }, [
            h('h2', { text: 'Участники' }),
            h('strong', { id: 'player-count', text: countText(data.player_count) })
          ]),
          grid
        ])
      ])
    ]);
    setScreen(screen);
    mountQr(document.getElementById('qr-player'), playerLink(data.room_code), 360);
    if (session.host_token) mountQr(document.getElementById('qr-host'), hostLink(data.room_code, session.host_token), 360, QRCode.CorrectLevel.L);
    syncPlayers(grid, data.players || []);
  }

  function qrCard(title, caption, id, extra) {
    return h('article', { class: 'qr-card' }, [
      h('h2', { text: title }),
      h('div', { class: 'qr-box', id: id }),
      h('p', { text: caption }),
      extra || null
    ]);
  }

  function screenBar(pillText, pillId) {
    return h('div', { class: 'bar-actions' }, [
      pillText ? h('div', { class: 'pill', id: pillId || '', text: pillText }) : null,
      h('button', { class: 'btn ghost', type: 'button', text: 'Выйти', onClick: confirmLeave })
    ]);
  }

  function confirmLeave() {
    confirmDialog({
      title: 'Выйти из комнаты?',
      text: 'Экран забудет эту комнату, и можно будет создать новую. Игра на уже подключённых телефонах останется в таблице.',
      confirmText: 'Выйти',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      clearAutoAdvance(advanceState);
      if (stopPoll) stopPoll();
      stopPoll = null;
      clearScreenSession();
      session = null;
      snapshot = null;
      renderCreate();
    });
  }

  function playerFallback(room) {
    var page = joinPageLink();
    return h('div', { class: 'join-fallback' }, [
      h('p', { class: 'fallback-title', text: 'Если QR не сработал' }),
      h('a', { class: 'join-link', href: playerLink(room), text: linkLabel(page) }),
      h('p', { class: 'muted', text: 'Откройте ссылку и введите код ' + formatRoom(room) + '.' }),
      h('button', {
        class: 'btn ghost',
        type: 'button',
        text: 'Скопировать ссылку',
        onClick: function () { copyText(page); }
      })
    ]);
  }

  function hostFallback(room, token) {
    var page = hostLink(room, token);
    return h('div', { class: 'join-fallback host-fallback' }, [
      h('p', { class: 'fallback-title', text: 'Если QR не сработал' }),
      h('a', { class: 'join-link host', href: page, text: page }),
      h('p', { class: 'muted', text: 'Откройте эту ссылку на телефоне ведущего.' }),
      h('button', {
        class: 'btn ghost',
        type: 'button',
        text: 'Скопировать ссылку',
        onClick: function () { copyText(page); }
      })
    ]);
  }

  function questionCountText(data) {
    var total = data.total_questions || 0;
    if (!total) return 'В таблице нет активных вопросов. Добавьте их на лист Questions.';
    return 'В этой игре ' + total + ' ' + plural(total, 'вопрос', 'вопроса', 'вопросов');
  }

  function countText(count) {
    return count + ' ' + plural(count || 0, 'игрок', 'игрока', 'игроков');
  }

  function syncPlayers(container, players) {
    var sig = (players || []).map(function (player) { return player.player_id; }).join('|');
    if (container.dataset.sig === sig) return;
    container.dataset.sig = sig;
    clearNode(container);
    if (!players.length) {
      container.appendChild(h('p', { class: 'empty', text: 'Пока никого нет. Покажите QR-код игрокам.' }));
      return;
    }
    players.forEach(function (player) {
      var chip = h('div', { class: 'chip chip-enter' }, [
        playerAvatar(player.player_id || player.name),
        h('span', { text: player.name })
      ]);
      container.appendChild(chip);
    });
  }

  function mountQuestion(data) {
    document.title = 'КВИЗ · вопрос ' + data.current_question_number;
    var question = data.question;
    var options = h('div', { class: 'options stack', id: 'options' });
    var board = h('div', { id: 'side-board' });
    setScreen(h('div', { class: 'shell' }, [
      topbar(screenBar('Вопрос ' + question.number + ' из ' + question.total)),
      h('section', { class: 'stage-live' }, [
        h('div', { class: 'card stage-question' }, [
          meterNode(question.number, question.total),
          h('p', { class: 'eyebrow', text: question.points + ' ' + plural(question.points, 'балл', 'балла', 'баллов') }),
          h('h1', { class: 'q-text ' + questionSizeClass(question.question), text: question.question }),
          options,
          h('p', { class: 'muted', id: 'answered-label', text: answeredText(data) })
        ]),
        h('aside', { class: 'card stage-rail' }, [
          h('h2', { text: 'Рейтинг' }),
          board
        ])
      ])
    ]));
    paintOptions(options, question, { interactive: false });
    var award = awardRowsFor(data);
    renderLeaderboard(board, award || ratedRows(data), {
      scoresOnly: true,
      showStatus: true,
      ceremony: !!award
    });
    if (award) releaseCeremony(board);
    rememberAnswers(data, true);
    startWaitBed();
  }

  function rememberClosedBoard(data) {
    if (!data || data.status !== 'active' || !data.question) return;
    if (data.question_phase !== 'closed' && data.question_phase !== 'results') return;
    closedBoard = {
      questionId: data.question.id,
      rows: (data.leaderboard || []).map(function (row) {
        return {
          player_id: row.player_id,
          last_points: Number(row.last_points) || 0
        };
      })
    };
  }

  function awardRowsFor(data) {
    if (!closedBoard || !data.question || closedBoard.questionId === data.question.id) return null;
    var gained = {};
    var any = false;
    closedBoard.rows.forEach(function (row) {
      gained[row.player_id] = row.last_points;
      if (row.last_points > 0) any = true;
    });
    closedBoard = null;
    if (!any) return null;
    return ratedRows(data).map(function (row) {
      return {
        player_id: row.player_id,
        name: row.name,
        place: row.place,
        total_score: row.total_score,
        last_points: gained[row.player_id] || 0,
        answered: !!row.answered
      };
    });
  }

  function releaseCeremony(container) {
    setTimeout(function () {
      if (container.isConnected) delete container.dataset.ceremony;
    }, 1800);
  }

  function ratedRows(data) {
    var answeredById = {};
    (data.players || []).forEach(function (player) {
      answeredById[player.player_id] = !!player.answered;
    });
    return (data.leaderboard || []).map(function (row) {
      return {
        player_id: row.player_id,
        name: row.name,
        place: row.place,
        total_score: row.total_score,
        last_points: row.last_points,
        answered: !!answeredById[row.player_id]
      };
    });
  }

  function questionSizeClass(text) {
    var length = String(text || '').length;
    if (length > 160) return 'q-long';
    if (length > 90) return 'q-mid';
    return '';
  }

  function answeredText(data) {
    return 'Ответили ' + data.answered_count + ' из ' + data.player_count;
  }

  function rememberAnswers(data, silent) {
    var qid = data.question ? data.question.id : '';
    var count = Number(data.answered_count) || 0;
    if (silent || heardQuestion !== qid) {
      heardQuestion = qid;
      heardAnswers = count;
      return;
    }
    var added = count - heardAnswers;
    heardAnswers = count;
    var burst = Math.min(added, 4);
    for (var i = 0; i < burst; i += 1) setTimeout(playAnswerLock, i * 110);
  }

  function beatNumber(left) {
    return Math.max(1, Math.min(5, Math.ceil(left / 1000)));
  }

  function mountCountdown(data) {
    document.title = 'КВИЗ · отсчёт';
    setScreen(h('div', { class: 'shell' }, [
      h('section', { class: 'reveal' }, [
        h('p', { class: 'eyebrow', text: 'Правильный ответ через' }),
        h('div', { class: 'reveal-count pop', id: 'reveal-count', text: String(beatNumber(countdownRemaining(data.question_closed_at))) })
      ])
    ]));
    playTick(lastBeat(data));
    var last = beatNumber(countdownRemaining(data.question_closed_at));
    revealClock = setInterval(function () {
      if (!snapshot) return;
      var left = countdownRemaining(snapshot.question_closed_at);
      if (left <= 0) {
        stopReveal();
        render(snapshot);
        return;
      }
      var num = beatNumber(left);
      var node = document.getElementById('reveal-count');
      if (!node || num === last) return;
      last = num;
      node.textContent = String(num);
      node.classList.remove('pop');
      void node.offsetWidth;
      node.classList.add('pop');
      playTick(num);
    }, 80);
  }

  function lastBeat(data) {
    return beatNumber(countdownRemaining(data.question_closed_at));
  }

  function mountAnswer(data) {
    document.title = 'КВИЗ · правильный ответ';
    var question = data.question || {};
    var letter = question.correct_answer || '';
    var answer = letter && question.answers ? question.answers[letter] : '';
    setScreen(h('div', { class: 'shell' }, [
      h('section', { class: 'reveal answer' }, [
        h('p', { class: 'eyebrow', text: 'Правильный ответ' }),
        letter ? h('p', { class: 'reveal-letter', text: letter }) : null,
        h('h1', { text: answer || 'Ответ зафиксирован' })
      ])
    ]));
    playAnswerShow();
    revealClock = setInterval(function () {
      if (!snapshot) return;
      if (revealRemaining(snapshot.question_closed_at) <= 0) {
        stopReveal();
        render(snapshot);
      }
    }, 80);
  }

  function mountFinal(data) {
    document.title = 'КВИЗ · итоги';
    var rows = data.leaderboard || [];
    var podium = h('div', { class: 'podium' });
    var list = h('div', { id: 'board' });
    setScreen(h('div', { class: 'shell' }, [
      topbar(screenBar()),
      h('section', { class: 'final' }, [
        h('p', { class: 'eyebrow', text: 'Игра окончена' }),
        h('h1', { text: winnerText(rows) }),
        podium,
        list,
        h('button', {
          class: 'btn primary',
          type: 'button',
          text: 'Создать новую игру',
          onClick: function () {
            confirmDialog({
              title: 'Создать новую игру?',
              text: 'Этот экран вернётся к созданию комнаты. Результаты текущей игры останутся в таблице.',
              confirmText: 'Создать'
            }).then(function (ok) {
              if (!ok) return;
              if (stopPoll) stopPoll();
              stopPoll = null;
              clearScreenSession();
              session = null;
              snapshot = null;
              renderCreate();
            });
          }
        })
      ])
    ]));
    renderPodium(podium, rows);
    var hasAward = rows.some(function (row) { return Number(row.last_points) > 0; });
    renderLeaderboard(list, rows, { ceremony: hasAward });
    if (hasAward) releaseCeremony(list);
    showConfetti();
  }

  function update(view, data) {
    if (view === 'lobby') {
      var count = document.getElementById('player-count');
      if (count) count.textContent = countText(data.player_count);
      var info = document.getElementById('question-count');
      if (info) info.textContent = questionCountText(data);
      var grid = document.getElementById('player-grid');
      if (grid) syncPlayers(grid, data.players || []);
    } else if (view === 'question') {
      var label = document.getElementById('answered-label');
      if (label) label.textContent = answeredText(data);
      var side = document.getElementById('side-board');
      if (side && !side.dataset.ceremony) renderLeaderboard(side, ratedRows(data), { scoresOnly: true, showStatus: true });
      if (data.question) updateMeter(data.question.number, data.question.total);
      rememberAnswers(data, false);
    } else if (view === 'final') {
      var board = document.getElementById('board');
      if (board && !board.dataset.ceremony) renderLeaderboard(board, data.leaderboard || []);
    }
  }

  if (session && session.room_code) {
    app.appendChild(h('div', { class: 'shell' }, [
      topbar(),
      h('section', { class: 'card' }, [h('h1', { text: 'Подключаемся…' })])
    ]));
    refresh().then(ensurePoll);
  } else {
    renderCreate();
  }
})();
