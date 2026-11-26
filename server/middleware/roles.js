const { User } = require('../models');

// What a student may still use before accepting the terms: reading and accepting them, and their profile
const OPEN_WITHOUT_TERMS = ['/api/terms', '/api/auth', '/api/users/me', '/api/notices'];

// Use after `auth`. Loads the user into req.currentUser and checks the role.
// With no roles given, any active user passes. A student who must accept the
// terms before using the app only reaches the terms (see domain/terms.js).
const requireRole = (...roles) => async (req, res, next) => {
    try {
        const user = await User.findByPk(req.user);
        if (!user || user.active === false) {
            return res.status(401).json({ message: 'Tu cuenta no está activa.' });
        }
        if (roles.length && !roles.includes(user.role)) {
            return res.status(403).json({ message: 'No tienes permiso para esta acción.' });
        }
        if (user.role === 'student' && !OPEN_WITHOUT_TERMS.some(prefix => req.originalUrl.startsWith(prefix))) {
            // Required lazily: the terms service needs the models loaded first
            const { statusFor } = require('../services/termsService');
            const terms = await statusFor(user);
            if (terms.required && terms.blocking) {
                return res.status(403).json({ code: 'terminos_requeridos', message: terms.message });
            }
        }
        req.currentUser = user;
        next();
    } catch (error) {
        res.status(500).json({ message: 'Algo salió mal. Inténtalo de nuevo en un momento.' });
    }
};

module.exports = { requireRole };
