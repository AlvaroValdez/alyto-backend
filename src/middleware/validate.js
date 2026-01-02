import { validationResult } from 'express-validator';

export const validateResult = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            ok: false,
            error: 'Error de validación',
            details: errors.array().map(err => ({ field: err.path, message: err.msg }))
        });
    }
    next();
};
