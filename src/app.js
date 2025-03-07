/**
 * Punto de entrada principal de la aplicación
 */
require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const controller = require('./core/controller');
const appConfig = require('./config/app-config');
const apiConfig = require('./config/api-config');
const dbConfig = require('./config/db-config');
const db = require('./db/mongo-client'); // Cambiado para usar el cliente de MongoDB

// Inicializar Express para endpoints de simulación/prueba
const app = express();
const port = appConfig.app.port || 3000;

// Middleware básico
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para logging de peticiones
app.use((req, res, next) => {
    logger.http(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
});

// Rutas básicas para control manual
app.get('/', (req, res) => {
    res.send(`${appConfig.app.name} v${appConfig.app.version} funcionando en entorno ${appConfig.app.environment}`);
});

// Ruta para simulación manual
app.get('/simulate/:matchId', async (req, res) => {
    try {
        const matchId = req.params.matchId;
        const plan = req.query.plan || 'estratega';

        logger.info(`Simulando partido ${matchId} con plan ${plan}`);
        const result = await controller.simulateMatch(matchId, plan);
        res.json(result);
    } catch (error) {
        logger.error(`Error en simulación: ${error.message}`);
        res.status(500).json({ error: 'Error en simulación', message: error.message });
    }
});

// Ruta para ver partidos disponibles
app.get('/matches', async (req, res) => {
    try {
        const matchSelector = require('./core/match-selector');
        const matches = await matchSelector.getAvailableMatches();
        logger.info(`Obtenidos ${matches.length} partidos disponibles`);
        res.json(matches);
    } catch (error) {
        logger.error(`Error obteniendo partidos: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo partidos', message: error.message });
    }
});

// Ruta para estado del sistema
app.get('/status', async (req, res) => {
    try {
        const status = await controller.getSystemStats();
        res.json(status);
    } catch (error) {
        logger.error(`Error obteniendo estado: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo estado', message: error.message });
    }
});

// Iniciar servidor y controlador principal
const startServer = async () => {
    try {
        // Inicializar conexión a la base de datos
        await db.connect();
        logger.info('Conexión a base de datos establecida');

        // Iniciar el controlador principal
        await controller.start();
        logger.info('Controlador principal iniciado correctamente');

        // Iniciar servidor Express
        app.listen(port, () => {
            logger.info(`Servidor iniciado en puerto ${port}`);
            logger.info(`URL base: ${appConfig.app.baseUrl}`);
        });
    } catch (error) {
        logger.error(`Error iniciando la aplicación: ${error.message}`);
        logger.error(error.stack);
        process.exit(1);
    }
};

// Manejo de cierre limpio
process.on('SIGTERM', async () => {
    logger.info('Señal SIGTERM recibida, cerrando aplicación');
    await controller.stop();
    await db.disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('Señal SIGINT recibida, cerrando aplicación');
    await controller.stop();
    await db.disconnect();
    process.exit(0);
});

// Iniciar la aplicación
startServer();