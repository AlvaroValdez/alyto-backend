// src/services/receipt/emailService.js
import { Resend } from 'resend';

/**
 * Servicio de envío de emails para comprobantes
 */
class EmailService {
    constructor() {
        this.resend = new Resend(process.env.RESEND_API_KEY);
        this.fromEmail = process.env.COMPANY_EMAIL || 'soporte@avfinance.bo';
        this.companyName = process.env.COMPANY_LEGAL_NAME || 'AV Finance';
    }

    /**
     * Formatear monto en bolivianos
     */
    formatBOB(amount) {
        return `Bs. ${Number(amount).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
    }

    /**
     * Formatear fecha y hora
     */
    formatDateTime(date) {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    /**
     * Generar template HTML del email
     */
    generateEmailHTML(receiptData) {
        const { receiptNumber, transaction, amount, verification, client } = receiptData;

        return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comprobante de Transacción - ${receiptNumber}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
        }
        .container {
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
        }
        .header .logo {
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .content {
            padding: 30px;
        }
        .info-box {
            background: #f8f9fa;
            border-left: 4px solid #3498db;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .info-box strong {
            color: #1e3c72;
        }
        .transaction-details {
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        .transaction-details table {
            width: 100%;
            border-collapse: collapse;
        }
        .transaction-details td {
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .transaction-details td:first-child {
            color: #7f8c8d;
            font-weight: 500;
        }
        .transaction-details td:last-child {
            text-align: right;
            font-weight: 600;
        }
        .highlight {
            color: #3498db;
            font-weight: 700;
        }
        .alert {
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 15px;
            margin: 20px 0;
        }
        .alert strong {
            color: #856404;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
            font-weight: 600;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #7f8c8d;
        }
        .legal-notice {
            background: #e8f5e9;
            border-left: 4px solid #27ae60;
            padding: 15px;
            margin: 20px 0;
            font-size: 13px;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">
                <span style="color: #f39c12;">AV</span><span>Finance</span>
            </div>
            <h1>Comprobante Oficial de Transacción</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">N° ${receiptNumber}</p>
        </div>

        <div class="content">
            <p>Estimado/a <strong>${client.legalName}</strong>,</p>

            <p>Adjunto encontrará el <strong>Comprobante Oficial de Transacción</strong> correspondiente a su operación realizada el <strong>${this.formatDateTime(transaction.timestamp)}</strong>.</p>

            <div class="transaction-details">
                <table>
                    <tr>
                        <td>Comprobante N°</td>
                        <td class="highlight">${receiptNumber}</td>
                    </tr>
                    <tr>
                        <td>Fecha</td>
                        <td>${this.formatDateTime(transaction.timestamp)}</td>
                    </tr>
                    <tr>
                        <td>Monto Total</td>
                        <td class="highlight">${this.formatBOB(amount.total)}</td>
                    </tr>
                    <tr>
                        <td>Hash Blockchain</td>
                        <td style="font-family: monospace; font-size: 11px; word-break: break-all;">${transaction.txHash.slice(0, 16)}...${transaction.txHash.slice(-16)}</td>
                    </tr>
                </table>
            </div>

            <div class="legal-notice">
                <strong>✅ VALIDEZ LEGAL:</strong> Este documento tiene validez legal para:
                <ul style="margin: 10px 0 0 20px; padding: 0;">
                    <li>Justificación de gastos ante Impuestos Nacionales</li>
                    <li>Deducibilidad del Impuesto sobre las Utilidades de las Empresas (IUE)</li>
                    <li>Cumplimiento del Anexo de Bancarización (FORM 610)</li>
                </ul>
            </div>

            <div class="info-box">
                <strong>🔗 Verificación:</strong><br>
                Puede verificar la autenticidad de este comprobante en:<br>
                <a href="${verification.url}" style="color: #3498db; word-break: break-all;">${verification.url}</a>
            </div>

            <div class="alert">
                <strong>⚠️ IMPORTANTE:</strong> Conserve este comprobante por un mínimo de <strong>5 años</strong> según lo establecido en la Ley N° 1613 (Código Tributario Boliviano).
            </div>

            <center>
                <a href="${verification.url}" class="btn">Verificar Comprobante</a>
            </center>

            <p style="margin-top: 30px;">Si tiene alguna consulta, no dude en contactarnos.</p>

            <p>Atentamente,<br>
            <strong>${this.companyName}</strong><br>
            ${process.env.COMPANY_EMAIL || 'soporte@avfinance.bo'}</p>
        </div>

        <div class="footer">
            <p><strong>${this.companyName}</strong><br>
            ${process.env.COMPANY_ADDRESS || 'La Paz - Bolivia'}<br>
            ${process.env.COMPANY_PHONE || 'Tel: +591 2 211-8765'}<br>
            ${process.env.COMPANY_EMAIL || 'soporte@avfinance.bo'}</p>
            <p style="margin-top: 15px;">
                Este es un correo automático, por favor no responda directamente a este mensaje.<br>
                Empresa de Tecnología Financiera (ETF) autorizada conforme al DS N° 5384.
            </p>
        </div>
    </div>
</body>
</html>
    `;
    }

    /**
     * Generar texto plano del email (fallback)
     */
    generateEmailText(receiptData) {
        const { receiptNumber, transaction, amount, verification, client } = receiptData;

        return `
Comprobante Oficial de Transacción
${this.companyName}

Estimado/a ${client.legalName},

Adjunto encontrará el Comprobante Oficial de Transacción correspondiente a su operación:

📋 Número de Comprobante: ${receiptNumber}
📅 Fecha: ${this.formatDateTime(transaction.timestamp)}
💰 Monto: ${this.formatBOB(amount.total)}
🔗 Hash Blockchain: ${transaction.txHash}

VALIDEZ LEGAL:
Este documento tiene validez legal para:
✅ Justificación de gastos ante Impuestos Nacionales
✅ Deducibilidad del IUE
✅ Cumplimiento del Anexo de Bancarización (FORM 610)

VERIFICACIÓN:
Puede verificar la autenticidad de este comprobante en:
${verification.url}

IMPORTANTE: Conserve este comprobante por un mínimo de 5 años según la Ley N° 1613.

Atentamente,
${this.companyName}
${process.env.COMPANY_EMAIL || 'soporte@avfinance.bo'}
    `.trim();
    }

    /**
     * Enviar comprobante por email
     * @param {Object} receipt - Documento de Receipt de MongoDB
     * @param {Buffer} pdfBuffer - Buffer del PDF
     * @returns {Promise<Object>} - Resultado del envío
     */
    async sendReceipt(receipt, pdfBuffer) {
        try {
            const receiptData = {
                receiptNumber: receipt.receiptNumber,
                transaction: receipt.transaction,
                client: receipt.client,
                amount: receipt.amount,
                verification: receipt.verification
            };

            const htmlContent = this.generateEmailHTML(receiptData);
            const textContent = this.generateEmailText(receiptData);

            const result = await this.resend.emails.send({
                from: this.fromEmail,
                to: receipt.client.email,
                subject: `Comprobante Oficial de Transacción - ${receipt.receiptNumber}`,
                html: htmlContent,
                text: textContent,
                attachments: [
                    {
                        filename: `${receipt.receiptNumber}.pdf`,
                        content: pdfBuffer
                    }
                ]
            });

            console.log(`✅ Email enviado a ${receipt.client.email}: ${result.id}`);

            return {
                success: true,
                messageId: result.id,
                error: null
            };

        } catch (error) {
            console.error('Error enviando email:', error);
            return {
                success: false,
                messageId: null,
                error: error.message
            };
        }
    }

    /**
     * Enviar email de prueba
     * @param {String} toEmail - Email destino
     * @returns {Promise<Object>} - Resultado del envío
     */
    async sendTestEmail(toEmail) {
        try {
            const result = await this.resend.emails.send({
                from: this.fromEmail,
                to: toEmail,
                subject: 'Prueba - Sistema de Comprobantes',
                html: '<h1>Email de prueba</h1><p>Si recibes este email, el sistema está funcionando correctamente.</p>',
                text: 'Email de prueba - Sistema de Comprobantes'
            });

            return {
                success: true,
                messageId: result.id
            };
        } catch (error) {
            console.error('Error enviando email de prueba:', error);
            throw error;
        }
    }
}

// Exportar instancia singleton
const emailService = new EmailService();

export default emailService;
