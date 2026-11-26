const path = require('path');
const { Sequelize } = require('sequelize');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let sequelize;

if (process.env.DB_HOST) {
    // Use MySQL if DB_HOST is provided
    sequelize = new Sequelize(
        process.env.DB_NAME,
        process.env.DB_USER,
        process.env.DB_PASSWORD,
        {
            host: process.env.DB_HOST,
            dialect: 'mysql',
            logging: false,
            timezone: '+00:00', // Store UTC; the app converts to America/Bogota
        }
    );
} else {
    // Default to local SQLite (DB_STORAGE lets tests and seeds use another file)
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: process.env.DB_STORAGE || path.join(__dirname, '..', 'database.sqlite'),
        logging: false,
    });
}

module.exports = sequelize;
