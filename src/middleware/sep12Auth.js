/**
 * SEP-12 Authentication Middleware
 *
 * Supports two authentication modes:
 *   1. Our own app JWT (Bearer <app-jwt>) — where payload.userId exists
 *   2. SEP-10 JWT (Bearer <sep10-jwt>) — where payload.sub = "G..." (Stellar account)
 *      For Phase 1 we verify with our own jwtSecret. Full SEP-10 web-auth is Phase 2.
 *
 * After auth, attaches to req:
 *   req.user          — MongoDB User document (if found in DB)
 *   req.stellarAccount — "G..." string (from SEP-10 JWT sub, or from user.stellarAccount)
 */

import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/env.js';
import User from '../models/User.js';

const STELLAR_ACCOUNT_RE = /^[GM][A-Z2-7]{55}$/;

export const sep12Auth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado. Se requiere token Bearer.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, jwtSecret);

        // --- Mode 1: App JWT (has userId) ---
        if (decoded.userId) {
            const user = await User.findById(decoded.userId).select('-password');
            if (!user) return res.status(401).json({ error: 'Usuario no encontrado.' });
            req.user = user;
            req.stellarAccount = user.stellarAccount || null;
            return next();
        }

        // --- Mode 2: SEP-10 JWT (sub = "G..." or "G...:memo") ---
        if (decoded.sub) {
            const stellarAccount = decoded.sub.split(':')[0]; // strip optional :memo
            if (!STELLAR_ACCOUNT_RE.test(stellarAccount)) {
                return res.status(401).json({ error: 'Token SEP-10 inválido: sub no es una cuenta Stellar válida.' });
            }
            req.stellarAccount = stellarAccount;
            // Try to find linked user
            const user = await User.findOne({ stellarAccount }).select('-password');
            req.user = user || null;
            return next();
        }

        return res.status(401).json({ error: 'Token inválido: payload sin userId ni sub.' });

    } catch (err) {
        if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expirado.' });
        return res.status(401).json({ error: 'Token inválido.' });
    }
};
