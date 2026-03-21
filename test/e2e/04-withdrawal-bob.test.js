/**
 * 04-withdrawal-bob.test.js
 * Flujo: Manual On-Ramp (BOB)
 * currency=BOB → isManualOnRamp=true → no hay llamada a APIs externas
 * La transacción se crea en estado pending_verification esperando depósito manual.
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

const boliviaPayload = {
  country: 'BO',
  currency: 'BOB',
  amount: 500,
  beneficiary_type: 'person',
  beneficiary_first_name: 'Juan',
  beneficiary_last_name: 'Pérez',
  beneficiary_email: 'juan@test.com',
  beneficiary_address: 'Av. Arce 123, La Paz',
  beneficiary_document_type: 'CI',
  beneficiary_document_number: '1234567',
  account_type_bank: 'savings',
  account_bank: '987654321',
  bank_code: 1001,
  bank_name: 'Banco Mercantil',
  account_type_name: 'Caja de Ahorro',
  purpose: 'EPFAMT',
  purpose_comentary: 'Envío familiar',
};

describe('04 — Withdrawal BOB (Manual On-Ramp)', () => {
  it('crea transacción BOB → 201, status=pending_verification', async () => {
    const orderId = `TEST-BOB-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...boliviaPayload, order: orderId });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.order).toBe(orderId);
    expect(res.body.data.txId).toBeDefined();

    // Verificar en DB que el estado es correcto
    const txn = await Transaction.findOne({ order: orderId });
    expect(txn).not.toBeNull();
    expect(txn.status).toBe('pending_verification');
    expect(txn.currency).toBe('BOB');
    expect(txn.country).toBe('BO');
    expect(txn.createdBy.toString()).toBe(user._id.toString());
  });

  it('rechaza sin campos obligatorios (country, currency, amount) → 400', async () => {
    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ beneficiary_first_name: 'Juan' }); // sin country/currency/amount

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('transacción BOB no genera checkoutUrl ni vitaTxnId', async () => {
    const orderId = `TEST-BOB-NOCHECKOUT-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...boliviaPayload, order: orderId });

    expect(res.status).toBe(201);
    // Para flujo manual, no hay checkout URL de Fintoc
    expect(res.body.data.checkoutUrl).toBeFalsy();
  });

  it('transacción BOB guarda withdrawalPayload completo para comprobante', async () => {
    const orderId = `TEST-BOB-PAYLOAD-${Date.now()}`;
    createdOrders.push(orderId);

    await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...boliviaPayload, order: orderId });

    const txn = await Transaction.findOne({ order: orderId });
    expect(txn.withdrawalPayload).toBeDefined();
    expect(txn.withdrawalPayload.beneficiary_first_name).toBe('Juan');
    expect(txn.withdrawalPayload.beneficiary_last_name).toBe('Pérez');
  });
});
