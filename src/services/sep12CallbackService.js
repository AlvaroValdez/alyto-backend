/**
 * SEP-12 Callback Service
 *
 * Fires a POST to the wallet's registered callback URL after a KYC
 * decision (approve or reject), following the SEP-12 callback spec.
 *
 * The request is signed with HMAC-SHA256 using SEP12_CALLBACK_SECRET
 * so the wallet can verify the payload's authenticity.
 */

import crypto from 'crypto';

const CALLBACK_SECRET = process.env.SEP12_CALLBACK_SECRET || '';

/**
 * Maps internal KYC status to SEP-12 status strings.
 */
export function toSep12Status(kycStatus) {
    switch (kycStatus) {
        case 'approved': return 'ACCEPTED';
        case 'pending': return 'PROCESSING';
        case 'rejected': return 'REJECTED';
        default: return 'NEEDS_INFO';
    }
}

/**
 * Fires a SEP-12 status-update callback to a wallet.
 *
 * @param {Object} user       - Mongoose User document
 * @param {string} action     - 'approve' | 'reject'
 * @param {string} [reason]   - Optional rejection reason
 */
export async function fireSep12Callback(user, action, reason = '') {
    const callbackUrl = user.sep12CallbackUrl;
    if (!callbackUrl) return; // No callback registered, skip

    const kycStatus = action === 'approve' ? 'approved' : 'rejected';
    const sep12Status = toSep12Status(kycStatus);

    const payload = {
        id: String(user._id),
        stellar_account: user.stellarAccount || null,
        status: sep12Status,
        message: action === 'reject' ? (reason || 'Documentos no válidos.') : undefined,
        fields: {}
    };

    const body = JSON.stringify(payload);

    // HMAC signature for the wallet to verify
    const signature = CALLBACK_SECRET
        ? crypto.createHmac('sha256', CALLBACK_SECRET).update(body).digest('hex')
        : undefined;

    const headers = {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Stellar-Signature': signature } : {})
    };

    try {
        const response = await fetch(callbackUrl, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(8000)
        });
        console.log(`[SEP-12 Callback] Fired to ${callbackUrl} → ${response.status}`);
    } catch (err) {
        // Fire-and-forget: log but don't throw
        console.error(`[SEP-12 Callback] Error firing to ${callbackUrl}:`, err.message);
    }
}
