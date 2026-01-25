// src/services/receipt/pdfGenerator.js
import puppeteer from 'puppeteer';
import { generateReceiptHTML } from '../../templates/receiptTemplate.js';

/**
 * Servicio de generación de PDF para comprobantes oficiales
 */
class PDFGeneratorService {
    constructor() {
        this.browser = null;
    }

    /**
     * Inicializar navegador Puppeteer (reutilizable para múltiples PDFs)
     */
    async initBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            });
        }
        return this.browser;
    }

    /**
     * Cerrar navegador
     */
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    /**
     * Generar PDF del comprobante
     * @param {Object} receiptData - Datos del comprobante
     * @param {Object} options - Opciones de generación
     * @returns {Promise<Buffer>} - Buffer del PDF generado
     */
    async generatePDF(receiptData, options = {}) {
        const {
            format = 'A4',
            printBackground = true,
            margin = {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            },
            timeout = 30000
        } = options;

        let page = null;

        try {
            // Inicializar navegador
            const browser = await this.initBrowser();

            // Crear nueva página
            page = await browser.newPage();

            // Configurar viewport
            await page.setViewport({
                width: 1200,
                height: 1600,
                deviceScaleFactor: 2
            });

            // Generar HTML
            const html = generateReceiptHTML(receiptData);

            // Cargar HTML en la página
            await page.setContent(html, {
                waitUntil: ['networkidle0', 'domcontentloaded'],
                timeout
            });

            // Esperar a que todo se renderice
            await page.evaluateHandle('document.fonts.ready');

            // Generar PDF
            const pdfBuffer = await page.pdf({
                format,
                printBackground,
                margin,
                preferCSSPageSize: false
            });

            return pdfBuffer;

        } catch (error) {
            console.error('Error generando PDF:', error);
            throw new Error(`Error al generar PDF: ${error.message}`);
        } finally {
            // Cerrar página
            if (page) {
                await page.close();
            }
        }
    }

    /**
     * Generar PDF y guardarlo en archivo (para testing)
     * @param {Object} receiptData - Datos del comprobante
     * @param {String} outputPath - Ruta de salida del archivo
     * @returns {Promise<String>} - Path del archivo generado
     */
    async generatePDFToFile(receiptData, outputPath) {
        const pdfBuffer = await this.generatePDF(receiptData);

        const fs = await import('fs/promises');
        await fs.writeFile(outputPath, pdfBuffer);

        return outputPath;
    }

    /**
     * Generar HTML del comprobante (sin PDF, útil para preview)
     * @param {Object} receiptData - Datos del comprobante
     * @returns {String} - HTML generado
     */
    generateHTML(receiptData) {
        return generateReceiptHTML(receiptData);
    }
}

// Exportar instancia singleton
const pdfGenerator = new PDFGeneratorService();

export default pdfGenerator;
