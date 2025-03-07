/**
 * Controller principal del sistema GolazoAlerts
 * Coordina todo el flujo del sistema, desde la selección de partidos hasta
 * la generación y envío de alertas
 */
const matchSelector = require('./match-selector');
const goldenDetector = require('./golden-detector');
const messageGenerator = require('./message-generator');
const logger = require('../utils/logger');
const matchRepo = require('../db/repositories/match-repo');
const alertRepo = require('../db/repositories/alert-repo');
const userService = require('../services/user-service');

// Importamos mensajeros según configuración
const consoleMessenger = require('../messaging/console-messenger');
let whatsappSender;
try {
    whatsappSender = require('../messaging/whatsapp/whatsapp-sender');
} catch (error) {
    logger.warn('WhatsApp Sender no disponible. Usando solo consola para mensajes.');
}

class GoldenAlertsController {
    constructor() {
        // Inicialización del estado del controlador
        this.isRunning = false;
        this.activeMonitoring = new Map();
        this.monitoringInterval = null;
        this.config = {
            cycleInterval: process.env.MONITORING_CYCLE_INTERVAL || 5 * 60 * 1000, // 5 minutos por defecto
            enableWhatsapp: process.env.ENABLE_WHATSAPP === 'true',
            developmentMode: process.env.NODE_ENV === 'development'
        };

        // Planes de usuario y retrasos de mensajes asociados (en ms)
        this.planDelays = {
            free: 60000,      // 60 segundos (reciben alertas después)
            insider: 30000,   // 30 segundos 
            estratega: 0      // Inmediato (premium)
        };
    }

    /**
     * Iniciar el sistema completo
     */
    async start() {
        try {
            if (this.isRunning) {
                logger.warn('El sistema ya está en ejecución');
                return false;
            }

            logger.info('Iniciando sistema GolazoAlerts...');

            // Inicializar repositorios
            await matchRepo.initialize();
            await alertRepo.initialize();

            // Iniciar ciclo de monitoreo
            this.isRunning = true;
            await this.runMonitoringCycle();

            // Configurar intervalo para ciclos recurrentes
            this.monitoringInterval = setInterval(
                () => this.runMonitoringCycle(),
                this.config.cycleInterval
            );

            logger.info(`Sistema iniciado correctamente. Intervalo de monitoreo: ${this.config.cycleInterval / 1000} segundos`);
            return true;
        } catch (error) {
            logger.error(`Error al iniciar el sistema: ${error.message}`);
            this.stop();
            return false;
        }
    }

    /**
     * Detener el sistema
     */
    stop() {
        if (!this.isRunning) {
            logger.warn('El sistema ya está detenido');
            return false;
        }

        logger.info('Deteniendo sistema GolazoAlerts...');

        // Limpiar intervalo
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        // Limpiar monitoreo activo
        this.activeMonitoring.clear();
        this.isRunning = false;

        logger.info('Sistema detenido correctamente');
        return true;
    }

    /**
     * Ejecutar un ciclo completo de monitoreo
     * Este es el corazón del sistema que se ejecuta periódicamente
     */
    async runMonitoringCycle() {
        logger.info('Iniciando ciclo de monitoreo...');

        try {
            // 1. Seleccionar partidos para todos los planes
            const matchesToMonitor = await matchSelector.selectMatchesToMonitor('estratega');
            logger.info(`Seleccionados ${matchesToMonitor.length} partidos para monitoreo`);

            // 2. Actualizar lista de monitoreo
            this.updateActiveMonitoring(matchesToMonitor);

            // 3. Procesar cada partido activo
            const monitoringPromises = [];
            for (const [matchId, monitoring] of this.activeMonitoring.entries()) {
                monitoringPromises.push(this.processMatch(matchId, monitoring));
            }

            // Esperar a que terminen todos los procesos (con límite de tiempo)
            await Promise.all(monitoringPromises);

            logger.info('Ciclo de monitoreo completado');
        } catch (error) {
            logger.error(`Error en ciclo de monitoreo: ${error.message}`);
        }
    }

    /**
     * Actualizar lista de partidos en monitoreo
     * @param {Array} newMatches - Nuevos partidos a monitorear
     */
    updateActiveMonitoring(newMatches) {
        // Añadir nuevos partidos
        for (const match of newMatches) {
            if (!this.activeMonitoring.has(match.id)) {
                this.activeMonitoring.set(match.id, {
                    match: match,
                    lastCheck: 0,
                    sentAlerts: new Map(),
                    priority: match.scores.final || 5 // Prioridad inicial
                });

                // Registrar partido como monitoreado en BD
                matchRepo.setMatchMonitored(match.id, true)
                    .catch(err => logger.error(`Error al marcar partido ${match.id} como monitoreado: ${err.message}`));
            }
        }

        // Eliminar partidos que ya no están en la lista y no son activos
        const idsToKeep = new Set(newMatches.map(m => m.id));

        for (const [matchId, monitoring] of this.activeMonitoring.entries()) {
            const match = monitoring.match;
            const isActive = match.fixture && ['1H', '2H', 'HT'].includes(match.fixture.status?.short);

            if (!isActive && !idsToKeep.has(matchId)) {
                logger.info(`Eliminando partido ${matchId} del monitoreo`);
                this.activeMonitoring.delete(matchId);

                // Actualizar estado en BD
                matchRepo.setMatchMonitored(matchId, false)
                    .catch(err => logger.error(`Error al desmarcar partido ${matchId}: ${err.message}`));
            }
        }
    }

    /**
     * Procesar un partido específico
     * @param {string} matchId - ID del partido
     * @param {Object} monitoring - Objeto de monitoreo
     */
    async processMatch(matchId, monitoring) {
        try {
            // Verificar si es momento de analizar este partido según prioridad
            const currentTime = Date.now();
            const updateInterval = this.getUpdateIntervalByPriority(monitoring.priority);

            if (currentTime - monitoring.lastCheck < updateInterval) {
                return; // No es momento de verificar aún
            }

            // Actualizar timestamp de última verificación
            monitoring.lastCheck = currentTime;

            // Detectar momentos dorados para cada plan de usuario
            await this.checkGoldenMomentsForAllPlans(matchId, monitoring);

        } catch (error) {
            logger.error(`Error procesando partido ${matchId}: ${error.message}`);
        }
    }

    /**
     * Verificar momentos dorados para todos los planes de usuario
     * @param {string} matchId - ID del partido
     * @param {Object} monitoring - Objeto de monitoreo
     */
    async checkGoldenMomentsForAllPlans(matchId, monitoring) {
        // Planes en orden de exclusividad (estratega primero)
        const plans = ['estratega', 'insider', 'free'];

        // Buscar momentos dorados para cada plan
        for (const plan of plans) {
            const goldenMoment = await goldenDetector.detectGoldenMoment(matchId, plan);

            if (goldenMoment) {
                // Verificar si ya enviamos una alerta similar recientemente
                const alertKey = `${goldenMoment.market}_${plan}`;

                if (this.isRecentlyAlerted(monitoring, alertKey)) {
                    logger.info(`Alerta ${alertKey} para partido ${matchId} ya fue enviada recientemente`);
                    continue;
                }

                // Generar y enviar alerta
                await this.generateAndSendAlert(goldenMoment, plan, monitoring);

                // Registrar envío en monitoreo local
                monitoring.sentAlerts.set(alertKey, Date.now());
            }
        }
    }

    /**
     * Comprobar si ya se ha enviado una alerta similar recientemente
     * @param {Object} monitoring - Objeto de monitoreo
     * @param {string} alertKey - Clave única de alerta
     * @returns {boolean} - true si se ha enviado recientemente
     */
    isRecentlyAlerted(monitoring, alertKey) {
        const lastAlertTime = monitoring.sentAlerts.get(alertKey);

        if (!lastAlertTime) return false;

        // Considerar como reciente si se envió en los últimos 15 minutos
        const timeSinceLastAlert = Date.now() - lastAlertTime;
        return timeSinceLastAlert < 15 * 60 * 1000; // 15 minutos
    }

    /**
     * Generar y enviar alerta a usuarios
     * @param {Object} goldenMoment - Momento dorado detectado
     * @param {string} plan - Plan de usuario
     * @param {Object} monitoring - Objeto de monitoreo
     */
    async generateAndSendAlert(goldenMoment, plan, monitoring) {
        try {
            // 1. Guardar alerta en la base de datos
            const savedAlert = await alertRepo.saveAlert(goldenMoment, plan);
            logger.info(`Alerta guardada con ID: ${savedAlert.id}`);

            // 2. Generar mensajes para este plan
            const messages = messageGenerator.formatGoldenMoment(goldenMoment, plan);

            // 3. Obtener usuarios que deben recibir la alerta
            const users = await userService.getUsersByPlan(plan);
            logger.info(`Enviando alerta a ${users.length} usuarios del plan ${plan}`);

            // 4. Registrar alerta en el partido
            await matchRepo.registerAlertSent(goldenMoment.matchId, goldenMoment.market, plan);

            // 5. Enviar pre-alerta a todos los usuarios del plan o superiores
            for (const user of users) {
                // Si estamos en modo desarrollo, simular por consola
                if (this.config.developmentMode) {
                    this.simulateAlert(messages, plan, user.id);
                    continue;
                }

                // Aplicar retraso según plan del usuario
                const delay = this.planDelays[plan] || 0;

                // Programar envío con retraso
                setTimeout(() => {
                    this.sendAlertMessages(user.id, messages, savedAlert.id);
                }, delay);
            }

            return true;
        } catch (error) {
            logger.error(`Error enviando alerta: ${error.message}`);
            return false;
        }
    }

    /**
     * Enviar mensajes de alerta a un usuario
     * @param {string} userId - ID del usuario
     * @param {Object} messages - Mensajes formateados
     * @param {string} alertId - ID de la alerta guardada
     */
    async sendAlertMessages(userId, messages, alertId) {
        try {
            // Determinar qué mensajero usar
            const messenger = this.config.enableWhatsapp && whatsappSender
                ? whatsappSender
                : consoleMessenger;

            // Enviar pre-alerta
            await messenger.sendPreAlert(userId, messages.preAlert);

            // Enviar alerta principal después de un pequeño retraso
            setTimeout(async () => {
                await messenger.sendMainAlert(userId, messages.mainAlert);

                // Registrar envío en la base de datos
                await alertRepo.registerAlertSent(alertId, userId);
            }, 3000);

        } catch (error) {
            logger.error(`Error enviando mensajes a usuario ${userId}: ${error.message}`);
        }
    }

    /**
     * Simular envío de alerta en consola (modo desarrollo)
     * @param {Object} messages - Mensajes formateados
     * @param {string} plan - Plan de usuario
     * @param {string} userId - ID del usuario
     */
    simulateAlert(messages, plan, userId) {
        console.log(`\n[SIMULACIÓN WHATSAPP - PLAN ${plan.toUpperCase()} - USUARIO ${userId}]`);
        console.log(messages.preAlert);

        setTimeout(() => {
            console.log(`\n[SIMULACIÓN WHATSAPP - PLAN ${plan.toUpperCase()} - USUARIO ${userId}]`);
            console.log(messages.mainAlert);

            // Simular respuesta de usuario solicitando análisis
            if (plan !== 'free' && Math.random() > 0.5) {
                setTimeout(() => {
                    console.log(`\n[USUARIO ${userId} SOLICITA]: Ver análisis detallado`);
                    console.log(`\n[SIMULACIÓN WHATSAPP - RESPUESTA]`);
                    console.log(messages.detailedAnalysis);
                }, 5000);
            }
        }, 3000);
    }

    /**
     * Obtener intervalo de actualización según prioridad
     * @param {number} priority - Prioridad del partido (1-10)
     * @returns {number} - Intervalo en milisegundos
     */
    getUpdateIntervalByPriority(priority) {
        // Intervalo base de 5 minutos
        const baseInterval = 5 * 60 * 1000;

        if (priority >= 9) return 30 * 1000;       // 30 segundos (crítico)
        if (priority >= 7) return 60 * 1000;       // 1 minuto (alta prioridad)
        if (priority >= 5) return 2 * 60 * 1000;   // 2 minutos (media prioridad)
        return baseInterval;                       // 5 minutos (baja prioridad)
    }

    /**
     * Simular análisis específico de un partido 
     * (útil para pruebas y desarrollo)
     * @param {string} matchId - ID del partido
     * @param {string} userPlan - Plan de usuario
     */
    async simulateMatch(matchId, userPlan = 'estratega') {
        logger.info(`Simulando análisis para partido ${matchId} con plan ${userPlan}`);

        try {
            // Analizar el partido directamente
            const goldenMoment = await goldenDetector.detectGoldenMoment(matchId, userPlan);

            if (goldenMoment) {
                // Generar mensajes
                const messages = messageGenerator.formatGoldenMoment(goldenMoment, userPlan);

                // Simular entrega
                console.log(`\n[SIMULACIÓN FORZADA - PLAN ${userPlan.toUpperCase()}]`);
                console.log(messages.preAlert);

                setTimeout(() => {
                    console.log(`\n[SIMULACIÓN FORZADA - PLAN ${userPlan.toUpperCase()}]`);
                    console.log(messages.mainAlert);

                    // Mostrar también análisis detallado
                    setTimeout(() => {
                        console.log(`\n[SIMULACIÓN FORZADA - ANÁLISIS DETALLADO]`);
                        console.log(messages.detailedAnalysis);
                    }, 3000);
                }, 2000);

                return {
                    success: true,
                    message: 'Momento dorado detectado y simulado en consola',
                    data: goldenMoment
                };
            } else {
                return {
                    success: false,
                    message: 'No se encontraron momentos dorados para este partido'
                };
            }
        } catch (error) {
            logger.error(`Error en simulación: ${error.message}`);
            return {
                success: false,
                message: `Error: ${error.message}`
            };
        }
    }

    /**
     * Obtener estadísticas del sistema
     * @returns {Object} - Estadísticas
     */
    async getSystemStats() {
        return {
            isRunning: this.isRunning,
            activeMonitoring: this.activeMonitoring.size,
            lastCycleTime: new Date(Date.now() - (Date.now() % this.config.cycleInterval)),
            nextCycleTime: new Date(Date.now() + (this.config.cycleInterval - (Date.now() % this.config.cycleInterval))),
            alertsGenerated: await alertRepo.getTotalAlerts(),
            alertsToday: await alertRepo.getAlertsToday(),
            successRate: await alertRepo.getSuccessRate()
        };
    }
}

module.exports = new GoldenAlertsController()