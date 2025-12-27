/**
 * Catálogo maestro de países soportados para remesas
 * 
 * Modos:
 * - 'vita_wallet': Países que usan API directa de Vita Wallet para pay-ins y payouts
 * - 'manual_anchor': Países con procesamiento manual (ej: Bolivia) que se convertirán en anchors oficiales
 * 
 * Preparado para expansión futura (ej: AlfredPay)
 */
export const SUPPORTED_ORIGINS = [
    // Países con soporte Vita Wallet (API directa)
    { code: 'CL', name: 'Chile', currency: 'CLP', mode: 'vita_wallet' },
    { code: 'CO', name: 'Colombia', currency: 'COP', mode: 'vita_wallet' },
    { code: 'AR', name: 'Argentina', currency: 'ARS', mode: 'vita_wallet' },
    { code: 'MX', name: 'México', currency: 'MXN', mode: 'vita_wallet' },
    { code: 'BR', name: 'Brasil', currency: 'BRL', mode: 'vita_wallet' },
    { code: 'PE', name: 'Perú', currency: 'PEN', mode: 'vita_wallet' },

    // Bolivia - Anchor Manual (emisor y receptor)
    // Se convertirá en anchor oficial posteriormente
    { code: 'BO', name: 'Bolivia', currency: 'BOB', mode: 'manual_anchor' },
];