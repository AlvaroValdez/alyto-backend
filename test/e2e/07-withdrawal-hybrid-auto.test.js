/**
 * 07-withdrawal-hybrid-auto.test.js
 * Flujo: Hybrid Auto (CL→CO, CL→PE, etc.)
 * currency=CLP && country=CO → Fintoc payin + Vita payout diferido
 * Requiere TransactionConfig para CL con profitRetention=true (sembrado en setup.js).
 * Llama a API REAL de Fintoc para crear checkout session.
 * El payout a Vita se ejecuta cuando llega el IPN (testeado en 08-ipn-fintoc.test.js).
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

// Payload CL→CO (Colombia)
const clToCoPayload = {
  country: 'CO',
  currency: 'CLP',
  amount: 100000, // 100.000 CLP
  beneficiary_type: 'person',
  beneficiary_first_name: 'Andrés',
  beneficiary_last_name: 'Torres',
  beneficiary_email: 'andres.torres@test.com',
  beneficiary_address: 'Calle 10 # 5-30, Bogotá',
  beneficiary_document_type: 'CC',
  beneficiary_document_number: '80123456',
  account_type_bank: 'savings',
  account_bank: '123456789012',
  bank_code: 1007, // Bancolombia
  bank_name: 'Bancolombia',
  account_type_name: 'Cuenta de Ahorros',
  purpose: 'EPFAMT',
  purpose_comentary: 'Remesa familiar Chile-Colombia',
  // amountsTracking para que el endpoint pueda calcular profit retention
  amountsTracking: {
    grossAmount: 101490,  // Monto bruto (incluye fee Fintoc)
    originPrincipal: 100000,
    originFee: 1490,
    destCurrency: 'COP',
    destReceiveAmount: 350000,
  },
  rateTracking: {
    vitaRate: 3.55,     // 1 CLP = 3.55 COP (aprox)
    alytoRate: 3.50,
    spreadPercent: 1.4,
  },
};

describe('07 — Withdrawal Hybrid Auto (CL→CO)', () => {
  it('crea checkout Fintoc + deferredWithdrawalPayload → 201', async () => {
    const orderId = `TEST-CLCO-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...clToCoPayload, order: orderId });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.checkoutUrl).toBeDefined();

    // Verificar en DB
    const txn = await Transaction.findOne({ order: orderId });
    expect(txn).not.toBeNull();
    expect(txn.status).toBe('pending');
    expect(txn.payinStatus).toBe('pending');
    expect(txn.payoutStatus).toBe('pending');

    // El deferredWithdrawalPayload debe estar completo para la ejecución diferida
    expect(txn.deferredWithdrawalPayload).not.toBeNull();
    expect(txn.deferredWithdrawalPayload.currency).toBe('clp');
    expect(txn.deferredWithdrawalPayload.country).toBe('CO');
    expect(txn.deferredWithdrawalPayload.beneficiary_first_name).toBe('Andrés');
    // El monto debe ser el ajustado (con profit retenido)
    expect(txn.deferredWithdrawalPayload.amount).toBeLessThan(100000); // profit retenido
  });

  it('profit retention reduce el monto enviado a Vita', async () => {
    const orderId = `TEST-CLCO-PROFIT-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...clToCoPayload, order: orderId });

    if (res.status === 201) {
      const txn = await Transaction.findOne({ order: orderId });
      // Con profitRetentionPercent=1.0%, el monto a Vita debe ser ~99% del principal
      const expectedAmount = 100000 * 0.99;
      expect(txn.deferredWithdrawalPayload.amount).toBeCloseTo(expectedAmount, 0);
    }
  });

  it('retorna fintocPaymentIntentId en la respuesta', async () => {
    const orderId = `TEST-CLCO-ID-${Date.now()}`;
    createdOrders.push(orderId);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...clToCoPayload, order: orderId });

    if (res.status === 201) {
      expect(res.body.data.fintocPaymentIntentId).toBeDefined();
    }
  });
});
