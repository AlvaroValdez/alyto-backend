// src/services/receipt/qrGenerator.js
import QRCode from 'qrcode';

/**
 * Servicio de generación de códigos QR para verificación de comprobantes
 */
class QRGeneratorService {
    /**
     * Generar QR Code en formato Data URL (Base64)
     * @param {String} data - Datos a codificar (normalmente URL de verificación)
     * @param {Object} options - Opciones de generación
     * @returns {Promise<String>} - Data URL del QR Code
     */
    async generateQRCode(data, options = {}) {
        const {
            errorCorrectionLevel = 'M',
            width = 300,
            margin = 2,
            color = {
                dark: '#1e3c72',
                light: '#ffffff'
            }
        } = options;

        try {
            const qrDataURL = await QRCode.toDataURL(data, {
                errorCorrectionLevel,
                width,
                margin,
                color
            });

            return qrDataURL;
        } catch (error) {
            console.error('Error generando QR Code:', error);
            throw new Error(`Error al generar QR Code: ${error.message}`);
        }
    }

    /**
     * Generar QR Code en formato Buffer (PNG)
     * @param {String} data - Datos a codificar
     * @param {Object} options - Opciones de generación
     * @returns {Promise<Buffer>} - Buffer del PNG
     */
    async generateQRBuffer(data, options = {}) {
        const {
            errorCorrectionLevel = 'M',
            width = 300,
            margin = 2,
            color = {
                dark: '#1e3c72',
                light: '#ffffff'
            }
        } = options;

        try {
            const qrBuffer = await QRCode.toBuffer(data, {
                errorCorrectionLevel,
                width,
                margin,
                color
            });

            return qrBuffer;
        } catch (error) {
            console.error('Error generando QR Buffer:', error);
            throw new Error(`Error al generar QR Buffer: ${error.message}`);
        }
    }

    /**
     * Generar URL de verificación para el comprobante
     * @param {String} txHash - Hash de la transacción
     * @param {String} baseUrl - URL base del sistema (ej: https://alyto.app)
     */
    generateVerificationURL(txHash, baseUrl = process.env.PUBLIC_URL || 'https://alyto.app') {
        return `${baseUrl}/verify/${txHash}`;
    }

    /**
     * Generar QR Code de verificación para un comprobante
     * @param {String} txHash - Hash de la transacción
     * @param {String} baseUrl - URL base del sistema
     * @param {Object} options - Opciones de generación del QR
     * @returns {Promise<Object>} - Objeto con URL y QR Code
     */
    async generateVerificationQR(txHash, baseUrl = null, options = {}) {
        const verificationURL = this.generateVerificationURL(txHash, baseUrl);
        const qrCode = await this.generateQRCode(verificationURL, options);

        return {
            url: verificationURL,
            qrCode,
            stellarExplorerUrl: `https://stellar.expert/explorer/public/tx/${txHash}`
        };
    }
}

// Exportar instancia singleton
const qrGenerator = new QRGeneratorService();

export default qrGenerator;
