(function () {
  var app = document.getElementById('app');
  var session = loadScreenSession();
  var snapshot = null;
  var stopPoll = null;
  var revealClock = null;
  var creating = false;
  var heardQuestion = '';
  var heardAnswers = 0;
  var revealedQuestion = '';
  var revealedFaces = '';
  var revealMode = '';
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

  function choicesMissing(data) {
    var phase = data && data.question_phase;
    if (phase !== 'closed' && phase !== 'results') return false;
    return (data.players || []).some(function (player) {
      return player.answered && !player.answer;
    });
  }

  function mergeChoices(data, hostData) {
    var byId = {};
    (hostData.players || []).forEach(function (player) { byId[player.player_id] = player; });
    (data.players || []).forEach(function (player) {
      var hostPlayer = byId[player.player_id];
      if (!hostPlayer || !hostPlayer.answer) return;
      player.answer = String(hostPlayer.answer).toUpperCase();
    });
    if (data.question && hostData.question && hostData.question.correct_answer && !data.question.correct_answer) {
      data.question.correct_answer = hostData.question.correct_answer;
    }
  }

  function withChoices(data) {
    if (!session || !session.host_token || !choicesMissing(data)) return Promise.resolve(data);
    return apiRequest('getGame', {
      room_code: session.room_code,
      host_token: session.host_token
    }).then(function (hostData) {
      mergeChoices(data, hostData);
      return data;
    }, function () {
      return data;
    });
  }

  function refresh() {
    if (!session) return Promise.resolve();
    return apiRequest('getGame', { room_code: session.room_code }).then(withChoices).then(function (data) {
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
    if (data.status === 'active' && data.question) return 'question';
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
          h('p', { class: 'muted', id: 'answered-label', text: answeredText(data) }),
          h('div', { class: 'count-dock', id: 'count-dock' }, [
            h('div', {
              class: 'count-orb',
              id: 'reveal-count',
              role: 'timer',
              'aria-label': 'До следующего вопроса',
              text: '5'
            })
          ])
        ]),
        h('aside', { class: 'card stage-rail' }, [
          h('h2', { text: 'Рейтинг' }),
          board
        ])
      ])
    ]));
    var closed = data.question_phase === 'closed' || data.question_phase === 'results';
    var award = closed ? null : awardRowsFor(data);
    paintOptions(options, question, { interactive: false });
    renderLeaderboard(board, award || (closed ? frozenRows(data) : ratedRows(data)), {
      scoresOnly: true,
      showStatus: true,
      ceremony: !!award
    });
    if (award) releaseCeremony(board);
    if (closed) beginReveal(data);
    else {
      rememberAnswers(data, true);
      startWaitBed();
    }
  }

  function frozenRows(data) {
    var rows = ratedRows(data).map(function (row) {
      var gained = Number(row.last_points) || 0;
      return {
        player_id: row.player_id,
        name: row.name,
        place: row.place,
        total_score: Math.max(0, Number(row.total_score) - gained),
        last_points: 0,
        answered: !!row.answered
      };
    });
    rows.sort(function (a, b) {
      return b.total_score - a.total_score || String(a.name).localeCompare(String(b.name), 'ru');
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

  function choiceSignature(data) {
    return (data.players || []).map(function (player) {
      return (player.player_id || player.name) + '=' + String(player.answer || '').toUpperCase();
    }).join('|');
  }

  function paintFaces(data, blink) {
    var question = data.question;
    var options = document.getElementById('options');
    if (!options || !question || !question.answers) return;
    paintOptions(options, question, {
      interactive: false,
      correct: blink ? question.correct_answer : null,
      blink: !!blink,
      faces: facesByLetter(data)
    });
  }

  function setBlink(on, letter) {
    Array.prototype.forEach.call(document.querySelectorAll('#options .opt'), function (button) {
      var match = !!on && button.getAttribute('data-letter') === letter;
      button.classList.toggle('blink', match);
      button.classList.toggle('right', match);
    });
  }

  function syncReveal(data, forcePaint) {
    var question = data.question;
    if (!question) return;
    var phase = revealPhase(data.question_closed_at);
    var showBlink = phase === 'blink' || phase === 'done';
    var showCount = phase !== 'picks';
    if (forcePaint) paintFaces(data, showBlink);
    else if (phase !== revealMode) setBlink(showBlink, question.correct_answer);
    var label = document.getElementById('answered-label');
    if (label) label.hidden = true;
    var dock = document.getElementById('count-dock');
    if (dock) dock.classList.toggle('is-on', showCount);
    if (showCount) {
      var num = phase === 'countdown' ? countdownNumber(data.question_closed_at) : 0;
      var orb = document.getElementById('reveal-count');
      if (orb && orb.textContent !== String(num)) {
        var known = orb.dataset.ready === '1';
        orb.textContent = String(num);
        orb.classList.remove('pop');
        void orb.offsetWidth;
        orb.classList.add('pop');
        if (phase === 'countdown' && known) playTick(num);
      }
      if (orb && phase === 'countdown') orb.dataset.ready = '1';
    }
    if ((revealMode === '' || revealMode === 'picks') && phase === 'countdown') playGong();
    revealMode = phase;
    showAnswered(data);
  }

  function beginReveal(data) {
    var question = data.question;
    if (!question || !question.id) return;
    var signature = choiceSignature(data);
    var first = revealedQuestion !== question.id;
    var facesChanged = first || revealedFaces !== signature;
    if (!facesChanged && revealClock) {
      syncReveal(data, false);
      return;
    }
    revealedQuestion = question.id;
    revealedFaces = signature;
    if (first) {
      revealMode = '';
      stopWaitBed(true);
      var orb = document.getElementById('reveal-count');
      if (orb) delete orb.dataset.ready;
      stopReveal();
      revealClock = setInterval(function () {
        if (!snapshot || !snapshot.question || snapshot.question.id !== question.id) return;
        syncReveal(snapshot, false);
      }, 80);
    }
    syncReveal(data, true);
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

  function showAnswered(data) {
    var answered = {};
    (data.players || []).forEach(function (player) {
      if (player.answered) answered[player.player_id] = true;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#side-board .lb-row'), function (row) {
      var status = row.querySelector('.lb-status');
      if (!status) return;
      var done = !!answered[row.dataset.id];
      status.textContent = done ? 'ответил' : 'ждём';
      status.className = 'lb-status ' + (done ? 'ok' : 'wait');
    });
  }

  function facesByLetter(data) {
    var groups = { A: [], B: [], C: [], D: [] };
    (data.players || []).forEach(function (player) {
      var letter = String(player.answer || '').toUpperCase();
      if (groups[letter]) groups[letter].push(player);
    });
    return groups;
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
      if (data.question_phase === 'closed' || data.question_phase === 'results') {
        beginReveal(data);
        return;
      }
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
