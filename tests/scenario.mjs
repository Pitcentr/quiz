import { createHash } from 'node:crypto';
import { createQuizEngine } from '../dev/engine.mjs';
import { startServer } from '../dev/server.mjs';

const NAMES = ['Аня', 'Борис', 'Вера', 'Глеб', 'Даша', 'Егор', 'Женя', 'Ира', 'Кирилл', 'Лена'];

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasKey(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  if (value instanceof Map) {
    for (const item of value.values()) if (hasKey(item, key)) return true;
    return false;
  }
  return Object.values(value).some((item) => hasKey(item, key));
}

function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (value instanceof Map) value.forEach((item, key) => { collectStrings(key, out); collectStrings(item, out); });
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
}

function otherLetter(letter) {
  return { A: 'B', B: 'C', C: 'D', D: 'A' }[letter];
}

function placesOf(rows) {
  return rows.map((row) => row.total_score + ':' + row.place).join(', ');
}

async function main() {
  let checks = 0;
  const check = (condition, message) => {
    assert(condition, message);
    checks += 1;
  };

  let now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const engine = createQuizEngine({ now: () => now });

  const ping = await engine.handle('ping', {});
  check(ping.success && ping.data.ok, 'ping');

  const missing = await engine.handle('getGame', { room_code: '000000' });
  check(missing.error && missing.error.code === 'ROOM_NOT_FOUND', 'unknown room');
  const badRoom = await engine.handle('joinGame', { room_code: '12', name: 'Аня' });
  check(badRoom.error.code === 'INVALID_INPUT', 'short room code');

  const created = await engine.handle('createGame', {});
  check(created.success && /^\d{6}$/.test(created.data.room_code), 'create game');
  const room = created.data.room_code;
  const hostToken = created.data.host_token;
  check(created.data.host_token_hash === undefined, 'create does not return hash');

  const state = engine._internal;
  const game = state.games.get(created.data.game_id);
  check(game.host_token_hash === sha256(hostToken), 'host hash stored');
  check(game.host_token === undefined, 'raw host token is not stored');
  const createdSecrets = [];
  collectStrings(state, createdSecrets);
  check(!createdSecrets.includes(hostToken), 'host token absent from state');

  const emptyHost = await engine.handle('startGame', { host_token: hostToken, room_code: room });
  check(emptyHost.error.code === 'NO_PLAYERS', 'start without players');

  const joins = await Promise.all(NAMES.map((name) => engine.handle('joinGame', { room_code: room, name })));
  check(joins.every((item) => item.success), '10 players join together');
  const players = joins.map((item, index) => ({
    index,
    name: NAMES[index],
    token: item.data.player_token,
    player_id: item.data.player_id
  }));
  const memory = [];
  collectStrings(state, memory);
  players.forEach((player) => {
    check(!memory.includes(player.token), 'player token ' + player.name + ' is not stored');
    const record = state.players.get(player.player_id);
    check(record.token_hash === sha256(player.token), 'player hash ' + player.name);
    check(record.token === undefined && record.total_score === 0, 'player record is clean');
  });

  const duplicate = await engine.handle('joinGame', { room_code: room, name: 'аня' });
  check(duplicate.error.code === 'NAME_TAKEN', 'case-insensitive duplicate name');
  const badName = await engine.handle('joinGame', { room_code: room, name: 'A' });
  check(badName.error.code === 'NAME_INVALID', 'short name');
  const symbols = await engine.handle('joinGame', { room_code: room, name: '@@@' });
  check(symbols.error.code === 'NAME_INVALID', 'symbols are rejected');

  const twinRoom = await engine.handle('createGame', {});
  const twins = await Promise.all([
    engine.handle('joinGame', { room_code: twinRoom.data.room_code, name: 'Близнецы' }),
    engine.handle('joinGame', { room_code: twinRoom.data.room_code, name: 'близнецы' })
  ]);
  check(twins.filter((item) => item.success).length === 1, 'one of two identical joins wins');
  check(twins.filter((item) => item.error && item.error.code === 'NAME_TAKEN').length === 1, 'the other join is rejected');

  const limited = await engine.handle('createGame', {});
  const crowd = await Promise.all(Array.from({ length: 20 }, (_, index) => (
    engine.handle('joinGame', { room_code: limited.data.room_code, name: 'Номер ' + (index + 1) })
  )));
  check(crowd.every((item) => item.success), '20 players is the limit');
  const overflow = await engine.handle('joinGame', { room_code: limited.data.room_code, name: 'Лишний' });
  check(overflow.error.code === 'ROOM_FULL', '21st player is rejected');

  const formula = await engine.handle('joinGame', { room_code: twinRoom.data.room_code, name: '=Анна' });
  check(formula.success && formula.data.name === 'Анна', 'formula-like name is sanitized');

  const started = await engine.handle('startGame', { host_token: hostToken, room_code: room });
  check(started.success && started.data.status === 'active' && started.data.question_phase === 'open', 'game starts');
  check(started.data.total_questions === 10 && started.data.question.correct_answer, 'host sees the correct option');
  const lateJoin = await engine.handle('joinGame', { room_code: room, name: 'Опоздал' });
  check(lateJoin.error.code === 'GAME_NOT_WAITING', 'join closes after start');
  const restart = await engine.handle('startGame', { host_token: hostToken, room_code: room });
  check(restart.error.code === 'ALREADY_STARTED', 'second start is rejected');

  const publicOpen = await engine.handle('getGame', { room_code: room });
  check(publicOpen.success && !hasKey(publicOpen.data, 'correct_answer'), 'screen does not receive the answer');
  check(!JSON.stringify(publicOpen.data).includes(hostToken), 'public state has no host token');
  const wrongHost = await engine.handle('getGame', { room_code: room, host_token: 'x'.repeat(40) });
  check(wrongHost.error.code === 'UNAUTHORIZED', 'bad host token is rejected');

  const expected = new Map(players.map((player) => [player.player_id, 0]));
  const choiceFor = (index, questionNumber, correct) => {
    if (index === 9) return null;
    if (index === 0 || index === 1) return correct;
    if (index === 2 || index === 3) return questionNumber % 2 === 0 ? correct : otherLetter(correct);
    if (index === 4 || index === 5) return otherLetter(correct);
    if (index === 6) return questionNumber <= 5 ? correct : otherLetter(correct);
    if (index === 7) return questionNumber % 2 === 1 ? correct : otherLetter(correct);
    if (index === 8) return questionNumber === 1 ? otherLetter(correct) : correct;
    return otherLetter(correct);
  };

  for (let number = 1; number <= 10; number += 1) {
    const snap = await engine.handle('getGame', { host_token: hostToken, room_code: room });
    check(snap.success && snap.data.current_question_number === number, 'question ' + number);
    const question = snap.data.question;

    if (number === 3) {
      const idle = await engine.handle('reconnectPlayer', { player_token: players[9].token, room_code: room });
      check(idle.success && idle.data.can_answer === true && idle.data.submitted_answer === null, 'idle player can answer after refresh');
      check(!hasKey(idle.data, 'correct_answer'), 'refresh during question hides the answer');
    }

    const jobs = players.map((player) => {
      const letter = choiceFor(player.index, number, question.correct_answer);
      if (!letter) return Promise.resolve(null);
      return engine.handle('submitAnswer', {
        player_token: player.token,
        room_code: room,
        question_id: question.id,
        answer: letter,
        points: 9999,
        is_correct: true,
        player_id: players[0].player_id
      });
    });
    const submitted = await Promise.all(jobs);
    check(submitted.filter(Boolean).every((item) => item.success), 'answers stored on question ' + number);
    if (number === 1) {
        const again = await engine.handle('submitAnswer', {
          player_token: players[0].token,
          question_id: question.id,
          answer: choiceFor(0, 1, question.correct_answer)
        });
        check(again.success && again.data.already === true, 'same answer can be retried');
        const changed = await engine.handle('submitAnswer', {
          player_token: players[0].token,
          question_id: question.id,
          answer: otherLetter(question.correct_answer)
        });
        check(changed.error.code === 'ALREADY_ANSWERED', 'answer cannot be changed');
        const reloaded = await engine.handle('reconnectPlayer', { player_token: players[0].token });
        check(reloaded.data.submitted_answer === question.correct_answer && reloaded.data.can_answer === false, 'refresh restores the accepted answer');
        check(!hasKey(reloaded.data, 'correct_answer'), 'restored session still hides the answer');
        const retrySame = await engine.handle('submitAnswer', {
          player_token: players[0].token,
          question_id: question.id,
          answer: question.correct_answer
        });
        check(retrySame.success && retrySame.data.already === true, 'retry of the same answer stays idempotent');
        const owned = [...state.answers.values()].filter((answer) => answer.question_id === question.id && answer.player_id === players[0].player_id);
        check(owned.length === 1 && owned[0].points === null && owned[0].is_correct === null, 'client score is ignored before close');
        const live = await engine.handle('getGame', { room_code: room });
        check(Array.isArray(live.data.leaderboard) && live.data.leaderboard.length === 10, 'screen shows the standing during the question');
        check(!live.data.question.correct_answer, 'standing does not include the answer');
        check(live.data.players.filter((player) => player.answered).length === 9, 'screen knows who already answered');
      }

    const before = new Map(expected);
    let firstFinish;
    let secondFinish;
    if (number === 1) {
      [firstFinish, secondFinish] = await Promise.all([
        engine.handle('finishQuestion', { host_token: hostToken, room_code: room }),
        engine.handle('finishQuestion', { host_token: hostToken, room_code: room })
      ]);
      check(
        [firstFinish, secondFinish].filter((item) => item.success).length === 1 &&
        [firstFinish, secondFinish].some((item) => item.error && item.error.code === 'QUESTION_NOT_OPEN'),
        'parallel close scores once'
      );
    } else {
      firstFinish = await engine.handle('finishQuestion', { host_token: hostToken, room_code: room });
      check(firstFinish.success, 'finish question ' + number);
    }

    players.forEach((player) => {
      const letter = choiceFor(player.index, number, question.correct_answer);
      const gained = letter && letter === question.correct_answer ? question.points : 0;
      expected.set(player.player_id, expected.get(player.player_id) + gained);
    });

    const board = (await engine.handle('getLeaderboard', { host_token: hostToken, room_code: room })).data.leaderboard;
    board.forEach((row) => check(row.total_score === expected.get(row.player_id), 'score ' + row.name + ' on question ' + number + ': ' + row.total_score));
    const repeat = await engine.handle('finishQuestion', { host_token: hostToken, room_code: room });
    check(repeat.error.code === 'QUESTION_NOT_OPEN', 'repeat scoring is rejected');
    const after = (await engine.handle('getLeaderboard', { host_token: hostToken, room_code: room })).data.leaderboard;
    after.forEach((row) => check(row.total_score === expected.get(row.player_id), 'score unchanged after repeat close'));
    before.forEach((score, id) => check(expected.get(id) >= score, 'scores never decrease'));

    const screen = await engine.handle('getGame', { room_code: room });
    check(screen.data.question.correct_answer === question.correct_answer, 'screen receives the answer after close');
    check(screen.data.leaderboard.length === 10, 'screen has the new ranking');
    if (number === 1) {
      const tooSoon = await engine.handle('nextQuestion', { host_token: hostToken, room_code: room });
      check(tooSoon.error && tooSoon.error.code === 'REVEAL_IN_PROGRESS', 'next question waits for the reveal');
      now += 5000;
      const answerStillUp = await engine.handle('nextQuestion', { host_token: hostToken, room_code: room });
      check(answerStillUp.error && answerStillUp.error.code === 'REVEAL_IN_PROGRESS', 'answer stays on screen for five more seconds');
      now += 5000;
    } else {
      now += 10000;
    }
    if (number === 1) {
      const shown = await engine.handle('showResults', { host_token: hostToken, room_code: room });
      check(shown.success && shown.data.question_phase === 'results', 'results phase still opens');
    }
    const visible = await engine.handle('getLeaderboard', { room_code: room });
    check(visible.success && visible.data.leaderboard.length === 10, 'screen can load the ranking');

    const playerView = await engine.handle('reconnectPlayer', { player_token: players[0].token });
    check(playerView.data.round_result && playerView.data.round_result.correct_answer === question.correct_answer, 'player learns the answer only after close');
    check(playerView.data.player.total_score === expected.get(players[0].player_id), 'player total comes from the server');

    if (number < 10) {
      const skipped = await engine.handle('nextQuestion', { host_token: hostToken, room_code: room });
      check(skipped.success && skipped.data.question_phase === 'open', 'next question opens');
    } else {
      const noMore = await engine.handle('nextQuestion', { host_token: hostToken, room_code: room });
      check(noMore.error.code === 'NO_MORE_QUESTIONS', 'last question has no successor');
    }
  }

  check(expected.get(players[0].player_id) === 1150 && expected.get(players[1].player_id) === 1150, 'leaders calculated manually');
  check(expected.get(players[8].player_id) === 1050, 'third place calculated manually');
  check(expected.get(players[2].player_id) === 650 && expected.get(players[3].player_id) === 650, 'tied middle calculated manually');
  check(expected.get(players[6].player_id) === 550 && expected.get(players[7].player_id) === 500, 'remaining scores calculated manually');
  check(expected.get(players[4].player_id) === 0 && expected.get(players[9].player_id) === 0, 'misses score zero');

  const openFinish = await engine.handle('finishGame', { host_token: 'nope-nope-nope-nope-nope-nope' });
  check(openFinish.error.code === 'UNAUTHORIZED', 'finish requires host');
  const finals = await engine.handle('finishGame', { host_token: hostToken, room_code: room });
  check(finals.success && finals.data.winners.length === 2, 'two winners share first place');
  check(finals.data.podium.second.length === 0 && finals.data.podium.third.length === 1, 'tie skips second place');
  const placeList = finals.data.leaderboard.map((row) => row.place);
  check(JSON.stringify(placeList) === JSON.stringify([1, 1, 3, 4, 4, 6, 7, 8, 8, 8]), 'places ' + placesOf(finals.data.leaderboard));
  const lastPoints = Object.fromEntries(finals.data.leaderboard.map((row) => [row.name, row.last_points]));
  check(lastPoints['Аня'] === 100 && lastPoints['Борис'] === 100 && lastPoints['Лена'] === 0 && lastPoints['Кирилл'] === 100, 'last question points');

  const againFinal = await engine.handle('finishGame', { host_token: hostToken, room_code: room });
  check(againFinal.error.code === 'ALREADY_FINISHED', 'game cannot finish twice');
  const publicFinal = await engine.handle('getFinalResults', { room_code: room });
  check(publicFinal.success && publicFinal.data.leaderboard[0].total_score === 1150, 'public final ranking');
  check(!JSON.stringify(publicFinal.data).includes(hostToken), 'final results hide the host token');

  const other = await engine.handle('createGame', {});
  const outsider = await engine.handle('joinGame', { room_code: other.data.room_code, name: 'Аня' });
  check(outsider.success, 'same name is allowed in another room');
  const crossed = await engine.handle('submitAnswer', {
    player_token: players[0].token,
    room_code: other.data.room_code,
    question_id: 'q1',
    answer: 'A'
  });
  check(crossed.error.code === 'UNAUTHORIZED', 'token from another room is rejected');
  const otherPlayers = await engine.handle('getPlayers', { room_code: other.data.room_code });
  check(otherPlayers.data.player_count === 1 && otherPlayers.data.players[0].name === 'Аня', 'rooms do not share players');

  const archived = await engine.handle('archiveGame', { host_token: hostToken, room_code: room });
  check(archived.success, 'finished game archives');
  const gone = await engine.handle('getGame', { room_code: room });
  check(gone.error.code === 'GAME_ARCHIVED', 'archived room is closed');
  const activeArchive = await engine.handle('archiveGame', { host_token: other.data.host_token, room_code: other.data.room_code });
  check(activeArchive.success, 'waiting room can be archived by its host');

  const blank = createQuizEngine({ questions: [], now: () => now });
  const blankGame = await blank.handle('createGame', {});
  await blank.handle('joinGame', { room_code: blankGame.data.room_code, name: 'Один' });
  const noQuestions = await blank.handle('startGame', { host_token: blankGame.data.host_token, room_code: blankGame.data.room_code });
  check(noQuestions.error.code === 'NO_QUESTIONS', 'empty question list blocks the start');

  let clock = Date.UTC(2026, 2, 1, 10, 0, 0);
  const timed = createQuizEngine({ now: () => clock });
  const timedGame = await timed.handle('createGame', {});
  const fast = await timed.handle('joinGame', { room_code: timedGame.data.room_code, name: 'Быстрый' });
  const slow = await timed.handle('joinGame', { room_code: timedGame.data.room_code, name: 'Медленный' });
  const timedStart = await timed.handle('startGame', { host_token: timedGame.data.host_token, room_code: timedGame.data.room_code });
  const openedAt = Date.parse(timedStart.data.question_opened_at);
  clock = openedAt + 120000;
  const stillOpen = await timed.handle('submitAnswer', {
    player_token: fast.data.player_token,
    question_id: timedStart.data.question.id,
    answer: timedStart.data.question.correct_answer
  });
  check(stillOpen.success, 'there is no answer countdown');
  const early = await timed.handle('finishGame', { host_token: timedGame.data.host_token });
  check(early.error.code === 'QUESTION_STILL_OPEN', 'open question must be closed before the game ends');
  const closedRound = await timed.handle('finishQuestion', { host_token: timedGame.data.host_token });
  const fastRow = closedRound.data.leaderboard.find((row) => row.name === 'Быстрый');
  const slowRow = closedRound.data.leaderboard.find((row) => row.name === 'Медленный');
  check(fastRow.total_score === timedStart.data.question.points, 'correct answer scores the question');
  check(slowRow.total_score === 0 && slowRow.last_points === 0, 'unanswered player scores zero');
  const duringReveal = await timed.handle('nextQuestion', { host_token: timedGame.data.host_token });
  check(duringReveal.error.code === 'NO_MORE_QUESTIONS' || duringReveal.error.code === 'REVEAL_IN_PROGRESS', 'reveal or last question blocks an early jump');

  const auto = createQuizEngine({ now: () => now });
  const autoGame = await auto.handle('createGame', {});
  const firstPlayer = await auto.handle('joinGame', { room_code: autoGame.data.room_code, name: 'Раз' });
  const secondPlayer = await auto.handle('joinGame', { room_code: autoGame.data.room_code, name: 'Два' });
  const autoStart = await auto.handle('startGame', { host_token: autoGame.data.host_token, room_code: autoGame.data.room_code });
  const autoQuestion = autoStart.data.question;
  const oneAnswer = await auto.handle('submitAnswer', {
    player_token: firstPlayer.data.player_token,
    question_id: autoQuestion.id,
    answer: autoQuestion.correct_answer
  });
  check(oneAnswer.success && oneAnswer.data.closed === false, 'a single answer leaves the question open');
  const stillOpenRound = await auto.handle('getGame', { room_code: autoGame.data.room_code });
  check(stillOpenRound.data.question_phase === 'open', 'question stays open until everyone answers');
  const lastAnswer = await auto.handle('submitAnswer', {
    player_token: secondPlayer.data.player_token,
    question_id: autoQuestion.id,
    answer: autoQuestion.correct_answer
  });
  check(lastAnswer.success && lastAnswer.data.closed === true, 'the last answer closes the question');
  const autoClosed = await auto.handle('getGame', { host_token: autoGame.data.host_token, room_code: autoGame.data.room_code });
  check(autoClosed.data.question_phase === 'closed', 'all answers move straight to the reveal');
  const scored = autoClosed.data.leaderboard.find((row) => row.name === 'Раз');
  check(scored && scored.total_score === autoQuestion.points, 'auto close scores the question once');
  const manualClose = await auto.handle('finishQuestion', { host_token: autoGame.data.host_token, room_code: autoGame.data.room_code });
  check(manualClose.error.code === 'QUESTION_NOT_OPEN', 'auto close cannot be scored again');

  const http = startServer({ port: 8799, engine: createQuizEngine() });
  await new Promise((resolveReady, rejectReady) => {
    http.server.once('listening', resolveReady);
    http.server.once('error', rejectReady);
  });
  try {
    const response = await fetch('http://127.0.0.1:8799/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'createGame' })
    });
    const payload = await response.json();
    check(payload.success && payload.data.room_code, 'http createGame');
    const page = await fetch('http://127.0.0.1:8799/');
    check(page.ok && (await page.text()).includes('КВИЗ'), 'http serves the screen');
    const diagnostic = await fetch('http://127.0.0.1:8799/exec');
    const pingBody = await diagnostic.json();
    check(pingBody.success && pingBody.data.ok, 'http ping');
  } finally {
    await new Promise((resolveClose) => http.server.close(resolveClose));
  }

  console.log('Сценарий пройден: ' + checks + ' проверок, 10 игроков, ничья, повторное начисление заблокировано.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
