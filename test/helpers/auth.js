/**
 * test/helpers/auth.js
 * Helpers para crear usuarios de test directamente en MongoDB
 * (sin pasar por el flujo de registro/email/KYC — eso se testea en 02-auth.test.js)
 */
import jwt from 'jsonwebtoken';
import User from '../../src/models/User.js';

/**
 * Crea un usuario de test con KYC aprobado (listo para transaccionar)
 */
export async function createApprovedUser(overrides = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = new User({
    name: 'Test User',
    email: `approved-${suffix}@alyto-test.com`,
    password: 'TestPass@123',
    isEmailVerified: true,
    registrationCountry: 'CL',
    contractAcceptance: {
      accepted: true,
      version: 'v1.0',
      acceptedAt: new Date(),
      ipAddress: '127.0.0.1',
      deviceFingerprint: 'test-device',
    },
    kyc: {
      level: 2,
      status: 'approved',
      verifiedAt: new Date(),
    },
    firstName: 'Test',
    lastName: 'User',
    documentType: 'DNI',
    documentNumber: '12345678',
    phoneNumber: '+56912345678',
    address: 'Test Address 123',
    ...overrides,
  });
  await user.save();
  return user;
}

/**
 * Crea un usuario con KYC en un estado específico (para testear el gate)
 */
export async function createUserWithKycStatus(kycStatus) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = new User({
    name: 'KYC Test User',
    email: `kyc-${kycStatus}-${suffix}@alyto-test.com`,
    password: 'TestPass@123',
    isEmailVerified: true,
    registrationCountry: 'CL',
    contractAcceptance: {
      accepted: true,
      version: 'v1.0',
      acceptedAt: new Date(),
    },
    kyc: { level: kycStatus === 'approved' ? 2 : 1, status: kycStatus },
  });
  await user.save();
  return user;
}

/**
 * Crea un usuario admin de test
 */
export async function createAdminUser() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = new User({
    name: 'Admin Test',
    email: `admin-${suffix}@alyto-test.com`,
    password: 'AdminPass@123',
    isEmailVerified: true,
    role: 'admin',
    registrationCountry: 'CL',
    contractAcceptance: { accepted: true, version: 'v1.0', acceptedAt: new Date() },
    kyc: { level: 2, status: 'approved' },
  });
  await user.save();
  return user;
}

/**
 * Genera un JWT válido para el usuario dado
 */
export function generateToken(user) {
  return jwt.sign(
    { userId: user._id, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
}
