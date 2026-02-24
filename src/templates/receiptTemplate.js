// src/templates/receiptTemplate.js

/**
 * Genera el HTML del comprobante oficial de transacción
 * @param {Object} data - Datos del comprobante
 * @returns {String} - HTML completo del comprobante
 */
export function generateReceiptHTML(data) {
    const {
        receiptNumber,
        company,
        transaction,
        client,
        amount,
        crypto,
        verification,
        generatedAt,
        timezone
    } = data;

    // Formatear fecha y hora
    const formatDateTime = (date) => {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    };

    // Formatear montos
    const formatBOB = (value) => `Bs. ${Number(value).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
    const formatUSD = (value) => `$${Number(value).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
    const formatCrypto = (value, symbol) => `${Number(value).toFixed(8)} ${symbol}`;

    // Truncar wallet
    const truncateWallet = (wallet) => {
        if (wallet && wallet.length > 20) {
            return `${wallet.slice(0, 8)}...${wallet.slice(-6)}`;
        }
        return wallet || '';
    };

    // Traducir tipo de transacción
    const displayMap = {
        'COMPRA_ACTIVOS': 'Compra de Activos Digitales',
        'PAGO_TERCEROS': 'Pago a Terceros (Transferencia)',
        'REMESA_SALIENTE': 'Transferencia Internacional Saliente',
        'CONVERSION': 'Conversión de Divisas'
    };

    const statusIcons = {
        'CONFIRMADA': '✅ CONFIRMADA',
        'PENDIENTE': '⏳ PENDIENTE',
        'FALLIDA': '❌ FALLIDA'
    };

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comprobante Oficial de Transacción - ${receiptNumber}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 20px;
        }

        .receipt-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }

        /* HEADER */
        .header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 30px 40px;
            position: relative;
        }

        .header::after {
            content: '';
            position: absolute;
            bottom: -10px;
            left: 0;
            right: 0;
            height: 10px;
            background: linear-gradient(90deg, #f39c12, #e74c3c, #9b59b6, #3498db);
        }

        .logo-section {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .logo {
            font-size: 32px;
            font-weight: 700;
            letter-spacing: -1px;
        }

        .logo .av {
            color: #f39c12;
        }

        .logo .finance {
            color: white;
        }

        .logo .alyto {
            font-size: 18px;
            color: #3498db;
            display: block;
            margin-top: -5px;
            font-weight: 400;
        }

        .receipt-number {
            text-align: right;
            font-size: 14px;
            opacity: 0.9;
        }

        .receipt-number .number {
            font-size: 20px;
            font-weight: 700;
            display: block;
            margin-top: 5px;
            letter-spacing: 1px;
        }

        .company-info {
            font-size: 13px;
            line-height: 1.8;
            opacity: 0.95;
        }

        .company-info strong {
            font-weight: 600;
            color: #f39c12;
        }

        .regulatory-badge {
            background: rgba(255,255,255,0.15);
            border: 1px solid rgba(255,255,255,0.3);
            border-radius: 8px;
            padding: 15px;
            margin-top: 20px;
            font-size: 11px;
            line-height: 1.6;
            backdrop-filter: blur(10px);
        }

        .regulatory-badge .shield {
            display: inline-block;
            margin-right: 8px;
            font-size: 16px;
        }

        /* BODY */
        .body {
            padding: 40px;
        }

        .section {
            margin-bottom: 30px;
        }

        .section-title {
            font-size: 14px;
            font-weight: 700;
            color: #2c3e50;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e0e0e0;
        }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
        }

        .info-item {
            display: flex;
            flex-direction: column;
        }

        .info-label {
            font-size: 11px;
            color: #7f8c8d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
            font-weight: 600;
        }

        .info-value {
            font-size: 14px;
            color: #2c3e50;
            font-weight: 500;
        }

        .info-value.highlight {
            color: #3498db;
            font-weight: 700;
        }

        .blockchain-hash {
            background: #f8f9fa;
            padding: 12px;
            border-radius: 6px;
            border-left: 4px solid #3498db;
            margin-top: 15px;
        }

        .blockchain-hash .label {
            font-size: 11px;
            color: #7f8c8d;
            margin-bottom: 6px;
            font-weight: 600;
        }

        .blockchain-hash .hash-value {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #16a085;
            word-break: break-all;
            line-height: 1.6;
        }

        .blockchain-hash .verification-note {
            font-size: 10px;
            color: #95a5a6;
            margin-top: 6px;
            font-style: italic;
        }

        /* ECONOMIC DETAILS */
        .economic-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            margin-top: 15px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
        }

        .economic-table tr:nth-child(even) {
            background: #f8f9fa;
        }

        .economic-table td {
            padding: 12px 15px;
            font-size: 13px;
        }

        .economic-table td:first-child {
            color: #7f8c8d;
            font-weight: 600;
            width: 60%;
        }

        .economic-table td:last-child {
            text-align: right;
            font-weight: 600;
            color: #2c3e50;
        }

        .economic-table .total-row {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
        }

        .economic-table .total-row td {
            color: white;
            font-size: 16px;
            font-weight: 700;
            padding: 16px 15px;
        }

        .economic-table .subtotal-row {
            background: #ecf0f1;
        }

        .economic-table .subtotal-row td {
            font-weight: 700;
            color: #34495e;
        }

        /* FOOTER */
        .footer {
            background: #f8f9fa;
            padding: 30px 40px;
            border-top: 3px solid #e0e0e0;
        }

        .legal-text {
            font-size: 11px;
            line-height: 1.8;
            color: #34495e;
            text-align: justify;
            padding: 20px;
            background: white;
            border-radius: 8px;
            border-left: 4px solid #27ae60;
        }

        .legal-text .icon {
            display: inline-block;
            margin-right: 8px;
            color: #27ae60;
            font-size: 14px;
        }

        .signature-area {
            margin-top: 30px;
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 30px;
        }

        .signature-box {
            text-align: center;
            padding-top: 30px;
        }

        .signature-line {
            border-top: 2px solid #2c3e50;
            padding-top: 8px;
            font-size: 11px;
            color: #7f8c8d;
            font-weight: 600;
        }

        .qr-code-container {
            width: 120px;
            height: 120px;
            margin: 0 auto 10px;
            border-radius: 8px;
            overflow: hidden;
        }

        .qr-code-container img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }

        .footer-info {
            margin-top: 20px;
            text-align: center;
            font-size: 10px;
            color: #95a5a6;
        }

        /* PRINT STYLES */
        @media print {
            body {
                background: white;
                padding: 0;
            }

            .receipt-container {
                box-shadow: none;
                border-radius: 0;
            }
        }
    </style>
</head>
<body>
    <div class="receipt-container">
        <!-- HEADER -->
        <div class="header">
            <div class="logo-section">
                <div class="logo">
                    <span class="av">${company.logoPrefix || 'AV'}</span><span class="finance">${company.logoSuffix || 'Finance'}</span>
                    <span class="alyto">${company.tagline || 'powered by Alyto'}</span>
                </div>
                <div class="receipt-number">
                    <span>COMPROBANTE N°</span>
                    <span class="number">${receiptNumber}</span>
                </div>
            </div>

            <div class="company-info">
                <strong>Razón Social:</strong> ${company.legalName}<br>
                <strong>NIT:</strong> ${company.nit}<br>
                <strong>Dirección Legal:</strong> ${company.address}<br>
                <strong>Teléfono:</strong> ${company.phone} | <strong>Email:</strong> ${company.email}
            </div>

            <div class="regulatory-badge">
                <span class="shield">🛡️</span>
                <strong>Leyenda Regulatoria:</strong> Empresa de Tecnología Financiera (ETF) y Proveedor de Servicios de Activos Virtuales (PSAV) conforme al Decreto Supremo N° 5384 y Circular ASFI 885/2025. Autorizada para operar servicios financieros digitales en el Estado Plurinacional de Bolivia.
            </div>
        </div>

        <!-- BODY -->
        <div class="body">
            <!-- SECCIÓN A: INFORMACIÓN DE LA TRANSACCIÓN -->
            <div class="section">
                <div class="section-title">📋 Información de la Transacción</div>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Fecha y Hora</span>
                        <span class="info-value">${formatDateTime(transaction.timestamp)}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Tipo de Operación</span>
                        <span class="info-value highlight">${transactionTypes[transaction.type] || transaction.type}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Red Blockchain</span>
                        <span class="info-value">${transaction.network}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Estado</span>
                        <span class="info-value highlight">${statusIcons[transaction.status] || transaction.status}</span>
                    </div>
                </div>

                <div class="blockchain-hash">
                    <div class="label">🔗 HASH DE TRANSACCIÓN (TXID) - PRUEBA BLOCKCHAIN</div>
                    <div class="hash-value">${transaction.txHash}</div>
                    <div class="verification-note">
                        ℹ️ Este Hash es la prueba inmutable en la red distribuida Stellar. Puede verificarse públicamente en <strong>stellar.expert</strong> o <strong>stellarchain.io</strong>.
                    </div>
                </div>
            </div>

            <!-- SECCIÓN B: DATOS DEL CLIENTE -->
            <div class="section">
                <div class="section-title">👤 Datos del Cliente</div>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Razón Social / Nombre</span>
                        <span class="info-value">${client.legalName}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">NIT / CI</span>
                        <span class="info-value">${client.nit}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Código de Cliente (KYC)</span>
                        <span class="info-value">${client.kycCode}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Email de Contacto</span>
                        <span class="info-value">${client.email}</span>
                    </div>
                </div>
            </div>

            <!-- SECCIÓN C: DETALLE ECONÓMICO -->
            <div class="section">
                <div class="section-title">💰 Detalle Económico de la Operación</div>
                
                <table class="economic-table">
                    <tr>
                        <td>Moneda de Origen</td>
                        <td>${amount.currency === 'BOB' ? 'Bolivianos (BOB)' : amount.currency}</td>
                    </tr>
                    <tr>
                        <td>Monto Recibido del Cliente</td>
                        <td>${formatBOB(amount.received)}</td>
                    </tr>
                    <tr>
                        <td>Tipo de Cambio Aplicado (BOB/USD)</td>
                        <td>${Number(amount.exchangeRate).toFixed(2)} Bs/USD</td>
                    </tr>
                    <tr>
                        <td>Equivalente en USD</td>
                        <td>${formatUSD(amount.usdEquivalent)}</td>
                    </tr>
                    <tr class="subtotal-row">
                        <td>Comisión del Servicio (Fee ${Number(amount.feePercentage).toFixed(2)}%)</td>
                        <td>${formatBOB(amount.feeAmount)}</td>
                    </tr>
                    <tr>
                        <td>Monto Neto para Conversión</td>
                        <td>${formatBOB(amount.netAmount)}</td>
                    </tr>
                    <tr>
                        <td>Activo Virtual Entregado</td>
                        <td>${formatCrypto(crypto.amount, crypto.symbol)}</td>
                    </tr>
                    ${crypto.destinationWallet ? `
                    <tr>
                        <td>Dirección de Wallet de Destino</td>
                        <td style="font-family: 'Courier New', monospace; font-size: 11px; word-break: break-all;">
                            ${truncateWallet(crypto.destinationWallet)}
                        </td>
                    </tr>
                    ` : ''}
                    <tr class="total-row">
                        <td>TOTAL OPERACIÓN</td>
                        <td>${formatBOB(amount.total)}</td>
                    </tr>
                </table>
            </div>
        </div>

        <!-- FOOTER -->
        <div class="footer">
            <div class="legal-text">
                <span class="icon">⚖️</span>
                <strong>VALIDEZ LEGAL:</strong> El presente documento constituye un comprobante de pago válido emitido por una entidad constituida en el Estado Plurinacional de Bolivia. Se emite en conformidad con la Ley N° 1613 (Código Tributario Boliviano) y el Artículo 7 del Decreto Supremo N° 5301 que facultan el uso de activos virtuales para el cumplimiento de obligaciones. Este documento cuenta con respaldo digital verificable en Blockchain Stellar y es apto para el respaldo de bancarización según la Resolución Normativa de Directorio (RND) 10-24-000021 de Impuestos Nacionales. El cliente debe conservar este comprobante para efectos de deducibilidad del Impuesto sobre las Utilidades de las Empresas (IUE) y cumplimiento del Anexo de Bancarización (FORM 610).
            </div>

            <div class="signature-area">
                <div class="signature-box">
                    ${verification.qrCode ? `
                    <div class="qr-code-container">
                        <img src="${verification.qrCode}" alt="QR Code de Verificación" />
                    </div>
                    ` : `
                    <div style="width: 120px; height: 120px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0 auto 10px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; text-align: center; padding: 10px;">
                        QR CODE<br>Verificación Digital
                    </div>
                    `}
                    <div class="signature-line">CÓDIGO QR DE VERIFICACIÓN</div>
                </div>
                <div class="signature-box">
                    <div style="padding-top: 50px;"></div>
                    <div class="signature-line">
                        FIRMA AUTORIZADA<br>
                        ${company.legalName}
                    </div>
                </div>
            </div>

            <div class="footer-info">
                Documento generado electrónicamente el ${formatDateTime(generatedAt)} ${timezone}<br>
                Para consultas: ${company.email} | ${company.website || 'www.avfinance.bo'}<br>
                Este comprobante tiene validez sin firma autógrafa según Art. 5 de la Ley N° 164 (Ley General de Telecomunicaciones)
            </div>
        </div>
    </div>
</body>
</html>`;
}
