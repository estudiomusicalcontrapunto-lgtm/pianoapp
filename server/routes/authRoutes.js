const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/jwt');
const { User, Repertoire } = require('../models');
const auth = require('../middleware/auth');
const { runMaintenanceThrottled } = require('../services/maintenanceService');

// There is no public sign-up: the academy creates every account.

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ 
            where: { email },
            include: [{ model: Repertoire, as: 'repertoire' }]
        });
        
        if (!user) {
            return res.status(400).json({ message: 'Credenciales incorrectas' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciales incorrectas' });
        }

        if (user.active === false) {
            return res.status(403).json({ message: 'Tu cuenta está desactivada. Comunícate con la academia.' });
        }

        const token = jwt.sign({ id: user.id }, jwtSecret(), { expiresIn: '7d' });

        // If the host put the process to sleep, logging in catches up the scheduled tasks
        if (process.env.MAINTENANCE_ON_LOGIN !== 'false') runMaintenanceThrottled();

        res.json({
            token,
            user: user.toJSON()
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Change own password (accounts created by the academy start with a temporary one)
router.post('/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres.' });
        }

        const user = await User.findByPk(req.user);
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        const isMatch = await user.comparePassword(currentPassword || '');
        if (!isMatch) {
            return res.status(400).json({ message: 'La contraseña actual no es correcta.' });
        }

        user.password = newPassword;
        user.mustChangePassword = false;
        await user.save();
        res.json({ message: 'Contraseña actualizada' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
