// backend/src/services/receiptService.js
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { promisify } from 'util';
import cloudinary from '../config/cloudinary.js';

/**
 * Servicio de Generación de Comprobantes de Transacción
 * NOTA: Estos NO son facturas fiscales, solo comprobantes internos
 * Para uso mientras AV Finance tramita licencia ASFI
 */

const AV_FINANCE_DATA = {
    razonSocial: 'AV Finance',
    producto: 'Alyto - Transferencias Internacionales',
    nitStatus: 'En trámite',
    direccion: 'Bolivia', // Actualizar con dirección real
    telefono: '+591 XXX XXXXX', // Actualizar
    email: 'soporte@alyto.app',
    website: 'https://alyto.app'
};

/**
 * Genera comprobante PDF para transacciones Bolivia
 * @param {Object} transaction - Transacción de MongoDB
 * @param {Object} user - Usuario de MongoDB
 * @returns {Promise<Buffer>} PDF como buffer
 */
export async function generateTransactionReceipt(transaction, user) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
            const chunks = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // --- HEADER ---
            doc.fontSize(20)
                .font('Helvetica-Bold')
                .text('COMPROBANTE DE TRANSACCIÓN', { align: 'center' });

            doc.fontSize(10)
                .font('Helvetica')
                .fillColor('#666')
                .text('(No constituye factura fiscal)', { align: 'center' });

            doc.moveDown();

            // --- DATOS EMISOR ---
            doc.fontSize(12)
                .fillColor('#000')
                .font('Helvetica-Bold')
                .text('Emitido por:', 50, doc.y);

            doc.font('Helvetica')
                .fontSize(10)
                .text(AV_FINANCE_DATA.razonSocial, 50, doc.y)
                .text(`Producto: ${AV_FINANCE_DATA.producto}`, 50, doc.y)
                .text(`NIT: ${AV_FINANCE_DATA.nitStatus}`, 50, doc.y)
                .text(`Email: ${AV_FINANCE_DATA.email}`, 50, doc.y);

            doc.moveDown();

            // --- LÍNEA SEPARADORA ---
            doc.moveTo(50, doc.y)
                .lineTo(550, doc.y)
                .stroke();

            doc.moveDown();

            // --- DATOS TRANSACCIÓN ---
            const fecha = new Date(transaction.createdAt).toLocaleString('es-BO', {
                dateStyle: 'long',
                timeStyle: 'short'
            });

            doc.fontSize(11)
                .font('Helvetica-Bold')
                .text('DATOS DE LA TRANSACCIÓN', 50, doc.y);

            doc.font('Helvetica')
                .fontSize(10)
                .fillColor('#333');

            const leftCol = 50;
            const rightCol = 300;
            let yPos = doc.y + 10;

            // Columna izquierda
            doc.text('Número de Orden:', leftCol, yPos);
            doc.font('Helvetica-Bold').text(transaction.order, leftCol + 120, yPos);
            yPos += 20;

            doc.font('Helvetica').text('Fecha:', leftCol, yPos);
            doc.font('Helvetica-Bold').text(fecha, leftCol + 120, yPos);
            yPos += 20;

            doc.font('Helvetica').text('Estado:', leftCol, yPos);
            const statusText = transaction.status === 'succeeded' ? 'COMPLETADO ✓' : transaction.status.toUpperCase();
            doc.font('Helvetica-Bold')
                .fillColor(transaction.status === 'succeeded' ? '#28a745' : '#ffc107')
                .text(statusText, leftCol + 120, yPos);
            yPos += 20;

            doc.fillColor('#333');

            // Columna derecha
            yPos = doc.y - 60;
            doc.font('Helvetica').text('Usuario:', rightCol, yPos);
            doc.font('Helvetica-Bold').text(user.name, rightCol + 80, yPos);
            yPos += 20;

            doc.font('Helvetica').text('Email:', rightCol, yPos);
            doc.font('Helvetica-Bold').text(user.email, rightCol + 80, yPos);
            yPos += 20;

            doc.font('Helvetica').text('KYC Nivel:', rightCol, yPos);
            doc.font('Helvetica-Bold').text(user.kyc?.level || '1', rightCol + 80, yPos);

            doc.moveDown(3);

            // --- DETALLES OPERACIÓN ---
            doc.fontSize(11)
                .font('Helvetica-Bold')
                .fillColor('#000')
                .text('DETALLES DE LA OPERACIÓN', 50, doc.y);

            doc.moveDown(0.5);

            // Tabla de detalles
            const tableTop = doc.y;
            const col1 = 50;
            const col2 = 200;
            const col3 = 400;

            // Headers
            doc.fontSize(9)
                .font('Helvetica-Bold')
                .fillColor('#fff')
                .rect(col1, tableTop, 500, 20)
                .fill('#4a90e2');

            doc.fillColor('#fff')
                .text('Concepto', col1 + 5, tableTop + 5)
                .text('Detalle', col2 + 5, tableTop + 5)
                .text('Monto', col3 + 5, tableTop + 5);

            let rowY = tableTop + 25;

            // Rows
            doc.fillColor('#000').font('Helvetica');

            const rows = [
                ['Tipo Operación',
                    transaction.currency === 'BOB' ? 'Depósito (On-Ramp)' : 'Pago a Bolivia (Off-Ramp)',
                    ''],
                ['Moneda Origen', transaction.currency, ''],
                ['Monto', '', `${transaction.amount} ${transaction.currency}`],
                ['País Destino', transaction.country || '-', ''],
                ['Beneficiario', `${transaction.beneficiary_first_name || ''} ${transaction.beneficiary_last_name || ''}`.trim() || '-', '']
            ];

            rows.forEach((row, i) => {
                const bg = i % 2 === 0 ? '#f8f9fa' : '#ffffff';
                doc.rect(col1, rowY, 500, 18).fill(bg);
                doc.fillColor('#000')
                    .text(row[0], col1 + 5, rowY + 3)
                    .text(row[1], col2 + 5, rowY + 3)
                    .text(row[2], col3 + 5, rowY + 3);
                rowY += 18;
            });

            doc.moveDown(2);

            // --- DISCLAIMER ---
            doc.fontSize(8)
                .font('Helvetica-Oblique')
                .fillColor('#666')
                .text('IMPORTANTE:', 50, doc.y, { continued: true })
                .font('Helvetica')
                .text(' Este comprobante es un documento interno de control y NO constituye factura fiscal válida para fines tributarios. AV Finance se encuentra en proceso de obtención de licencia ETF ante ASFI.', { align: 'justify', width: 500 });

            doc.moveDown();

            doc.text('Para consultas: ' + AV_FINANCE_DATA.email, 50, doc.y);

            // --- FOOTER ---
            const footerY = 700;
            doc.fontSize(7)
                .fillColor('#999')
                .text(`Generado el ${new Date().toLocaleString('es-BO')}`, 50, footerY, { align: 'center' })
                .text(`Orden: ${transaction.order}`, { align: 'center' })
                .text('Alyto by AV Finance - Powered by Stellar Blockchain', { align: 'center' });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Sube PDF a Cloudinary y retorna URL pública
 */
export async function uploadReceiptPDF(pdfBuffer, orderId) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: 'raw',
                folder: 'receipts',
                public_id: `receipt-${orderId}`,
                format: 'pdf'
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );

        uploadStream.end(pdfBuffer);
    });
}
