/**
 * SEP-12 Customer Routes
 * Mounted at: /api/sep12
 *
 * Endpoints:
 *   GET    /customer           — Return KYC status & fields in SEP-12 format
 *   PUT    /customer           — Submit/update customer info (SEP-9 field names)
 *   DELETE /customer/:account  — Redact/delete all KYC data (GDPR)
 *   PUT    /customer/callback  — Register wallet callback URL for status updates
 */

import { Router } from 'express';
import User from '../models/User.js';
import upload from '../middleware/uploadMiddleware.js';
import { toSep12Status } from '../services/sep12CallbackService.js';
import { notifyAdminNewKyc } from '../services/notificationService.js';

const router = Router();

// ─────────────────────────────────────────────────────────
// Helper: Build SEP-12 response from a User document
// ─────────────────────────────────────────────────────────
function buildCustomerResponse(user) {
    const kyc = user.kyc || {};
    const sep12Status = toSep12Status(kyc.status);

    // Fields we consider "accepted" once level 1 is complete
    const level1Complete = user.isProfileComplete;
    const docsProvided = kyc.documents?.idFront && kyc.documents?.idBack && kyc.documents?.selfie;
    const kycApproved = kyc.status === 'approved';

    const response = {
        id: String(user._id),
        status: sep12Status,
    };

    // provided_fields — fields we have received
    const provided_fields = {};

    if (user.accountType === 'business' && user.business) {
        const b = user.business;
        if (b.name) provided_fields.organization_name = { type: 'string', status: 'ACCEPTED' };
        if (b.taxId) provided_fields.tax_id = { type: 'string', status: 'ACCEPTED' };
        if (b.registrationNumber) provided_fields.registration_number = { type: 'string', status: 'ACCEPTED' };
        if (b.registeredAddress) provided_fields.registered_address = { type: 'string', status: 'ACCEPTED' };
        if (b.countryCode) provided_fields.registration_country_code = { type: 'string', status: 'ACCEPTED' };
    } else {
        if (user.email) provided_fields.email_address = { type: 'string', status: 'ACCEPTED' };
        if (user.firstName) provided_fields.first_name = { type: 'string', status: 'ACCEPTED' };
        if (user.lastName) provided_fields.last_name = { type: 'string', status: 'ACCEPTED' };
        if (user.birthDate) provided_fields.birth_date = { type: 'date', status: 'ACCEPTED' };
        if (user.documentType) provided_fields.id_type = { type: 'string', status: 'ACCEPTED' };
        if (user.documentNumber) provided_fields.id_number = { type: 'string', status: 'ACCEPTED' };
        if (user.phoneNumber) provided_fields.mobile_number = { type: 'string', status: 'ACCEPTED' };
        if (user.address) provided_fields.address = { type: 'string', status: 'ACCEPTED' };
    }

    if (docsProvided) {
        const docStatus = kycApproved ? 'ACCEPTED' : (kyc.status === 'rejected' ? 'REJECTED' : 'PROCESSING');
        provided_fields.photo_id_front = { type: 'binary', status: docStatus };
        provided_fields.photo_id_back = { type: 'binary', status: docStatus };
        provided_fields.proof_of_liveness = { type: 'binary', status: docStatus };
    }

    if (user.accountType === 'business' && user.business?.documents) {
        const bdocs = user.business.documents;
        const docStatus = kycApproved ? 'ACCEPTED' : (kyc.status === 'rejected' ? 'REJECTED' : 'PROCESSING');
        if (bdocs.incorporation) provided_fields.organization_incorporation_doc = { type: 'binary', status: docStatus };
        if (bdocs.taxIdCard) provided_fields.organization_tax_id_doc = { type: 'binary', status: docStatus };
    }

    if (Object.keys(provided_fields).length > 0) {
        response.provided_fields = provided_fields;
    }

    // fields — fields still required (only show when NEEDS_INFO)
    if (sep12Status === 'NEEDS_INFO') {
        const fields = {};
        if (user.accountType === 'business') {
            const b = user.business || {};
            if (!b.name) fields.organization_name = { type: 'string', description: 'Nombre legal de la empresa' };
            if (!b.taxId) fields.tax_id = { type: 'string', description: 'NIT o RUT de la empresa' };
            if (!b.registeredAddress) fields.registered_address = { type: 'string', description: 'Dirección legal' };

            if (level1Complete) {
                const bdocs = user.business?.documents || {};
                if (!bdocs.incorporation) fields.organization_incorporation_doc = { type: 'binary', description: 'Certificado de constitución / Acta' };
                if (!bdocs.taxIdCard) fields.organization_tax_id_doc = { type: 'binary', description: 'Copia del NIT / RUT' };
            }
        } else {
            if (!user.firstName) fields.first_name = { type: 'string', description: 'Nombre(s) del cliente' };
            if (!user.lastName) fields.last_name = { type: 'string', description: 'Apellido(s) del cliente' };
            if (!user.email) fields.email_address = { type: 'string', description: 'Correo electrónico' };
            if (!user.birthDate) fields.birth_date = { type: 'date', description: 'Fecha de nacimiento (YYYY-MM-DD)' };
            if (!user.documentType) fields.id_type = { type: 'string', description: 'Tipo de documento: passport, id_card, drivers_license' };
            if (!user.documentNumber) fields.id_number = { type: 'string', description: 'Número del documento de identidad' };
            if (!user.phoneNumber) fields.mobile_number = { type: 'string', description: 'Teléfono con código de país (E.164)' };
            if (!user.address) fields.address = { type: 'string', description: 'Dirección residencial completa' };

            // If level 1 is complete but no docs yet, request docs
            if (level1Complete && !docsProvided) {
                fields.photo_id_front = { type: 'binary', description: 'Foto del frente del documento de identidad' };
                fields.photo_id_back = { type: 'binary', description: 'Foto del reverso del documento de identidad' };
                fields.proof_of_liveness = { type: 'binary', description: 'Selfie sosteniendo el documento' };
            }
        }

        if (Object.keys(fields).length > 0) response.fields = fields;
    }

    // Rejection reason
    if (kyc.status === 'rejected' && kyc.rejectionReason) {
        response.message = kyc.rejectionReason;
    }

    // Processing message
    if (sep12Status === 'PROCESSING') {
        response.message = 'Documentos en revisión. Este proceso toma entre 1-2 días hábiles.';
    }

    return response;
}

// ─────────────────────────────────────────────────────────
// Map SEP-9 id_type → our documentType enum
// ─────────────────────────────────────────────────────────
function mapIdType(sep9Type) {
    const map = {
        passport: 'PASSPORT',
        id_card: 'DNI',
        drivers_license: 'DNI',
        driving_license: 'DNI',
        residence_permit: 'CE',
        others: 'DNI'
    };
    return map[(sep9Type || '').toLowerCase()] || 'DNI';
}

// ─────────────────────────────────────────────────────────
// GET /customer
// Returns current KYC status and fields for the authenticated user
// ─────────────────────────────────────────────────────────
router.get('/customer', async (req, res) => {
    try {
        let user = req.user;

        // If no user found (SEP-10 JWT with unknown Stellar account), we return NEEDS_INFO
        if (!user) {
            return res.json({
                status: 'NEEDS_INFO',
                fields: {
                    first_name: { type: 'string', description: 'Nombre(s) del cliente' },
                    last_name: { type: 'string', description: 'Apellido(s) del cliente' },
                    email_address: { type: 'string', description: 'Correo electrónico' },
                    birth_date: { type: 'date', description: 'Fecha de nacimiento (YYYY-MM-DD)' },
                    id_type: { type: 'string', description: 'Tipo de documento: passport, id_card, drivers_license' },
                    id_number: { type: 'string', description: 'Número del documento de identidad' },
                    mobile_number: { type: 'string', description: 'Teléfono con código de país (E.164)' },
                    address: { type: 'string', description: 'Dirección residencial completa' },
                    photo_id_front: { type: 'binary', description: 'Foto del frente del documento de identidad' },
                    photo_id_back: { type: 'binary', description: 'Foto del reverso del documento de identidad' },
                    proof_of_liveness: { type: 'binary', description: 'Selfie sosteniendo el documento' }
                }
            });
        }

        // Link Stellar account if provided and not yet linked
        if (req.stellarAccount && !user.stellarAccount) {
            user.stellarAccount = req.stellarAccount;
            await user.save();
        }

        return res.json(buildCustomerResponse(user));
    } catch (err) {
        console.error('[SEP-12 GET /customer]', err);
        res.status(500).json({ error: 'Error interno al obtener estado KYC.' });
    }
});

// ─────────────────────────────────────────────────────────
// PUT /customer
// Submit or update customer information (SEP-9 field names).
// Accepts both JSON (Level 1 data) and multipart/form-data (+ document images).
// ─────────────────────────────────────────────────────────
const kycUploadFields = upload.fields([
    { name: 'photo_id_front', maxCount: 1 },
    { name: 'photo_id_back', maxCount: 1 },
    { name: 'proof_of_liveness', maxCount: 1 },
    { name: 'organization_incorporation_doc', maxCount: 1 },
    { name: 'organization_tax_id_doc', maxCount: 1 }
]);

router.put('/customer', (req, res, next) => {
    // Try multipart — fall through if Content-Type is JSON
    kycUploadFields(req, res, (err) => {
        if (err) return res.status(400).json({ error: 'Error al procesar archivos: ' + err.message });
        next();
    });
}, async (req, res) => {
    try {
        let user = req.user;
        const body = req.body;
        const files = req.files || {};

        // If no user linked yet, we need email to look them up or create link
        if (!user) {
            // Try to find by email if provided
            if (body.email_address) {
                user = await User.findOne({ email: body.email_address.toLowerCase() }).select('-password');
            }
            if (!user) {
                return res.status(404).json({
                    error: 'No se encontró un usuario asociado. Usa el flujo de registro de AVF primero.',
                    detail: 'Provide email_address to link your existing account, or register at https://avf-vita-fe10.onrender.com'
                });
            }
        }

        // --- Link Stellar account ---
        if (req.stellarAccount && !user.stellarAccount) {
            user.stellarAccount = req.stellarAccount;
        }

        // --- Base Account Type ---
        if (body.type) {
            user.accountType = body.type.toLowerCase() === 'business' ? 'business' : 'individual';
        }

        // --- Map SEP-9 Fields ---
        if (user.accountType === 'business') {
            if (!user.business) user.business = {};
            if (body.organization_name) user.business.name = body.organization_name.trim();
            if (body.tax_id) user.business.taxId = body.tax_id.trim();
            if (body.registration_number) user.business.registrationNumber = body.registration_number.trim();
            if (body.registered_address) user.business.registeredAddress = body.registered_address.trim();
            if (body.registration_country_code) user.business.countryCode = body.registration_country_code.trim().toUpperCase();
        } else {
            if (body.first_name) user.firstName = body.first_name.trim();
            if (body.last_name) user.lastName = body.last_name.trim();
            if (body.birth_date) user.birthDate = new Date(body.birth_date);
            if (body.id_type) user.documentType = mapIdType(body.id_type);
            if (body.id_number) user.documentNumber = body.id_number.trim();
            if (body.mobile_number) user.phoneNumber = body.mobile_number.trim();
            if (body.address) user.address = body.address.trim();
        }

        // --- Level 2: Document images (uploaded via Cloudinary through Multer) ---
        let docsUploaded = false;
        if (files.photo_id_front?.[0]) {
            if (!user.kyc) user.kyc = {};
            if (!user.kyc.documents) user.kyc.documents = {};
            user.kyc.documents.idFront = files.photo_id_front[0].path;
            docsUploaded = true;
        }
        if (files.photo_id_back?.[0]) {
            if (!user.kyc) user.kyc = {};
            if (!user.kyc.documents) user.kyc.documents = {};
            user.kyc.documents.idBack = files.photo_id_back[0].path;
            docsUploaded = true;
        }
        if (files.proof_of_liveness?.[0]) {
            if (!user.kyc) user.kyc = {};
            if (!user.kyc.documents) user.kyc.documents = {};
            user.kyc.documents.selfie = files.proof_of_liveness[0].path;
            docsUploaded = true;
        }

        // --- Business Documents ---
        if (files.organization_incorporation_doc?.[0]) {
            if (!user.business) user.business = {};
            if (!user.business.documents) user.business.documents = {};
            user.business.documents.incorporation = files.organization_incorporation_doc[0].path;
            docsUploaded = true;
        }
        if (files.organization_tax_id_doc?.[0]) {
            if (!user.business) user.business = {};
            if (!user.business.documents) user.business.documents = {};
            user.business.documents.taxIdCard = files.organization_tax_id_doc[0].path;
            docsUploaded = true;
        }

        // If all docs for the type are received, move to pending review
        const individualDocs = user.kyc?.documents?.idFront && user.kyc?.documents?.idBack && user.kyc?.documents?.selfie;
        const businessDocs = user.business?.documents?.incorporation && user.business?.documents?.taxIdCard;

        const allDocs = user.accountType === 'business' ? businessDocs : individualDocs;

        if (docsUploaded && allDocs && user.kyc?.status !== 'approved') {
            user.kyc.status = 'pending';
            user.kyc.submittedAt = new Date();
            user.kyc.level = 2;
            // Notify admins about new KYC submission
            notifyAdminNewKyc(user).catch(() => { });
        }

        await user.save();

        const response = buildCustomerResponse(user);
        res.status(202).json(response);

    } catch (err) {
        console.error('[SEP-12 PUT /customer]', err);
        res.status(500).json({ error: 'Error interno al actualizar datos KYC.' });
    }
});

// ─────────────────────────────────────────────────────────
// PUT /customer/callback
// Register a callback URL for the wallet to receive KYC status updates
// ─────────────────────────────────────────────────────────
router.put('/customer/callback', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Se requiere el campo "url".' });

    // Basic URL validation
    try { new URL(url); } catch {
        return res.status(400).json({ error: 'La URL de callback no es válida.' });
    }

    try {
        const user = req.user;
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        user.sep12CallbackUrl = url;
        if (req.stellarAccount && !user.stellarAccount) {
            user.stellarAccount = req.stellarAccount;
        }
        await user.save();

        res.status(204).send();
    } catch (err) {
        console.error('[SEP-12 PUT /customer/callback]', err);
        res.status(500).json({ error: 'Error al registrar callback.' });
    }
});

// ─────────────────────────────────────────────────────────
// DELETE /customer/:account
// Redact/delete all KYC data for the given Stellar account (GDPR)
// ─────────────────────────────────────────────────────────
router.delete('/customer/:account', async (req, res) => {
    try {
        const { account } = req.params;

        // Security: only allow deleting your own account's data
        const requestingAccount = req.stellarAccount || req.user?.stellarAccount;
        if (requestingAccount && requestingAccount !== account) {
            return res.status(403).json({ error: 'Solo puedes eliminar tus propios datos.' });
        }

        const user = req.user || (account ? await User.findOne({ stellarAccount: account }) : null);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        // Wipe all KYC data
        user.firstName = undefined;
        user.lastName = undefined;
        user.birthDate = undefined;
        user.documentType = undefined;
        user.documentNumber = undefined;
        user.phoneNumber = undefined;
        user.address = undefined;
        user.isProfileComplete = false;
        user.kyc = {
            level: 1,
            status: 'unverified',
            documents: {},
            rejectionReason: undefined,
            submittedAt: undefined,
            verifiedAt: undefined
        };
        user.stellarAccount = undefined;
        user.sep12CallbackUrl = undefined;

        await user.save();

        console.log(`[SEP-12 DELETE] KYC data wiped for user: ${user.email}`);
        res.status(204).send();

    } catch (err) {
        console.error('[SEP-12 DELETE /customer]', err);
        res.status(500).json({ error: 'Error al eliminar datos KYC.' });
    }
});

export default router;
