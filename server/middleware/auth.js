const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/jwt');

const auth = (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: 'No auth token, access denied' });
        }

        const verified = jwt.verify(token, jwtSecret());
        if (!verified) {
            return res.status(401).json({ message: 'Token verification failed, authorization denied' });
        }

        req.user = verified.id; // Store user id in req
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

module.exports = auth;
