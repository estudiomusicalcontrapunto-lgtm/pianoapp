// Practice streak ("racha"): consecutive local days with practice. Plain
// functions over 'YYYY-MM-DD' strings, testable without a database.
const { addDays, weekdayOf } = require('./time');

/**
 * Consecutive practiced days ending today, or ending yesterday while today
 * is not marked yet (the streak is not lost until the day is over).
 * dates: practiced days, any order.
 */
const computeStreak = (dates, today) => {
    const days = new Set(dates);
    let day = days.has(today) ? today : addDays(today, -1);
    let streak = 0;
    while (days.has(day)) {
        streak += 1;
        day = addDays(day, -1);
    }
    return streak;
};

/**
 * The stored streak is right as of lastPractice; once a whole day goes by
 * without practice it is 0. Lets lists show the streak without reading the history.
 */
const currentStreak = ({ streak, lastPractice }, today) =>
    (lastPractice && lastPractice >= addDays(today, -1) ? streak || 0 : 0);

// Monday of the week that contains date
const weekStartOf = (date) => addDays(date, 1 - weekdayOf(date));

// Monday to Sunday of the week that starts on weekStart
const weekDays = (weekStart) => [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekStart, i));

module.exports = { computeStreak, currentStreak, weekStartOf, weekDays };
