require('dotenv').config();

const app = require('./app');
const { User } = require('./models');
const { runMigrations } = require('./db/migrator');
const { runMaintenance } = require('./services/maintenanceService');
const { jwtSecretProblem } = require('./config/jwt');

// Never start with a missing, example or weak session key (anyone could forge a login)
const secretProblem = jwtSecretProblem();
if (secretProblem) {
    console.error(`No se puede iniciar el servidor: ${secretProblem}`);
    console.error('Genera una con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
}

const PORT = process.env.PORT || 5000;
// Scheduled tasks (holds, expired cycles, reminders). 0 turns the timer off.
const MAINTENANCE_MINUTES = Number(process.env.MAINTENANCE_INTERVAL_MINUTES ?? 10);

const runMaintenanceSafely = () =>
    runMaintenance()
        .then(result => {
            const changes = result.holdsReleased + result.lessonsTaken + result.expired.cycles + result.makeupsExpired.lost + result.makeupsExpired.discounted + result.monthsCharged + result.unpaidReleased + result.overduePayments + result.reminders;
            if (changes) console.log('Maintenance:', JSON.stringify(result));
        })
        .catch(error => console.error('Maintenance error:', error));

// The first academy account comes from ADMIN_EMAIL / ADMIN_PASSWORD in .env
const ensureAcademyAccount = async () => {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@academia.com';
    const existingAdmin = await User.findOne({ where: { email: adminEmail } });
    if (existingAdmin) return;

    if (!process.env.ADMIN_PASSWORD) {
        console.warn(`No academy account (${adminEmail}) and no ADMIN_PASSWORD in .env: skipping its creation.`);
        return;
    }
    await User.create({
        name: 'Academia',
        email: adminEmail,
        password: process.env.ADMIN_PASSWORD,
        role: 'academy'
    });
    console.log('Default Academy account created.');
};

runMigrations()
    .then(async (applied) => {
        if (applied.length) console.log('Migrations applied:', applied.map(m => m.name).join(', '));
        console.log('Database connected & migrated');
        await ensureAcademyAccount();
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
        runMaintenanceSafely();
        if (MAINTENANCE_MINUTES > 0) setInterval(runMaintenanceSafely, MAINTENANCE_MINUTES * 60 * 1000);
    })
    .catch(err => {
        console.error('Database migration error:', err);
        process.exit(1);
    });
