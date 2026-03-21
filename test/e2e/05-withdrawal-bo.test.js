/**
 * 05-withdrawal-bo.test.js
 * Flujo: Manual Off-Ramp (destino Bolivia, origen NO Chile)
 * country=BO && currency≠CLP → isManualOffRamp=true → no hay llamada a APIs externas
 * La transacción se crea en estado pending_manual_payout.
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

// Off-ramp: alguien desde Argentina enviando a Bolivia
const arToBoPayload = {
  country: 'BO',
  currency: 'ARS', // No es CLP → isManualOffRamp
  amount: 50000,
  beneficiary_type: 'person',
  beneficiary_first_name: 'María',
  beneficiary_last_name: 'García',
  beneficiary_email: 'maria@test.com',
  beneficiary_address: 'Calle Potosí 456, Cochabamba',
  beneficiary_document_type: 'CI',
  beneficiary_document_number: '7654321',
  account_type_bank: 'checking',
  account_bank: '111222333',
  bank_code: 1002,
  bank_name: 'BancoSol',
  purpose: 'EPFAMT',
  purpose_comentary: 'Remesa familiar',
};

describe('05 — Withdrawal BO Off-Ramp (Manual)', () => {
  it('crea transacción ARS→BO → 201, status=pending_manual_payout', async () => {
    const orderId = `TEST-BO-OFFRAMP-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...arToBoPayload, order: orderId });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const txn = await Transaction.findOne({ order: orderId });
    expect(txn).not.toBeNull();
    expect(txn.status).toBe('pending_manual_payout');
    expect(txn.currency).toBe('ARS');
    expect(txn.country).toBe('BO');
  });

  it('transacción off-ramp no genera checkoutUrl', async () => {
    const orderId = `TEST-BO-NOCHECKOUT-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...arToBoPayload, order: orderId });

    expect(res.status).toBe(201);
    expect(res.body.data.checkoutUrl).toBeFalsy();
  });
});
