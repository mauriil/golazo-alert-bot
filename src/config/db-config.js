/**
 * Configuración de Base de Datos
 * Define parámetros de conexión y opciones para MongoDB y almacenamiento local
 */

// Determinar entorno
const environment = process.env.NODE_ENV || 'development';

// Configuración base
const dbConfig = {
    // Configuración de MongoDB
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/golazo-alerts',
        options: {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000, // 5 segundos timeout para selección de servidor
            socketTimeoutMS: 45000, // 45 segundos timeout para socket
            heartbeatFrequencyMS: 10000, // Frecuencia de latido del monitor de servidor
            maxPoolSize: 10, // Tamaño máximo del pool de conexiones
            minPoolSize: 1, // Tamaño mínimo del pool de conexiones
            connectTimeoutMS: 10000 // 10 segundos timeout para conexión
        },
        collections: {
            matches: 'matches',
            teams: 'teams',
            alerts: 'alerts',
            users: 'users',
            stats: 'stats'
        }
    },

    // Configuración de almacenamiento local (fallback o desarrollo)
    localStorage: {
        enabled: process.env.ENABLE_LOCAL_STORAGE === 'true' || environment !== 'production',
        path: process.env.LOCAL_STORAGE_PATH || './local-storage',
        files: {
            matches: 'matches.json',
            teams: 'teams.json',
            alerts: 'alerts.json',
            users: 'users.json',
            h2h: 'h2h.json'
        }
    },

    // Configuración de indexación y caché
    indexing: {
        ensureIndexes: true, // Crear índices automáticamente
        indexTimeout: 60000, // 60 segundos timeout para creación de índices
    },

    // Configuración de respaldo
    backup: {
        enabled: process.env.ENABLE_DB_BACKUP === 'true' || false,
        frequency: parseInt(process.env.DB_BACKUP_FREQUENCY || '86400000'), // 24 horas por defecto
        path: process.env.DB_BACKUP_PATH || './backups',
        maxBackups: parseInt(process.env.DB_MAX_BACKUPS || '7') // Mantener 7 backups como máximo
    }
};

// Ajustes específicos por entorno
if (environment === 'development') {
    // Configuración para desarrollo
    Object.assign(dbConfig.mongodb, {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/golazo-alerts-dev'
    });

    Object.assign(dbConfig.mongodb.options, {
        maxPoolSize: 5 // Menos conexiones en desarrollo
    });

    // Habilitar almacenamiento local en desarrollo
    dbConfig.localStorage.enabled = true;
} else if (environment === 'production') {
    // Configuración para producción

    // Requerir URI de MongoDB en producción
    if (!process.env.MONGODB_URI) {
        console.warn('ADVERTENCIA: No se ha definido MONGODB_URI en producción. Usando valor por defecto.');
    }

    Object.assign(dbConfig.mongodb.options, {
        maxPoolSize: 20, // Más conexiones en producción
        readPreference: 'secondaryPreferred' // Preferir lecturas de secundarios en producción
    });

    // Deshabilitar almacenamiento local en producción a menos que se indique lo contrario
    dbConfig.localStorage.enabled = process.env.ENABLE_LOCAL_STORAGE === 'true';
} else if (environment === 'test') {
    // Configuración para pruebas
    Object.assign(dbConfig.mongodb, {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/golazo-alerts-test'
    });

    Object.assign(dbConfig.mongodb.options, {
        maxPoolSize: 2, // Mínimas conexiones en pruebas
        serverSelectionTimeoutMS: 2000 // Timeout más corto en pruebas
    });

    // Habilitar almacenamiento local en pruebas
    dbConfig.localStorage.enabled = true;
    dbConfig.localStorage.path = './test/data';
}

module.exports = dbConfig;