/**
 * 03-kyc-gate.test.js
 * Verifica que el gate de KYC bloquea transacciones para usuarios no aprobados.
 * Un usuario con KYC aprobado puede pasar — aunque la transacción pueda fallar
 * por otro motivo (datos incompletos), NO debe fallar por KYC.
 */
import supertest from 'supertest';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import { createUserWithKycStatus, generateToken } from '../helpers/auth.js';

const req = supertest(app);
const createdUsers = [];

afterAll(async () => {
  const ids = createdUsers.map((u) => u._id);
  await User.deleteMany({ _id: { $in: ids } });
});

// Payload mínimo válido para intentar una transacción
const minimalWithdrawalPayload = {
  country: 'BO',
  currency: 'BOB',
  amount: 100,
};

describe('03 — KYC Gate › Bloqueos por estado KYC', () => {
  const kycBlockedStatuses = ['unverified', 'pending', 'rejected', 'review'];

  for (const kycStatus of kycBlockedStatuses) {
    it(`bloquea transacción con kyc.status="${kycStatus}" → 403 KYC_NOT_APPROVED`, async () => {
      const user = await createUserWithKycStatus(kycStatus);
      createdUsers.push(user);
      const token = generateToken(user);

      const res = await req
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${token}`)
        .send(minimalWithdrawalPayload);

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('KYC_NOT_APPROVED');
      expect(res.body.kycStatus).toBe(kycStatus);
    });
  }

  it('NO bloquea por KYC cuando kyc.status="approved" (puede fallar por otra razón)', async () => {
    const user = await createUserWithKycStatus('approved');
    createdUsers.push(user);
    const token = generateToken(user);

    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send(minimalWithdrawalPayload);

    // No debe retornar KYC_NOT_APPROVED
    // Puede ser 201 (éxito) o cualquier otro error no-KYC
    expect(res.body.code).not.toBe('KYC_NOT_APPROVED');
  });

  it('bloquea sin token JWT → 401', async () => {
    const res = await req.post('/api/withdrawals').send(minimalWithdrawalPayload);
    expect(res.status).toBe(401);
  });

  it('bloquea con token inválido → 401', async () => {
    const res = await req
      .post('/api/withdrawals')
      .set('Authorization', 'Bearer token.invalido.aqui')
      .send(minimalWithdrawalPayload);
    expect(res.status).toBe(401);
  });
});
