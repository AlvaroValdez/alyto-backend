# 🔄 Reiniciar Transacciones - Guía de Uso

## Script de Limpieza BD

Ubicación: `backend/src/scripts/resetTransactions.js`

Este script permite limpiar transacciones de la base de datos para empezar testing desde cero.

---

## 🚀 Uso Rápido

```bash
cd backend
node src/scripts/resetTransactions.js
```

---

## 📋 Opciones Disponibles

Edita la variable `OPTION` en el script (línea 40):

### 🗑️ Opción 1: BD Completamente Limpia (Recomendado para testing)
```javascript
const OPTION = 1;
```

**Elimina:**
- ✅ TODAS las transacciones (sin excepción)
- ✅ Historial completo
- ✅ Succeeded, failed, pending, todo

**Usa cuando:**
- Quieres empezar completamente de cero
- Testing de flujo completo desde inicio
- **PERFECTO para testing Bolivia ahora**

---

### 🎯 Opción 2: Mantener Exitosas
```javascript
const OPTION = 2;
```

**Elimina:**
- `pending_verification`
- `pending_manual_payout`
- `pending`
- `failed`

**Mantiene:**
- `succeeded` (transacciones exitosas)

**Usa cuando:**
- Quieres limpiar errores pero mantener historial exitoso
- Testing incremental

---

### 📝 Opción 3: Solo Marcar (No Eliminar)
```javascript
const OPTION = 3;
```

**Acción:**
- Marca como `cancelled` todas las pendientes
- NO elimina ninguna transacción

**Usa cuando:**
- Quieres mantener data para auditoría
- Solo necesitas liberar cola de aprobación

---

## ⚡ Workflow Recomendado (Testing Bolivia)

```bash
# 1. Limpiar BD completamente
cd backend
# Editar resetTransactions.js → OPTION = 1
node src/scripts/resetTransactions.js

# 2. Verificar limpieza
# Debe mostrar: "0 transacciones restantes"

# 3. Reiniciar backend (si está en Render)
# O simplemente continuar si local

# 4. Testing
# - Frontend: crear remesa Bolivia → Colombia
# - Admin: aprobar en /admin/treasury
# - Verificar logs sin errores 422
```

---

## 📊 Salida del Script

```bash
🔄 Conectando a MongoDB...
✅ Conectado a MongoDB

📊 Estado Actual:
  Total: 15
  Pendientes: 3
  Procesando: 1
  Exitosas: 10
  Fallidas: 1

📋 OPCIONES DISPONIBLES:
   1️⃣  Eliminar TODAS (BD limpia)
   ...

🗑️  OPCIÓN 1: Eliminando TODAS las transacciones...
✅ 15 transacciones eliminadas
✅ Base de datos completamente limpia

📊 Total después: 0

✅ Script completado
```

---

## ⚠️ Importante

- **No hay undo:** Una vez eliminadas, no se pueden recuperar
- **Ejecutar en Render:** Si trabajas con DB de producción
- **Testing:** Siempre usa stage/test database

---

## 🎯 Para Testing de Hoy

**Recomendación:** Usa **OPCIÓN 1** para:
- ✅ BD completamente limpia
- ✅ Testing fresco del fix Authorization header
- ✅ Sin confusión con transacciones anteriores

---

Última actualización: 2025-12-18
