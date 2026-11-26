const path = require('path');
const { Umzug, SequelizeStorage } = require('umzug');
const sequelize = require('../config/database');

const migrator = new Umzug({
    migrations: { glob: ['migrations/*.js', { cwd: path.join(__dirname, '..') }] },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: undefined,
});

const runMigrations = () => migrator.up();

module.exports = { migrator, runMigrations };

// CLI: node db/migrator.js [up|down|pending]
if (require.main === module) {
    const command = process.argv[2] || 'up';
    (async () => {
        if (command === 'pending') {
            const pending = await migrator.pending();
            console.log(pending.length ? pending.map(m => m.name).join('\n') : 'Sin migraciones pendientes');
        } else if (command === 'down') {
            const done = await migrator.down();
            console.log('Revertida:', done.map(m => m.name).join(', ') || 'ninguna');
        } else {
            const done = await migrator.up();
            console.log('Aplicadas:', done.map(m => m.name).join(', ') || 'ninguna');
        }
        await sequelize.close();
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
