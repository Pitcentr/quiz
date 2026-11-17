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
      h('input', { id: 'name', maxlength: '20', autocomplete: 'nickname', placeholder: 'Например, Коля', required: 'required' }),
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
    if (data.question) return 'question';
    return 'wait';
  }

  function render(data) {
    var view = viewOf(data);
    var qid = data.question ? data.question.id : '';
    var key = view + ':' + qid;
    if (app.dataset.key === key) {
      update(view, data);
      return;
    }
    app.dataset.key = key;
    if (view === 'wait') mountWait(data);
    else if (view === 'question') mountQuestion(data);
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
    update('question', data);
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
    } else if (view === 'question') {
      if (data.question) updateMeter(data.question.number, data.question.total);
      var letter = data.submitted_answer;
      var locked = !!letter || !data.can_answer;
      Array.prototype.forEach.call(document.querySelectorAll('#options .opt'), function (button) {
        var chosen = letter && button.getAttribute('data-letter') === letter;
        if (locked) button.disabled = true;
        button.classList.toggle('picked', !!chosen);
        if (chosen) {
          button.classList.remove('pending');
          button.removeAttribute('aria-busy');
        }
        var mark = button.querySelector('.pending-label');
        if (mark && letter) mark.remove();
      });
      var hint = document.getElementById('answer-hint');
      if (hint && letter && !sending) {
        hint.className = 'muted';
        hint.textContent = 'Ответ принят. Следующий вопрос появится здесь сам.';
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
