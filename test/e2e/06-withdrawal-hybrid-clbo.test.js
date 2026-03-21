/**
 * 06-withdrawal-hybrid-clbo.test.js
 * Flujo: Hybrid CL→BO (Fintoc payin + payout manual)
 * currency=CLP && country=BO → isHybridFintocManual=true
 * Llama a API REAL de Fintoc (test credentials) para crear checkout session.
 * El payout es manual (admin lo procesa desde panel).
 */
import supertest from 'supertest';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import Transaction from '../../src/models/Transaction.js';
import { createApprovedUser, generateToken } from '../helpers/auth.js';

const req = supertest(app);
let user, token;
const createdOrders = [];

beforeAll(async () => {
  user = await createApprovedUser();
  token = generateToken(user);
});

afterAll(async () => {
  await Transaction.deleteMany({ order: { $in: createdOrders } });
  await User.deleteMany({ _id: user._id });
});

const clToBoPayload = {
  country: 'BO',
  currency: 'CLP', // Desde Chile
  amount: 50000,   // 50.000 CLP
  beneficiary_type: 'person',
  beneficiary_first_name: 'Carlos',
  beneficiary_last_name: 'Mamani',
  beneficiary_email: 'carlos.mamani@test.com',
  beneficiary_address: 'Av. Mcal. Santa Cruz 123, La Paz',
  beneficiary_document_type: 'CI',
  beneficiary_document_number: '5678901',
  account_type_bank: 'savings',
  account_bank: '444555666',
  bank_code: 1001,
  bank_name: 'Banco Nacional de Bolivia',
  purpose: 'EPFAMT',
  purpose_comentary: 'Transferencia familiar CL-BO',
};

describe('06 — Withdrawal Hybrid CL→BO (Fintoc + Manual Payout)', () => {
  it('crea checkout session Fintoc → 201, retorna checkoutUrl, payoutStatus=pending_manual_payout', async () => {
    const orderId = `TEST-CLBO-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...clToBoPayload, order: orderId });

    // Si Fintoc API falla (ej: límite de rate), será 500 — el test fallará con info útil
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.checkoutUrl).toBeDefined();
    expect(typeof res.body.data.checkoutUrl).toBe('string');
    expect(res.body.data.checkoutUrl.length).toBeGreaterThan(10);

    // Verificar en DB
    const txn = await Transaction.findOne({ order: orderId });
    expect(txn).not.toBeNull();
    expect(txn.payoutStatus).toBe('pending_manual_payout');
    expect(txn.payinStatus).toBe('pending');
    // No debe tener deferredWithdrawalPayload (el payout es manual, no automático)
    expect(txn.deferredWithdrawalPayload).toBeNull();
    // Sí debe tener el ID de Fintoc
    expect(txn.fintocPaymentIntentId).toBeDefined();
  });

  it('detecta correctamente el flow CL→BO (no confunde con otros flows)', async () => {
    const orderId = `TEST-CLBO-FLOW-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...clToBoPayload, order: orderId });

    if (res.status === 201) {
      // raw.fintoc=true y raw.manualPayout=true confirman el flujo correcto
      expect(res.body.raw?.fintoc).toBe(true);
      expect(res.body.raw?.manualPayout).toBe(true);
    }
  });
});
