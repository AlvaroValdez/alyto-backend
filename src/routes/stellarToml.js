/**
 * /.well-known/stellar.toml
 *
 * Required for SEP-12 discovery by Stellar wallets.
 * Declares the KYC_SERVER, TRANSFER_SERVER, and basic anchor metadata.
 */

import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
    const base = process.env.BACKEND_URL || 'https://api.alyto.app';
    const frontend = process.env.FRONTEND_URL || 'https://avf-vita-fe10.onrender.com';

    const toml = `
# Alyto — Stellar Anchor Configuration
# SEP-1: Stellar TOML

ACCOUNTS = []
VERSION = "0.1.0"
SIGNING_KEY = "${process.env.STELLAR_SIGNING_KEY || ''}"
NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015"

[DOCUMENTATION]
ORG_NAME = "AV Finance"
ORG_URL = "${frontend}"
ORG_DESCRIPTION = "Plataforma de transferencias internacionales Chile-Bolivia"
ORG_PHYSICAL_ADDRESS = "Santiago, Chile"
ORG_SUPPORT_EMAIL = "soporte@avfinance.cl"

# SEP-12: KYC API
KYC_SERVER = "${base}/api/sep12"

# SEP-6: Deposit & Withdrawal
TRANSFER_SERVER = "${base}/api"

# SEP-10: Web Authentication (Phase 2)
# WEB_AUTH_ENDPOINT = "${base}/api/auth/stellar"

[[CURRENCIES]]
code = "USDC"
issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
display_decimals = 2
name = "USD Coin"
desc = "Moneda de liquidación usada internamente"
is_asset_anchored = true
anchor_asset_type = "fiat"
anchor_asset = "USD"
`.trim();

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(toml);
});

export default router;
