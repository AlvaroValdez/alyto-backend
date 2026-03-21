/**
 * 02-auth.test.js
 * Cubre: registro, verificación de email, login.
 * NO testea subida de documentos KYC (eso requiere Cloudinary — ver 03-kyc-gate.test.js).
 */
import supertest from 'supertest';
import crypto from 'crypto';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../../src/models/User.js';

const req = supertest(app);

// Emails creados en este archivo — se limpian en afterAll
const createdEmails = [];

afterAll(async () => {
  await User.deleteMany({ email: { $in: createdEmails } });
});

// ─────────────────────────────────────────────
// REGISTRO
// ─────────────────────────────────────────────
describe('02 — Auth › Registro', () => {
  it('registra un usuario con datos válidos → 201', async () => {
    const email = `reg-valid-${Date.now()}@alyto-test.com`;
    createdEmails.push(email);

    const res = await req.post('/api/auth/register').send({
      name: 'Test Registro',
      email,
      password: 'TestPass@123',
      contractAccepted: true,
      registrationCountry: 'CL',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('rechaza email duplicado → 400', async () => {
    const email = `reg-dup-${Date.now()}@alyto-test.com`;
    createdEmails.push(email);

    // Primer registro
    await req.post('/api/auth/register').send({
      name: 'Usuario Original',
      email,
      password: 'TestPass@123',
      contractAccepted: true,
    });

    // Segundo registro con mismo email
    const res = await req.post('/api/auth/register').send({
      name: 'Usuario Duplicado',
      email,
      password: 'TestPass@123',
      contractAccepted: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('rechaza contraseña débil (sin mayúsculas/especiales) → 400', async () => {
    const res = await req.post('/api/auth/register').send({
      name: 'Test',
      email: `reg-weak-${Date.now()}@alyto-test.com`,
      password: 'weakpassword123',
      contractAccepted: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('rechaza registro sin contractAccepted=true → 400', async () => {
    const res = await req.post('/api/auth/register').send({
      name: 'Test',
      email: `reg-nocontract-${Date.now()}@alyto-test.com`,
      password: 'TestPass@123',
      contractAccepted: false,
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('rechaza campos obligatorios faltantes → 400', async () => {
    const res = await req.post('/api/auth/register').send({
      email: `reg-missing-${Date.now()}@alyto-test.com`,
      // Falta name y password
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────
// VERIFICACIÓN DE EMAIL
// ─────────────────────────────────────────────
describe('02 — Auth › Verificación de email', () => {
  it('verifica el email con token válido → 200', async () => {
    const email = `verify-ok-${Date.now()}@alyto-test.com`;
    createdEmails.push(email);

    // Crear usuario directamente en DB con token de verificación
    const user = new User({
      name: 'Verify Test',
      email,
      password: 'TestPass@123',
      isEmailVerified: false,
      contractAcceptance: {
        accepted: true,
        version: 'v1.0',
        acceptedAt: new Date(),
      },
    });

    // Generar token plano y guardar su hash en el user
    const plainToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');
    user.emailVerificationExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    const res = await req.get(`/api/auth/verify-email?token=${plainToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Confirmar que el usuario quedó verificado en DB
    const updated = await User.findById(user._id);
    expect(updated.isEmailVerified).toBe(true);
    expect(updated.emailVerificationToken).toBeUndefined();
  });

  it('rechaza token inválido → 400', async () => {
    const res = await req.get('/api/auth/verify-email?token=token-invalido-xyz-123');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('rechaza token expirado → 400', async () => {
    const email = `verify-expired-${Date.now()}@alyto-test.com`;
    createdEmails.push(email);

    const user = new User({
      name: 'Expired Token',
      email,
      password: 'TestPass@123',
      isEmailVerified: false,
      contractAcceptance: { accepted: true, version: 'v1.0', acceptedAt: new Date() },
    });

    const plainToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');
    user.emailVerificationExpires = Date.now() - 1000; // Ya expiró
    await user.save();

    const res = await req.get(`/api/auth/verify-email?token=${plainToken}`);
    expect(res.status).toBe(400);
  });

  it('rechaza cuando no se proporciona token → 400', async () => {
    const res = await req.get('/api/auth/verify-email');
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
describe('02 — Auth › Login', () => {
  let testEmail;
  const testPassword = 'TestPass@123';

  beforeEach(async () => {
    testEmail = `login-${Date.now()}@alyto-test.com`;
    createdEmails.push(testEmail);

    const user = new User({
      name: 'Login Test',
      email: testEmail,
      password: testPassword,
      isEmailVerified: true,
      contractAcceptance: {
        accepted: true,
        version: 'v1.0',
        acceptedAt: new Date(),
      },
    });
    await user.save();
  });

  it('login exitoso con credenciales válidas → 200 + token JWT', async () => {
    const res = await req
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.user.kyc).toBeDefined();
  });

  it('rechaza login si email no está verificado → 401', async () => {
    const unverifiedEmail = `login-unverified-${Date.now()}@alyto-test.com`;
    createdEmails.push(unverifiedEmail);

    await new User({
      name: 'Not Verified',
      email: unverifiedEmail,
      password: testPassword,
      isEmailVerified: false,
      contractAcceptance: { accepted: true, version: 'v1.0', acceptedAt: new Date() },
    }).save();

    const res = await req
      .post('/api/auth/login')
      .send({ email: unverifiedEmail, password: testPassword });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('rechaza contraseña incorrecta → 401', async () => {
    const res = await req
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'WrongPass@999' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('rechaza email no existente → 401', async () => {
    const res = await req
      .post('/api/auth/login')
      .send({ email: 'noexiste@alyto-test.com', password: testPassword });

    expect(res.status).toBe(401);
  });

  it('rechaza sin credenciales → 400', async () => {
    const res = await req.post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('rechaza request sin Authorization en ruta protegida → 401', async () => {
    const res = await req.get('/api/auth/session-status');
    expect(res.status).toBe(401);
  });

  it('permite acceso a ruta protegida con token válido → 200', async () => {
    // Login para obtener token real
    const loginRes = await req
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPassword });

    const token = loginRes.body.token;
    expect(token).toBeDefined();

    const res = await req
      .get('/api/auth/session-status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
