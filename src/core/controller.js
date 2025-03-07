/**
 * Controlador principal que coordina todo el sistema
 */
class GoldenAlertsController {
    constructor() {
        this.matchSelector = require('./match-selector');
        this.goldenDetector = require('./golden-detector');
        this.messageGenerator = require('./message-generator');
        this.consoleMessenger = require('../messaging/console-messenger');
        this.alertRepo = require('../data/repositories/alert-repo');

        // Control de monitorizaciones activas
        this.activeMonitoring = new Map();
    }

    // Iniciar el sistema
    async start() {... }

    // Ciclo principal de monitorización
    async monitoringCycle() {... }

    // Procesar partido individual
    async processMatch(matchId) {... }

    // Enviar alertas a usuarios según su plan
    async sendAlerts(goldenMoment) {... }
}