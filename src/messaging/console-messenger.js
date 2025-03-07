/**
 * Simula envío de mensajes por consola
 */
class ConsoleMessenger {
    constructor() {
        this.colors = require('colors/safe');
    }

    // Simular envío de mensajes con formato
    sendPreAlert(userId, message) {
        console.log(this.colors.yellow('\n====== PRE-ALERTA ======'));
        console.log(message);
        console.log(this.colors.yellow('======================\n'));
    }

    sendMainAlert(userId, message) {
        console.log(this.colors.green('\n====== ALERTA PRINCIPAL ======'));
        console.log(message);
        console.log(this.colors.green('============================\n'));
    }

    sendDetailedAnalysis(userId, message) {
        console.log(this.colors.blue('\n====== ANÁLISIS DETALLADO ======'));
        console.log(message);
        console.log(this.colors.blue('==============================\n'));
    }

    sendFollowUp(userId, message) {
        console.log(this.colors.magenta('\n====== SEGUIMIENTO ======'));
        console.log(message);
        console.log(this.colors.magenta('======================\n'));
    }
}