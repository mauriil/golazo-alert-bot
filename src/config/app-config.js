/**
 * Configuración General de la Aplicación
 * Define parámetros globales, ajustes del sistema y configuración de servicios
 */

// Determinar entorno
const environment = process.env.NODE_ENV || 'development';

// Configuración base
const appConfig = {
    // Información básica de la aplicación
    app: {
        name: 'GolazoAlerts',
        version: process.env.APP_VERSION || '0.1.0',
        environment,
        port: parseInt(process.env.PORT || '3000'),
        host: process.env.HOST || 'localhost',
        baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`
    },

    // Configuración del sistema de alertas
    alerts: {
        monitoringCycle: parseInt(process.env.MONITORING_CYCLE || '300000'), // 5 minutos por defecto
        maxAlertsPerDay: parseInt(process.env.MAX_ALERTS_PER_DAY || '20'), // Límite de alertas por día
        minimumConfidence: parseFloat(process.env.MINIMUM_CONFIDENCE || '0.65'), // Confianza mínima para alertas
        minimumExpectedValue: parseFloat(process.env.MINIMUM_EV || '0.1'), // Valor esperado mínimo (10%)
        enabledMarkets: (process.env.ENABLED_MARKETS || 'nextGoal,over05,over15,over25,btts,cornerNext10Min').split(','),
        defaultTTL: parseInt(process.env.ALERT_TTL || '3600') // TTL de alertas (1 hora)
    },

    // Configuración de planes de usuario
    plans: {
        free: {
            maxMatches: parseInt(process.env.FREE_PLAN_MAX_MATCHES || '3'),
            alertDelay: parseInt(process.env.FREE_PLAN_DELAY || '60000'), // 60 segundos de retraso
            confidenceThreshold: parseFloat(process.env.FREE_PLAN_CONFIDENCE || '0.85') // Solo alertas muy confiables
        },
        insider: {
            maxMatches: parseInt(process.env.INSIDER_PLAN_MAX_MATCHES || '8'),
            alertDelay: parseInt(process.env.INSIDER_PLAN_DELAY || '30000'), // 30 segundos de retraso
            confidenceThreshold: parseFloat(process.env.INSIDER_PLAN_CONFIDENCE || '0.75')
        },
        estratega: {
            maxMatches: parseInt(process.env.ESTRATEGA_PLAN_MAX_MATCHES || '15'),
            alertDelay: parseInt(process.env.ESTRATEGA_PLAN_DELAY || '0'), // Sin retraso
            confidenceThreshold: parseFloat(process.env.ESTRATEGA_PLAN_CONFIDENCE || '0.65')
        }
    },

    // Configuración de WhatsApp
    whatsapp: {
        enabled: process.env.ENABLE_WHATSAPP === 'true',
        baseUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com',
        version: process.env.WHATSAPP_API_VERSION || 'v17.0',
        phoneNumberId: process.env.WHATSAPP_PHONE_ID,
        token: process.env.WHATSAPP_TOKEN,
        testMode: process.env.WHATSAPP_TEST_MODE === 'true',
        testRecipient: process.env.WHATSAPP_TEST_RECIPIENT
    },

    // Configuración de Machine Learning
    ml: {
        enabled: process.env.ENABLE_ML !== 'false', // Habilitado por defecto
        modelsPath: process.env.ML_MODELS_PATH || './models',
        confidenceWeight: parseFloat(process.env.ML_CONFIDENCE_WEIGHT || '0.7'), // Peso de ML vs reglas
        rulesWeight: parseFloat(process.env.RULES_CONFIDENCE_WEIGHT || '0.3'), // Peso de reglas vs ML
        // Lista de modelos disponibles
        models: ['nextGoal', 'over05', 'over15', 'over25', 'btts', 'cornerNext10Min', 'potential']
    },

    // Configuración de partidos a monitorear
    matches: {
        // Ligas prioritarias (valores de 0-10)
        leaguePriorities: {
            'Argentina Primera División': 10,
            'Copa Libertadores': 9,
            'Copa Sudamericana': 8,
            'UEFA Champions League': 8,
            'Premier League': 7,
            'La Liga': 7,
            'Serie A': 6,
            'Bundesliga': 6,
            'Ligue 1': 5
        },
        // Equipos prioritarios (valores de 0-10)
        teamPriorities: {
            'River Plate': 10,
            'Boca Juniors': 10,
            'Independiente': 8,
            'Racing Club': 8,
            'San Lorenzo': 8,
            'Barcelona': 7,
            'Real Madrid': 7,
            'Manchester United': 6,
            'Liverpool': 6,
            'Bayern Munich': 6
        },
        // Peso de factores de selección (suma debe ser 1)
        selectionWeights: {
            relevance: parseFloat(process.env.RELEVANCE_WEIGHT || '0.7'), // Peso de relevancia cultural
            potential: parseFloat(process.env.POTENTIAL_WEIGHT || '0.3')  // Peso de potencial de oportunidades
        }
    },

    // Configuración de seguridad
    security: {
        jwtSecret: process.env.JWT_SECRET || 'golazo-secret-key-dev',
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10'),
        rateLimiting: {
            enabled: process.env.ENABLE_RATE_LIMIT !== 'false',
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'), // 1 minuto
            max: parseInt(process.env.RATE_LIMIT_MAX || '60') // 60 peticiones por minuto
        }
    }
};

// Ajustes específicos por entorno
if (environment === 'development') {
    // Configuración para desarrollo
    Object.assign(appConfig.alerts, {
        monitoringCycle: 60000, // Ciclo más corto en desarrollo (1 minuto)
        minimumConfidence: 0.5  // Umbral de confianza más bajo para probar
    });

    // WhatsApp deshabilitado por defecto en desarrollo
    if (!process.env.ENABLE_WHATSAPP) {
        appConfig.whatsapp.enabled = false;
    }
} else if (environment === 'production') {
    // Configuración para producción
    Object.assign(appConfig.security, {
        jwtExpiresIn: '30d', // Tokens más duraderos en producción
        bcryptRounds: 12     // Más rondas de hash en producción
    });

    // Requerir secreto JWT seguro en producción
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'golazo-secret-key-dev') {
        console.warn('ADVERTENCIA: JWT_SECRET no configurado o inseguro en producción.');
    }
} else if (environment === 'test') {
    // Configuración para pruebas
    Object.assign(appConfig.alerts, {
        monitoringCycle: 10000, // Ciclo muy corto para pruebas (10 segundos)
        maxAlertsPerDay: 1000   // Límite alto para no interferir con pruebas
    });

    // Seguridad reducida para pruebas
    Object.assign(appConfig.security, {
        bcryptRounds: 1,        // Mínimas rondas para velocidad
        jwtExpiresIn: '1h'      // Corta duración
    });

    // WhatsApp siempre deshabilitado en pruebas
    appConfig.whatsapp.enabled = false;
}

// Verificar consistencia de configuración
const relevanceWeight = appConfig.matches.selectionWeights.relevance;
const potentialWeight = appConfig.matches.selectionWeights.potential;

// Asegurar que los pesos sumen 1
if (Math.abs(relevanceWeight + potentialWeight - 1) > 0.001) {
    console.warn('ADVERTENCIA: Los pesos de selección de partidos no suman 1. Ajustando automáticamente.');
    // Normalizar pesos
    const sum = relevanceWeight + potentialWeight;
    appConfig.matches.selectionWeights.relevance = relevanceWeight / sum;
    appConfig.matches.selectionWeights.potential = potentialWeight / sum;
}

module.exports = appConfig;