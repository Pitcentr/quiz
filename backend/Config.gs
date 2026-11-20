var CONFIG = {
  VERSION: '1.0.0',
  // Оставьте пустым, если скрипт привязан к таблице или ID уже сохранён при первой настройке.
  SPREADSHEET_ID: '',
  MAX_PLAYERS: 20,
  REVEAL_MS: 5000,
  ARCHIVE_AFTER_DAYS: 7,
  CACHE_TTL: 21600,
  QUESTION_CACHE_TTL: 30
};

var QUESTION_HEADERS = ['id', 'order', 'question', 'answer_a', 'answer_b', 'answer_c', 'answer_d', 'correct_answer', 'points', 'time_limit', 'active'];
var GAME_HEADERS = ['game_id', 'room_code', 'host_token_hash', 'status', 'current_question', 'question_phase', 'question_opened_at', 'question_closed_at', 'questions_json', 'created_at', 'updated_at'];
var PLAYER_HEADERS = ['player_id', 'game_id', 'name', 'token_hash', 'total_score', 'joined_at'];
var ANSWER_HEADERS = ['id', 'game_id', 'player_id', 'question_id', 'answer', 'is_correct', 'points', 'answered_at'];

// Держите список в соответствии с dev/questions.json. Правки в таблице важнее: эти строки
// записываются только в пустой лист Questions.
var SEED_QUESTIONS = [
  { id: 'q1', order: 1, question: 'Столица Австралии?', answer_a: 'Сидней', answer_b: 'Канберра', answer_c: 'Мельбурн', answer_d: 'Перт', correct_answer: 'B', points: 100, time_limit: 20, active: true },
  { id: 'q2', order: 2, question: 'Сколько будет 2 + 2 × 2?', answer_a: '8', answer_b: '6', answer_c: '4', answer_d: '2', correct_answer: 'B', points: 100, time_limit: 20, active: true },
  { id: 'q3', order: 3, question: 'Кто написал роман «Евгений Онегин»?', answer_a: 'Толстой', answer_b: 'Гоголь', answer_c: 'Пушкин', answer_d: 'Чехов', correct_answer: 'C', points: 100, time_limit: 25, active: true },
  { id: 'q4', order: 4, question: 'Химический символ золота?', answer_a: 'Au', answer_b: 'Ag', answer_c: 'Fe', answer_d: 'Cu', correct_answer: 'A', points: 150, time_limit: 15, active: true },
  { id: 'q5', order: 5, question: 'Самый большой океан Земли?', answer_a: 'Атлантический', answer_b: 'Индийский', answer_c: 'Северный Ледовитый', answer_d: 'Тихий', correct_answer: 'D', points: 100, time_limit: 20, active: true },
  { id: 'q6', order: 6, question: 'В каком году человек впервые ступил на Луну?', answer_a: '1961', answer_b: '1969', answer_c: '1972', answer_d: '1959', correct_answer: 'B', points: 200, time_limit: 20, active: true },
  { id: 'q7', order: 7, question: 'Сколько струн у обычной гитары?', answer_a: '6', answer_b: '4', answer_c: '7', answer_d: '5', correct_answer: 'A', points: 100, time_limit: 15, active: true },
  { id: 'q8', order: 8, question: 'Какая планета известна как Красная?', answer_a: 'Венера', answer_b: 'Юпитер', answer_c: 'Марс', answer_d: 'Сатурн', correct_answer: 'C', points: 100, time_limit: 15, active: true },
  { id: 'q9', order: 9, question: 'Столица Японии?', answer_a: 'Киото', answer_b: 'Токио', answer_c: 'Осака', answer_d: 'Пекин', correct_answer: 'B', points: 100, time_limit: 15, active: true },
  { id: 'q10', order: 10, question: 'Химическая формула воды?', answer_a: 'CO2', answer_b: 'NaCl', answer_c: 'H2O', answer_d: 'O2', correct_answer: 'C', points: 100, time_limit: 15, active: true }
];
