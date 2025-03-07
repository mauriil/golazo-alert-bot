/**
 * Configuración de APIs
 * Define parámetros de conexión y límites para las APIs externas
 */

// Determinar entorno
const environment = process.env.NODE_ENV || 'development';

// Configuración base
const apiConfig = {
    // Configuración para Football API
    football: {
        baseUrl: process.env.FOOTBALL_API_URL || 'https://api-football-v1.p.rapidapi.com/v3',
        apiKey: process.env.FOOTBALL_API_KEY,
        apiHost: process.env.FOOTBALL_API_HOST || 'api-football-v1.p.rapidapi.com',
        dailyLimit: parseInt(process.env.FOOTBALL_API_DAILY_LIMIT || '100'), // Límite diario por defecto
        requestTimeout: parseInt(process.env.FOOTBALL_API_TIMEOUT || '10000') // 10 segundos timeout
    },

    // Configuración para Odds API
    odds: {
        baseUrl: process.env.ODDS_API_URL || 'https://api.the-odds-api.com/v4',
        apiKey: process.env.ODDS_API_KEY,
        monthlyLimit: parseInt(process.env.ODDS_API_MONTHLY_LIMIT || '500'), // Límite mensual por defecto
        dailyTarget: parseInt(process.env.ODDS_API_DAILY_TARGET || '16'), // ~16/día para no exceder 500/mes
        requestTimeout: parseInt(process.env.ODDS_API_TIMEOUT || '10000') // 10 segundos timeout
    },

    // Configuración de caché
    cache: {
        defaultTtl: parseInt(process.env.API_CACHE_DEFAULT_TTL || '60'), // 60 segundos por defecto
        checkPeriod: parseInt(process.env.API_CACHE_CHECK_PERIOD || '120') // Revisar caducidad cada 2 minutos
    },

    // Configuración de reintentos
    retry: {
        maxRetries: parseInt(process.env.API_MAX_RETRIES || '3'), // Máximo 3 reintentos
        baseDelay: parseInt(process.env.API_RETRY_DELAY || '1000'), // 1 segundo de espera inicial
        maxDelay: parseInt(process.env.API_MAX_RETRY_DELAY || '5000') // Máximo 5 segundos de espera
    }
};

// Ajustes específicos por entorno
if (environment === 'development') {
    // Configuración para desarrollo
    Object.assign(apiConfig.cache, {
        defaultTtl: 30, // TTL más corto para desarrollo
    });

    Object.assign(apiConfig.retry, {
        maxRetries: 2 // Menos reintentos en desarrollo
    });
} else if (environment === 'production') {
    // Configuración para producción
    Object.assign(apiConfig.cache, {
        defaultTtl: 60, // TTL estándar en producción
    });

    Object.assign(apiConfig.retry, {
        maxRetries: 3, // Reintentos estándar en producción
        baseDelay: 2000 // Mayor espera inicial en producción
    });
} else if (environment === 'test') {
    // Configuración para pruebas
    Object.assign(apiConfig.cache, {
        defaultTtl: 1, // TTL muy corto para pruebas
    });

    Object.assign(apiConfig.retry, {
        maxRetries: 0 // Sin reintentos en pruebas
    });
}

module.exports = apiConfig;