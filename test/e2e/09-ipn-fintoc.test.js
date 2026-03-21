/**
 * 09-ipn-fintoc.test.js
 * Testea el handler de webhooks de Fintoc.
 * Endpoint: POST /api/ipn/fintoc
 *
 * Fintoc IPN se monta DESPUÉS de express.json() en app.js → body siempre parseado. ✅
 * La firma se verifica con FINTOC_WEBHOOK_SECRET del .env.
 */
import supertest from 'supertest';
import nock from 'nock';
import app from '../../src/app.js';
import Transaction from '../../src/models/Transaction.js';
import User from '../../src/models/User.js';
import { createApprovedUser } from '../helpers/auth.js';
import { signFintocWebhook } from '../helpers/signatures.js';

const req = supertest(app);
const VITA_STAGE_URL = 'https://api.stage.vitawallet.io';

let user;
const createdOrders = [];

beforeAll(async () => {
  user = await createApprovedUser();
});

afterAll(async () => {
  nock.cleanAll();
  await Transaction.deleteMany({ order: { $in: createdOrders } });
  await User.deleteMany({ _id: user._id });
});

afterEach(() => {
  nock.cleanAll();
});

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────
async function createTestTransaction(orderId, overrides = {}) {
  createdOrders.push(orderId);
  return await Transaction.create({
    order: orderId,
    country: 'CO',
    currency: 'CLP',
    amount: 100000,
    beneficiary_first_name: 'Test',
    beneficiary_last_name: 'Beneficiary',
    status: 'pending',
    payinStatus: 'pending',
    payoutStatus: 'pending',
    createdBy: user._id,
    ...overrides,
  });
}

describe('09 — IPN Fintoc › Autenticación', () => {
  it('rechaza IPN con firma inválida → 401', async () => {
    const body = {
      type: 'payment.succeeded',
      data: { metadata: { orderId: 'test-order-fake' } },
    };

    const res = await req
      .post('/api/ipn/fintoc')
      .set({
        'Content-Type': 'application/json',
        'fintoc-signature': 't=1234567890,v1=firma_incorrecta_aqui',
      })
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('acepta IPN con firma válida → no 401', async () => {
    const orderId = `TEST-FINTOC-AUTH-${Date.now()}`;
    await createTestTransaction(orderId);

    const body = {
      type: 'payment.succeeded',
      data: { metadata: { orderId } },
    };
    const { headers } = signFintocWebhook(body);

    const res = await req
      .post('/api/ipn/fintoc')
      .set(headers)
      .send(body);

    expect(res.status).not.toBe(401);
  });
});

describe('09 — IPN Fintoc › payment.succeeded (flujo híbrido auto CL→CO)', () => {
  it('ejecuta withdrawal diferido en Vita al recibir pago confirmado → 200', async () => {
    const orderId = `TEST-FINTOC-DEFERRED-${Date.now()}`;

    // Mock Vita withdrawal API
    nock(VITA_STAGE_URL)
      .post('/api/businesses/transactions')
      .reply(201, {
        data: {
          id: `vita-withdrawal-mock-${Date.now()}`,
          status: 'processing',
        },
      });

    await createTestTransaction(orderId, {
      payinStatus: 'pending',
      payoutStatus: 'pending',
      deferredWithdrawalPayload: {
        url_notify: 'https://test.example.com/ipn',
        currency: 'cop',
        country: 'CO',
        amount: 99000,
        order: orderId,
        transactions_type: 'withdrawal',
        wallet: process.env.VITA_BUSINESS_WALLET_UUID,
        beneficiary_type: 'person',
        beneficiary_first_name: 'Andrés',
        beneficiary_last_name: 'Torres',
        beneficiary_email: 'andres@test.com',
        beneficiary_address: 'Bogotá Test',
        beneficiary_document_type: 'CC',
        beneficiary_document_number: '80123456',
        account_type_bank: 'savings',
        account_bank: '123456789012',
        bank_code: 1007,
        purpose: 'EPFAMT',
        purpose_comentary: 'Test',
      },
    });

    const body = {
      type: 'payment.succeeded',
      data: {
        metadata: { orderId },
        amount: 101490,
        currency: 'CLP',
      },
    };
    const { headers } = signFintocWebhook(body);

    const res = await req
      .post('/api/ipn/fintoc')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);

    const txn = await Transaction.findOne({ order: orderId });
    expect(txn.payinStatus).toBe('completed');
    expect(['processing', 'failed']).toContain(txn.payoutStatus);

    if (nock.isDone()) {
      expect(txn.payoutStatus).toBe('processing');
      expect(txn.vitaWithdrawalId).toBeDefined();
    }
  });
});

describe('09 — IPN Fintoc › payment.succeeded (flujo CL→BO manual)', () => {
  it('payin completado, payout queda en pending_manual_payout → 200', async () => {
    const orderId = `TEST-FINTOC-MANUAL-${Date.now()}`;

    await createTestTransaction(orderId, {
      country: 'BO',
      payinStatus: 'pending',
      payoutStatus: 'pending_manual_payout', // CL→BO: admin procesa
      deferredWithdrawalPayload: null,
    });

    const body = {
      type: 'payment.succeeded',
      data: {
        metadata: { orderId },
        amount: 50000,
        currency: 'CLP',
      },
    };
    const { headers } = signFintocWebhook(body);

    const res = await req
      .post('/api/ipn/fintoc')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);

    const txn = await Transaction.findOne({ order: orderId });
    expect(txn.payinStatus).toBe('completed');
    expect(txn.status).toBe('pending_manual_payout');
  });
});

describe('09 — IPN Fintoc › payment.failed', () => {
  it('marca transacción como failed → 200', async () => {
    const orderId = `TEST-FINTOC-FAIL-${Date.now()}`;
    await createTestTransaction(orderId);

    const body = {
      type: 'payment.failed',
      data: {
        metadata: { orderId },
        error_message: 'Pago rechazado por el banco',
      },
    };
    const { headers } = signFintocWebhook(body);

    const res = await req
      .post('/api/ipn/fintoc')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);

    const txn = await Transaction.findOne({ order: orderId });
    expect(txn.payinStatus).toBe('failed');
    expect(txn.status).toBe('failed');
  });
});

describe('09 — IPN Fintoc › widget_link.succeeded', () => {
  it('procesa tipo de evento alternativo widget_link.succeeded → 200', async () => {
    const orderId = `TEST-FINTOC-WIDGET-${Date.now()}`;
    await createTestTransaction(orderId, {
      deferredWithdrawalPayload: null,
      payoutStatus: 'pending',
    });

    const body = {
      type: 'widget_link.succeeded',
      data: { metadata: { orderId } },
    };
    const { headers } = signFintocWebhook(body);

    const res = await req
      .post('/api/ipn/fintoc')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);

    const txn = await Transaction.findOne({ order: orderId });
    expect(txn.payinStatus).toBe('completed');
  });
});

describe('09 — IPN Fintoc › Eventos no procesados', () => {
  it('eventos desconocidos se ignoran pero retornan 200', async () => {
    const body = { type: 'payment.pending', data: {} };
    const { headers } = signFintocWebhook(body);

    const res = await req
      .post('/api/ipn/fintoc')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
  });
});
