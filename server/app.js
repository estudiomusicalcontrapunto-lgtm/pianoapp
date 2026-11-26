const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

// Routes imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const repertoireRoutes = require('./routes/repertoireRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const academyRoutes = require('./routes/academyRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const cityRoutes = require('./routes/cityRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const termsRoutes = require('./routes/termsRoutes');
const studentRoutes = require('./routes/studentRoutes');
const roomRoutes = require('./routes/roomRoutes');
const assessmentRoutes = require('./routes/assessmentRoutes');
const { router: cycleRoutes } = require('./routes/cycleRoutes');
const availabilityRoutes = require('./routes/availabilityRoutes');
const fixedScheduleRoutes = require('./routes/fixedScheduleRoutes');
const lessonRoutes = require('./routes/lessonRoutes');
const noticeRoutes = require('./routes/noticeRoutes');
const levelRequestRoutes = require('./routes/levelRequestRoutes');
const instrumentRoutes = require('./routes/instrumentRoutes');
const levelGuideRoutes = require('./routes/levelGuideRoutes');
const substitutionRoutes = require('./routes/substitutionRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/repertoire', repertoireRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/academy', academyRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/terms', termsRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/cycles', cycleRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/fixed-schedules', fixedScheduleRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/level-requests', levelRequestRoutes);
app.use('/api/instruments', instrumentRoutes);
app.use('/api/level-guide', levelGuideRoutes);
app.use('/api/substitutions', substitutionRoutes);
app.use('/api', (req, res) => res.status(404).json({ message: 'Ruta no encontrada.' }));

// Production: the same server serves the built app (npm run build -> dist), so the
// app and the API share one address. In development Vite serves the app instead.
const FRONTEND_DIR = path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', 'dist'));
const INDEX_HTML = path.join(FRONTEND_DIR, 'index.html');
if (fs.existsSync(INDEX_HTML)) {
    app.use(express.static(FRONTEND_DIR, { index: false }));
    app.get('*', (req, res) => res.sendFile(INDEX_HTML));
}

module.exports = app;
