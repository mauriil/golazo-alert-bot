/**
 * Sistema de Logging
 * Proporciona funcionalidades de registro configurables
 * para depuración, monitoreo y análisis de eventos
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Crear directorio de logs si no existe
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Configuración desde entorno
const environment = process.env.NODE_ENV || 'development';
const logLevel = process.env.LOG_LEVEL || (environment === 'production' ? 'info' : 'debug');
const enableConsole = process.env.LOG_CONSOLE !== 'false';
const enableFile = process.env.LOG_FILE !== 'false';

// Formato personalizado para logs
const customFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
        // Formatear mensaje base
        let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;

        // Añadir stack trace si existe
        if (stack) {
            logMessage += `\n${stack}`;
        }

        // Añadir metadatos si existen
        if (Object.keys(meta).length > 0) {
            logMessage += `\n${JSON.stringify(meta, null, 2)}`;
        }

        return logMessage;
    })
);

// Formato para console (con colores)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    customFormat
);

// Array de transportes
const transports = [];

// Añadir transporte de consola si está habilitado
if (enableConsole) {
    transports.push(
        new winston.transports.Console({
            format: consoleFormat,
            level: logLevel
        })
    );
}

// Añadir transporte de archivo si está habilitado
if (enableFile) {
    // Log general
    transports.push(
        new winston.transports.File({
            filename: path.join(logDir, 'golazo-alerts.log'),
            format: customFormat,
            level: logLevel,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        })
    );

    // Log específico para errores
    transports.push(
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            format: customFormat,
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        })
    );
}

// Crear logger
const logger = winston.createLogger({
    level: logLevel,
    levels: winston.config.npm.levels,
    transports,
    exitOnError: false
});

/**
 * Formato para objetos complejos
 * @param {any} obj - Objeto a formatear
 * @returns {string} - Objeto formateado como string
 */
function formatObject(obj) {
    if (typeof obj === 'string') return obj;
    try {
        return JSON.stringify(obj, null, 2);
    } catch (error) {
        return obj.toString();
    }
}

// Wrapper con funcionalidades adicionales
const enhancedLogger = {
    /**
     * Log de nivel error
     * @param {string} message - Mensaje principal
     * @param {...any} args - Argumentos adicionales
     */
    error: (message, ...args) => {
        logger.error(message, ...args);
    },

    /**
     * Log de nivel warn
     * @param {string} message - Mensaje principal
     * @param {...any} args - Argumentos adicionales
     */
    warn: (message, ...args) => {
        logger.warn(message, ...args);
    },

    /**
     * Log de nivel info
     * @param {string} message - Mensaje principal
     * @param {...any} args - Argumentos adicionales
     */
    info: (message, ...args) => {
        logger.info(message, ...args);
    },

    /**
     * Log de nivel http
     * @param {string} message - Mensaje principal
     * @param {...any} args - Argumentos adicionales
     */
    http: (message, ...args) => {
        logger.http(message, ...args);
    },

    /**
     * Log de nivel debug
     * @param {string} message - Mensaje principal
     * @param {...any} args - Argumentos adicionales
     */
    debug: (message, ...args) => {
        logger.debug(message, ...args);
    },

    /**
     * Log de nivel verbose
     * @param {string} message - Mensaje principal
     * @param {...any} args - Argumentos adicionales
     */
    verbose: (message, ...args) => {
        logger.verbose(message, ...args);
    },

    /**
     * Log de nivel silly
     * @param {string} message - Mensaje principal
     * @param {...any} args - Argumentos adicionales
     */
    silly: (message, ...args) => {
        logger.silly(message, ...args);
    },

    /**
     * Log con tiempo de ejecución
     * @param {string} operation - Nombre de la operación
     * @param {Function} fn - Función a ejecutar y medir
     * @returns {Promise<any>} - Resultado de la función
     */
    async time(operation, fn) {
        const start = Date.now();
        try {
            const result = await fn();
            const duration = Date.now() - start;
            logger.debug(`${operation} completado en ${duration}ms`);
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            logger.error(`${operation} falló después de ${duration}ms: ${error.message}`);
            throw error;
        }
    },

    /**
     * Registra errores de API
     * @param {Error} error - Error a registrar
     * @param {string} operation - Operación que causó el error
     */
    apiError(error, operation = 'API request') {
        if (error.response) {
            // Error con respuesta del servidor
            logger.error(`${operation} falló: ${error.message}`, {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
        } else if (error.request) {
            // Error sin respuesta
            logger.error(`${operation} no recibió respuesta: ${error.message}`, {
                request: {
                    method: error.request.method,
                    url: error.request.url
                }
            });
        } else {
            // Error en configuración
            logger.error(`${operation} falló antes de enviar: ${error.message}`);
        }
    },

    /**
     * Registrar evento de negocio
     * @param {string} type - Tipo de evento
     * @param {Object} data - Datos del evento
     */
    business(type, data = {}) {
        logger.info(`[BUSINESS] ${type}`, { eventType: type, ...data });
    },

    /**
     * Registrar acción de usuario
     * @param {string} userId - ID del usuario
     * @param {string} action - Acción realizada
     * @param {Object} data - Datos adicionales
     */
    user(userId, action, data = {}) {
        logger.info(`[USER] ${userId} - ${action}`, { userId, action, ...data });
    },

    /**
     * Registrar evento del sistema
     * @param {string} component - Componente del sistema
     * @param {string} event - Evento ocurrido
     * @param {Object} data - Datos adicionales
     */
    system(component, event, data = {}) {
        logger.info(`[SYSTEM] ${component} - ${event}`, { component, event, ...data });
    },

    /**
     * Crear un child logger con contexto adicional
     * @param {Object} context - Contexto a añadir a todos los logs
     * @returns {Object} - Logger con contexto
     */
    child(context = {}) {
        const childLogger = logger.child(context);

        // Crear wrapper para el child logger
        return {
            error: (message, ...args) => childLogger.error(message, ...args),
            warn: (message, ...args) => childLogger.warn(message, ...args),
            info: (message, ...args) => childLogger.info(message, ...args),
            http: (message, ...args) => childLogger.http(message, ...args),
            debug: (message, ...args) => childLogger.debug(message, ...args),
            verbose: (message, ...args) => childLogger.verbose(message, ...args),
            silly: (message, ...args) => childLogger.silly(message, ...args)
        };
    },

    /**
     * Configurar nivel de log en runtime
     * @param {string} level - Nivel de log a establecer
     */
    setLevel(level) {
        logger.level = level;
        logger.transports.forEach(transport => {
            transport.level = level;
        });
        logger.info(`Nivel de log cambiado a: ${level}`);
    },

    /**
     * Añadir transporte personalizado
     * @param {Object} transport - Transporte de Winston
     */
    addTransport(transport) {
        logger.add(transport);
    }
};

// Exponer también el logger original de winston
enhancedLogger.winston = logger;

module.exports = enhancedLogger;