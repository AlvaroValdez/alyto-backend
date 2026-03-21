# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot-reload via nodemon)
npm run dev

# Production
npm start

# Seed database
npm run seed

# Run all E2E tests
npm test

# Run a single test file
npx vitest run test/e2e/10-full-flow.test.js
```

Tests use Vitest 2.x with `singleFork: true` + `isolate: false` to share MongoDB connection and avoid `OverwriteModelError`. Tests run against a real MongoDB Atlas test database (`remesas-test`). Rate limiters are skipped in test env via `skip: () => NODE_ENV === 'test'`.

## Architecture Overview

**Alyto Backend** is a multi-country remittance platform (Express.js + MongoDB/Mongoose, Node.js ES modules). It routes fiat payments through Vita Wallet (primary processor) and Fintoc (alternative pay-in), with Stellar/SEP-12 support for crypto rails.

### Entry Points

- `src/server.js` — starts the HTTP server
- `src/app.js` — Express app: middleware stack, all route mounts
- `src/config/env.js` — all environment variables exported as named constants (import from here, not `process.env` directly)
- `src/config/mongo.js` — MongoDB connection

### Route Organization (`src/routes/`)

23 route files, domain-organized:
- `auth.js` — registration, login, password reset, KYC document upload
- `withdrawals.js` — main transaction creation & payout orchestration
- `transactions.js` — transaction queries/listing
- `fx.js` — FX calculator & quote endpoints
- `prices.js` — price feeds (uses Vita rates + markup)
- `ipn.js` — Vita webhook (IPN) handler; requires raw body, mounted **before** `express.json()`
- `ipnFintoc.js` — Fintoc webhook handler
- `sep12.js` — Stellar SEP-12 KYC endpoints
- `receipts.js` — receipt generation (PDF via Puppeteer)
- `adminTreasury.js` — treasury hold & balance management
- `admin*.js` — admin-only routes (KYC review, compliance limits, markup config, etc.)

### Key Services (`src/services/`)

| File | Responsibility |
|---|---|
| `vitaService.js` | Vita Wallet API client; caches prices with fallback rates |
| `vitaClient.js` | Axios HTTP client for Vita |
| `fxCalculator.js` | FX quote calculations with spread-based fee breakdown |
| `complianceService.js` | AML limits validation, transaction capping per KYC level |
| `fintocService.js` | Fintoc pay-in widget integration |
| `notificationService.js` | Orchestrates email + FCM push notifications |
| `emailService.js` | SendGrid / Nodemailer delivery |
| `fcmService.js` | Firebase Cloud Messaging |
| `receiptService.js` | Tax-compliant receipt generation (Bolivia) |
| `markupService.js` | Fee markup rules per country |
| `withdrawalValidator.js` | Pre-flight validation before payout submission |

### Data Models (`src/models/`)

- **User** — KYC levels (0–3), SEP-12/Stellar fields, KYB for businesses, account lockout
- **Transaction** — dual-status (`payinStatus` / `payoutStatus`), Vita + Fintoc IDs, treasury hold, fees, compliance
- **Receipt** — Bolivian tax-compliant receipts (sequential ALY-YYYY-NNNNNN numbering)
- **ComplianceLimits** — per-user/per-country AML transaction limits
- **FxSettings**, **Markup**, **TransactionConfig** — runtime configuration for rates and fees
- **VitaEvent** — webhook event log

### Payment Flow

1. **Pay-in:** Fintoc widget → webhook → `ipnFintoc.js` updates `payinStatus`
2. **Pay-out:** `withdrawals.js` calls Vita API → `vitaWithdrawalId` stored → Vita IPN (`ipn.js`) updates `payoutStatus`
3. **Treasury holds:** If Vita balance is insufficient, transaction enters `treasuryHold` state; `adminTreasury.js` releases it manually
4. **KYC gate:** `kyc.status === 'approved'` is required before any transaction is processed

### Authentication & Middleware

- `authMiddleware.js` — JWT verification (`verifyToken`) + admin check (`isAdmin`)
- `sep12Auth.js` — Stellar SEP-10 token verification
- `optionalAuth.js` — JWT verification that doesn't block unauthenticated requests
- `rateLimiters.js` — per-route limits (login, registration, KYC upload, transactions)
- `vitaSignature.js` — HMAC verification for Vita IPN webhooks
- `uploadMiddleware.js` — Multer + Cloudinary for KYC document uploads

### Supported Corridors

Defined in `src/data/supportedOrigins.js`. Active: CL (Fintoc), CO, AR, MX, BR, PE, BO (manual anchor). Each origin configures its currency, fee structure, FX provider, and compliance limits.

### Logging

Winston logger (`src/config/logger.js`) writes to `src/logs/error.log` and `src/logs/combined.log`. Use `src/utils/logSanitizer.js` when logging objects that may contain PII or credentials.

### Bolivian Compliance (Receipts)

Receipt PDFs are generated with Puppeteer and must conform to Bolivian tax law (Ley N° 1613, DS 5301/5384, RND 10-24-000021). The `receipt/` subfolder under services contains the templates and generation logic. Counter model (`Counter.js`) tracks the sequential receipt number.

### Precision & Currency Math

Always use `decimal.js` for monetary calculations — never native JS floating-point arithmetic.
