// Every write that books time runs here, so two people cannot take the same
// slot at once: conflicts are re-checked inside the transaction while it
// holds a lock.
// - MySQL: SELECT ... FOR UPDATE on the rooms and users involved, always in
//   the same order (rooms, then users, each sorted by id) to avoid deadlocks.
// - SQLite: BEGIN IMMEDIATE takes the database write lock up front, so booking
//   transactions run one after another. A busy database is retried.
const { Transaction } = require('sequelize');
const { sequelize, Room, User } = require('../models');

const isSqlite = () => sequelize.getDialect() === 'sqlite';

const isBusyError = (error) =>
    /SQLITE_BUSY|database is locked/i.test(`${error?.parent?.code || ''} ${error?.message || ''}`);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const uniqueSorted = (ids) => [...new Set(ids.filter(Boolean))].sort();

/**
 * Runs fn(transaction) with the booking lock.
 * lockOn: { roomIds, userIds } — what the booking touches (used on MySQL).
 */
const runBookingTransaction = async (lockOn, fn) => {
    if (isSqlite()) {
        for (let attempt = 1; ; attempt++) {
            try {
                return await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, fn);
            } catch (error) {
                if (!isBusyError(error) || attempt >= 20) throw error;
                await sleep(25 * attempt);
            }
        }
    }

    return sequelize.transaction(async (transaction) => {
        const roomIds = uniqueSorted(lockOn.roomIds || []);
        const userIds = uniqueSorted(lockOn.userIds || []);
        if (roomIds.length) {
            await Room.findAll({ where: { id: roomIds }, order: [['id', 'ASC']], lock: transaction.LOCK.UPDATE, transaction });
        }
        if (userIds.length) {
            await User.findAll({ where: { id: userIds }, order: [['id', 'ASC']], lock: transaction.LOCK.UPDATE, transaction });
        }
        return fn(transaction);
    });
};

module.exports = { runBookingTransaction };
