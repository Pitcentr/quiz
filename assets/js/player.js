(function () {
  var app = document.getElementById('app');
  var params = pageParams();
  var session = loadPlayerSession(params.room);
  var state = null;
  var stopPoll = null;
  var sending = false;

  function setScreen(node) {
    clearConfetti();
    clearNode(app);
    app.appendChild(node);
  }

  function ensurePoll() {
    if (stopPoll || !session) return;
    stopPoll = pollEvery(QUIZ_CONFIG.POLL_PLAYER_MS, refresh);
  }

  function refresh() {
    if (!session) return Promise.resolve();
    return apiRequest('reconnectPlayer', {
      player_token: session.player_token,
      room_code: session.room_code
    }).then(function (data) {
      state = data;
      setConnection(true);
      render(data);
    }).catch(function (error) {
      if (error.code === 'PLAYER_NOT_FOUND' || error.code === 'GAME_ARCHIVED' || error.code === 'UNAUTHORIZED') {
        if (stopPoll) stopPoll();
        stopPoll = null;
        clearPlayerSession(session && session.room_code);
        session = null;
        state = null;
        toast(error.message);
        renderJoin();
        return;
      }
      setConnection(false);
    });
  }

  function renderJoin() {
    app.dataset.key = 'join';
    document.title = 'КВИЗ — вход';
    var room = params.room || '';
    var form = h('form', { class: 'card join', onSubmit: onJoin }, [
      h('p', { class: 'eyebrow', text: room ? 'Комната ' + formatRoom(room) : 'Вход в игру' }),
      h('h1', { text: 'Как вас представить?' }),
      room ? null : h('label', { text: 'Код комнаты' }),
      room ? null : h('input', { id: 'room', inputmode: 'numeric', maxlength: '6', autocomplete: 'off', placeholder: '000000', required: 'required' }),
      h('label', { text: 'Имя' }),
      h('input', { id: 'name', maxlength: '20', autocomplete: 'nickname', placeholder: 'Например, Аня', required: 'required' }),
      h('button', { class: 'btn primary block', id: 'join-btn', type: 'submit', text: 'Присоединиться' }),
      h('p', { class: 'muted', text: 'После входа это устройство запомнит вас до конца игры.' })
    ]);
    setScreen(h('div', { class: 'shell phone' }, [topbar(), form]));
    var field = document.getElementById(room ? 'name' : 'room');
    if (field) field.focus();
  }

  function onJoin(event) {
    event.preventDefault();
    if (sending) return;
    var roomInput = document.getElementById('room');
    var room = params.room || (roomInput ? roomInput.value : '');
    room = String(room || '').replace(/\s+/g, '');
    var name = document.getElementById('name').value;
    var nameError = validateName(name);
    if (!/^\d{6}$/.test(room)) {
      toast('Введите шестизначный код комнаты');
      return;
    }
    if (nameError) {
      toast(nameError);
      return;
    }
    sending = true;
    var button = document.getElementById('join-btn');
    button.disabled = true;
    button.textContent = 'Подключаемся…';
    apiRequest('joinGame', { room_code: room, name: name.trim() }).then(function (data) {
      session = {
        player_token: data.player_token,
        player_id: data.player_id,
        room_code: data.room_code,
        name: data.name
      };
      params.room = data.room_code;
      savePlayerSession(session);
      return refresh();
    }).catch(function (error) {
      toast(error.message || 'Не удалось присоединиться');
      button.disabled = false;
      button.textContent = 'Присоединиться';
    }).then(function () {
      sending = false;
      ensurePoll();
    });
  }

  function viewOf(data) {
    if (!data) return 'join';
    if (data.game.status === 'finished') return 'final';
    if (data.game.status === 'waiting') return 'wait';
    if (data.game.question_phase === 'open') return data.submitted_answer ? 'accepted' : 'question';
    if (data.game.question_phase === 'closed' && countdownRemaining(data.game.question_closed_at) > 0) return 'countdown';
    if (data.game.question_phase === 'closed' || data.game.question_phase === 'results') return 'result';
    return 'wait';
  }

  function render(data) {
    var view = viewOf(data);
    var qid = data.question ? data.question.id : '';
    var key = view + ':' + data.game.question_phase + ':' + qid + ':' + (data.submitted_answer || '');
    if (app.dataset.key === key) {
      update(view, data);
      return;
    }
    app.dataset.key = key;
    if (view === 'wait') mountWait(data);
    else if (view === 'question') mountQuestion(data);
    else if (view === 'accepted') mountAccepted(data);
    else if (view === 'countdown') mountCountdown(data);
    else if (view === 'result') mountResult(data);
    else if (view === 'final') mountFinal(data);
  }

  function mountWait(data) {
    document.title = 'КВИЗ · ждём старт';
    setScreen(h('div', { class: 'shell phone' }, [
      topbar(h('div', { class: 'pill', text: formatRoom(data.game.room_code) })),
      h('section', { class: 'card wait' }, [
        h('div', { class: 'me' }, [
          playerAvatar(data.player.player_id || data.player.name),
          h('p', { class: 'eyebrow', text: data.player.name })
        ]),
        h('h1', { text: 'Ожидаем начала игры' }),
        h('p', { class: 'lead', id: 'wait-count', text: waitText(data) }),
        h('div', { class: 'pulse-dot', 'aria-hidden': 'true' }),
        h('button', {
          class: 'btn ghost',
          type: 'button',
          text: 'Выйти',
          onClick: function () {
            if (stopPoll) stopPoll();
            stopPoll = null;
            clearPlayerSession(session.room_code);
            session = null;
            state = null;
            renderJoin();
          }
        })
      ])
    ]));
  }

  function waitText(data) {
    var count = data.game.player_count || 0;
    return 'В комнате ' + count + ' ' + plural(count, 'игрок', 'игрока', 'игроков') + '. Ведущий скоро начнёт.';
  }

  function mountQuestion(data) {
    var question = data.question;
    document.title = 'КВИЗ · вопрос ' + question.number;
    var options = h('div', { class: 'options stack', id: 'options' });
    setScreen(h('div', { class: 'shell phone' }, [
      topbar(h('div', { class: 'pill', text: 'Вопрос ' + question.number + ' из ' + question.total })),
      h('section', { class: 'play' }, [
        meterNode(question.number, question.total),
        h('p', { class: 'eyebrow', text: question.points + ' баллов' }),
        h('h1', { class: 'q-text', text: question.question }),
        options,
        h('p', { class: 'muted', id: 'answer-hint', text: 'Один вариант. Когда ответят все, вопрос закроется сам.' })
      ])
    ]));
    paintOptions(options, question, { interactive: true, onPick: choose });
  }

  function choose(letter) {
    if (sending || !state || !state.can_answer) return;
    sending = true;
    Array.prototype.forEach.call(document.querySelectorAll('#options .opt'), function (button) {
      button.disabled = true;
      if (button.getAttribute('data-letter') === letter) {
        button.classList.add('picked', 'pending');
        button.setAttribute('aria-busy', 'true');
        button.appendChild(h('span', { class: 'pending-label', text: 'Ждём' }));
      }
    });
    var hint = document.getElementById('answer-hint');
    if (hint) {
      hint.className = 'answer-wait';
      clearNode(hint);
      hint.appendChild(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
      hint.appendChild(h('span', { text: 'Ответ выбран. Ждём подтверждение.' }));
    }
    apiRequest('submitAnswer', {
      player_token: session.player_token,
      room_code: session.room_code,
      question_id: state.question.id,
      answer: letter
    }).then(function () {
      return refresh();
    }).catch(function (error) {
      if (error.code === 'ALREADY_ANSWERED' || error.code === 'QUESTION_CLOSED') {
        return refresh();
      }
      toast(error.message || 'Не удалось отправить ответ');
      Array.prototype.forEach.call(document.querySelectorAll('#options .opt'), function (button) {
        button.disabled = false;
        button.classList.remove('picked', 'pending');
        button.removeAttribute('aria-busy');
        var label = button.querySelector('.pending-label');
        if (label) label.remove();
      });
      var failedHint = document.getElementById('answer-hint');
      if (failedHint) {
        failedHint.className = 'muted';
        failedHint.textContent = 'Один вариант. Когда ответят все, вопрос закроется сам.';
      }
    }).then(function () {
      sending = false;
    });
  }

  function mountAccepted(data) {
    var question = data.question;
    document.title = 'КВИЗ · ответ принят';
    var options = h('div', { class: 'options stack', id: 'options' });
    setScreen(h('div', { class: 'shell phone' }, [
      topbar(h('div', { class: 'pill', text: 'Ответ принят' })),
      h('section', { class: 'play' }, [
        h('p', { class: 'eyebrow', text: 'Ответ принят' }),
        h('h1', { class: 'q-text', text: question.question }),
        options,
        h('p', { class: 'lead', text: 'Ответ принят. Ждём остальных игроков.' })
      ])
    ]));
    paintOptions(options, question, { interactive: false, selected: data.submitted_answer, locked: true });
  }

  function mountCountdown(data) {
    document.title = 'КВИЗ · отсчёт';
    var closedAt = data.game.question_closed_at;
    setScreen(h('div', { class: 'shell phone' }, [
      topbar(h('div', { class: 'pill', text: 'Смотрите на экран' })),
      h('section', { class: 'play countdown-phone' }, [
        h('p', { class: 'eyebrow', text: 'Правильный ответ через' }),
        h('div', { class: 'reveal-count pop', id: 'phone-count', text: String(Math.max(1, Math.min(5, Math.ceil(countdownRemaining(closedAt) / 1000)))) }),
        h('p', { class: 'lead', text: 'Ответ появится на большом экране.' })
      ])
    ]));
    var last = Math.max(1, Math.min(5, Math.ceil(countdownRemaining(closedAt) / 1000)));
    var clock = setInterval(function () {
      if (!state || viewOf(state) !== 'countdown') {
        clearInterval(clock);
        return;
      }
      var left = countdownRemaining(state.game.question_closed_at);
      if (left <= 0) {
        clearInterval(clock);
        render(state);
        return;
      }
      var num = Math.max(1, Math.min(5, Math.ceil(left / 1000)));
      var node = document.getElementById('phone-count');
      if (!node || num === last) return;
      last = num;
      node.textContent = String(num);
      node.classList.remove('pop');
      void node.offsetWidth;
      node.classList.add('pop');
    }, 80);
  }

  function mountResult(data) {
    var result = data.round_result || {};
    var question = data.question;
    document.title = 'КВИЗ · результат';
    var title = !result.your_answer ? 'Нет ответа' : result.is_correct ? 'Верно' : 'Неверно';
    var options = h('div', { class: 'options stack' });
    var place = data.player.place
      ? h('p', { class: 'lead', text: 'Сейчас вы на ' + data.player.place + ' месте · ' + data.player.total_score + ' баллов' })
      : h('p', { class: 'lead', text: 'Смотрите рейтинг на большом экране.' });
    setScreen(h('div', { class: 'shell phone' }, [
      topbar(h('div', { class: 'pill', text: (result.points || 0) + ' баллов' })),
      h('section', { class: 'play' }, [
        h('p', { class: 'eyebrow ' + (result.is_correct ? 'good' : 'bad'), text: title }),
        h('h1', { class: 'q-text', text: question ? question.question : 'Результат вопроса' }),
        options,
        h('p', { class: 'correct-line', text: question && result.correct_answer ? 'Правильный ответ: ' + question.answers[result.correct_answer] : '' }),
        place
      ])
    ]));
    if (question) {
      paintOptions(options, question, {
        interactive: false,
        selected: result.your_answer,
        correct: result.correct_answer,
        locked: true
      });
    }
  }

  function mountFinal(data) {
    document.title = 'КВИЗ · ваши итоги';
    var finalResult = data.final_result || {};
    var rows = finalResult.leaderboard || [];
    var list = h('div', { id: 'board' });
    setScreen(h('div', { class: 'shell phone' }, [
      topbar(),
      h('section', { class: 'play final-phone' }, [
        h('div', { class: 'me' }, [
          playerAvatar(data.player.player_id || data.player.name),
          h('p', { class: 'eyebrow', text: data.player.name })
        ]),
        h('h1', { text: data.player.place + ' место' }),
        h('p', { class: 'lead', text: data.player.total_score + ' ' + plural(data.player.total_score, 'балл', 'балла', 'баллов') }),
        h('p', { text: winnerText(rows) }),
        list
      ])
    ]));
    renderLeaderboard(list, rows, { compact: true });
    showConfetti();
  }

  function update(view, data) {
    if (view === 'wait') {
      var note = document.getElementById('wait-count');
      if (note) note.textContent = waitText(data);
    } else if (view === 'question' || view === 'accepted') {
      if (data.question) updateMeter(data.question.number, data.question.total);
      if (view === 'question' && !data.can_answer) {
        Array.prototype.forEach.call(document.querySelectorAll('#options .opt'), function (button) {
          button.disabled = true;
        });
      }
    }
  }

  if (session && session.player_token) {
    setScreen(h('div', { class: 'shell phone' }, [
      topbar(),
      h('section', { class: 'card' }, [h('h1', { text: 'Подключаемся…' })])
    ]));
    refresh().then(ensurePoll);
  } else {
    renderJoin();
  }
})();
