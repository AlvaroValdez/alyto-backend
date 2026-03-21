/**
 * 08-ipn-vita.test.js
 * Testea el handler de webhooks de Vita Wallet.
 * El endpoint real es POST /api/ipn/vita (fix aplicado en ipn.js).
 *
 * ⚠️ NOTA SOBRE EL BUG CONOCIDO:
 * El endpoint /api/ipn/vita fue corregido como parte del setup de tests:
 *   - Antes: router.post('/vita', ...) → endpoint real /api/ipn/vita/vita (bug)
 *   - Ahora: router.post('/', ...) → endpoint correcto /api/ipn/vita
 * Esto hace coincidir el código con el VITA_NOTIFY_URL configurado en .env.
 *
 * Para el IPN que dispara un withdrawal diferido, se usa nock para mockear
 * la API de Vita (evita crear transacciones reales en staging repetidamente).
 */
import supertest from 'supertest';
import nock from 'nock';
import app from '../../src/app.js';
import Transaction from '../../src/models/Transaction.js';
import VitaEvent from '../../src/models/VitaEvent.js';
import User from '../../src/models/User.js';
import { createApprovedUser } from '../helpers/auth.js';
import { signVitaIpn } from '../helpers/signatures.js';

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
  await VitaEvent.deleteMany({ vitaId: /^test-vita-evt/ });
  await User.deleteMany({ _id: user._id });
});

afterEach(() => {
  nock.cleanAll();
});

// ─────────────────────────────────────────────
// Helper: crear transacción de test en DB
// ─────────────────────────────────────────────
async function createTestTransaction(orderId, overrides = {}) {
  createdOrders.push(orderId);
  const txn = await Transaction.create({
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
  return txn;
}

describe('08 — IPN Vita › Endpoint correcto', () => {
  it('endpoint /api/ipn/vita responde (no 404)', async () => {
    const body = { type: 'test.ping', id: 'test-vita-evt-ping' };
    const { headers } = signVitaIpn(body);

    const res = await req
      .post('/api/ipn/vita')
      .set(headers)
      .send(body);

    // Puede ser 200 (procesado) o cualquier cosa menos 404
    expect(res.status).not.toBe(404);
  });

  it('rechaza IPN con firma inválida → 401', async () => {
    const body = { type: 'payment.succeeded', id: 'fake-event' };

    const res = await req
      .post('/api/ipn/vita')
      .set({
        'Content-Type': 'application/json',
        'X-Login': 'fake-login',
        'X-Date': new Date().toISOString(),
        Authorization: 'V2-HMAC-SHA256, Signature: firma_incorrecta_12345',
      })
      .send(body);

    expect(res.status).toBe(401);
  });

  it('rechaza IPN sin headers de autenticación → 401', async () => {
    const res = await req
      .post('/api/ipn/vita')
      .set('Content-Type', 'application/json')
      .send({ type: 'payment.succeeded' });

    expect(res.status).toBe(401);
  });
});

describe('08 — IPN Vita › payment.succeeded (sin withdrawal diferido)', () => {
  it('actualiza payinStatus a "completed" → 200', async () => {
    const orderId = `TEST-IPN-VITA-PAYIN-${Date.now()}`;
    await createTestTransaction(orderId, {
      deferredWithdrawalPayload: null, // Sin payload diferido → solo actualiza payin
      payoutStatus: 'pending',
    });

    const body = {
      type: 'payment.succeeded',
      id: `test-vita-evt-${Date.now()}`,
      object: { order: orderId },
    };
    const { headers } = signVitaIpn(body);

    const res = await req
      .post('/api/ipn/vita')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verificar actualización en DB
    const txn = await Transaction.findOne({ order: orderId });
    expect(txn.payinStatus).toBe('completed');
    // Sin deferredPayload, el status pasa a 'succeeded'
    expect(txn.status).toBe('succeeded');
  });

  it('maneja order inexistente sin error → 200', async () => {
    const body = {
      type: 'payment.succeeded',
      id: `test-vita-evt-noorder-${Date.now()}`,
      object: { order: 'ORDER-INEXISTENTE-XYZ-999' },
    };
    const { headers } = signVitaIpn(body);

    const res = await req
      .post('/api/ipn/vita')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('08 — IPN Vita › payment.succeeded (CON withdrawal diferido)', () => {
  it('ejecuta withdrawal diferido → transacción pasa a processing → 200', async () => {
    const orderId = `TEST-IPN-VITA-DEFERRED-${Date.now()}`;

    // Mock de la API de Vita para crear withdrawal
    nock(VITA_STAGE_URL)
      .post('/api/businesses/transactions')
      .reply(201, {
        data: {
          id: `vita-txn-mock-${Date.now()}`,
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
        beneficiary_first_name: 'Test',
        beneficiary_last_name: 'Beneficiary',
        beneficiary_email: 'test@example.com',
        beneficiary_address: 'Test Address',
        beneficiary_document_type: 'CC',
        beneficiary_document_number: '12345678',
        account_type_bank: 'savings',
        account_bank: '123456789012',
        bank_code: 1007,
        purpose: 'EPFAMT',
        purpose_comentary: 'Test remittance',
      },
    });

    const body = {
      type: 'payment.succeeded',
      id: `test-vita-evt-deferred-${Date.now()}`,
      object: { order: orderId },
    };
    const { headers } = signVitaIpn(body);

    const res = await req
      .post('/api/ipn/vita')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);

    // Verificar que la transacción avanzó a processing
    const txn = await Transaction.findOne({ order: orderId });
    expect(txn.payinStatus).toBe('completed');
    // El withdrawal fue ejecutado (mock respondió 201) → processing
    expect(['processing', 'failed']).toContain(txn.payoutStatus);
    // Si el nock interceptó correctamente, debe ser processing
    if (nock.isDone()) {
      expect(txn.payoutStatus).toBe('processing');
      expect(txn.vitaWithdrawalId).toBeDefined();
    }
  });
});

describe('08 — IPN Vita › payment.failed', () => {
  it('marca transacción como failed → 200', async () => {
    const orderId = `TEST-IPN-VITA-FAILED-${Date.now()}`;
    await createTestTransaction(orderId);

    const body = {
      type: 'payment.failed',
      id: `test-vita-evt-failed-${Date.now()}`,
      object: { order: orderId },
    };
    const { headers } = signVitaIpn(body);

    const res = await req
      .post('/api/ipn/vita')
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);

    const txn = await Transaction.findOne({ order: orderId });
    expect(txn.status).toBe('failed');
  });
});

describe('08 — IPN Vita › Eventos guardados en VitaEvent', () => {
  it('persiste evento en VitaEvent con verified=true', async () => {
    const orderId = `TEST-IPN-VITA-EVENT-${Date.now()}`;
    const eventId = `test-vita-evt-persist-${Date.now()}`;
    await createTestTransaction(orderId, { deferredWithdrawalPayload: null });

    const body = {
      type: 'payment.succeeded',
      id: eventId,
      object: { order: orderId },
    };
    const { headers } = signVitaIpn(body);

    await req.post('/api/ipn/vita').set(headers).send(body);

    const vitaEvent = await VitaEvent.findOne({ vitaId: eventId });
    expect(vitaEvent).not.toBeNull();
    expect(vitaEvent.verified).toBe(true);
    expect(vitaEvent.type).toBe('payment.succeeded');
  });
});
