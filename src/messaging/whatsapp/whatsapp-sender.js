/**
 * Servicio de envío de mensajes por WhatsApp
 * Implementa la lógica de negocio para enviar alertas
 */
const whatsappClient = require('./whatsapp-client');
const whatsappFormatter = require('./whatsapp-formatter');
const logger = require('../../utils/logger');
const userService = require('../../services/user-service');

class WhatsAppSender {
    constructor() {
        this.isEnabled = process.env.ENABLE_WHATSAPP === 'true';
        this.isTestMode = process.env.WHATSAPP_TEST_MODE === 'true';
        this.testRecipient = process.env.WHATSAPP_TEST_RECIPIENT;
    }

    // Enviar pre-alerta
    async sendPreAlert(userId, alert) {
        if (!this.isEnabled) {
            logger.info('WhatsApp desactivado. No se envió pre-alerta.');
            return { success: false, reason: 'whatsapp_disabled' };
        }

        try {
            // Obtener número de teléfono del usuario
            const userPhone = await this.getUserPhone(userId);
            if (!userPhone) return { success: false, reason: 'invalid_phone' };

            // Formatear mensaje
            const message = whatsappFormatter.formatPreAlert(alert);

            // Enviar mensaje
            const result = await whatsappClient.sendTextMessage(userPhone, message);

            return { success: true, messageId: result.messages[0].id };
        } catch (error) {
            logger.error(`Error enviando pre-alerta WhatsApp: ${error.message}`);
            return { success: false, reason: 'send_error', error: error.message };
        }
    }

    // Enviar alerta principal
    async sendMainAlert(userId, alert) {
        if (!this.isEnabled) {
            logger.info('WhatsApp desactivado. No se envió alerta principal.');
            return { success: false, reason: 'whatsapp_disabled' };
        }

        try {
            // Obtener número de teléfono y plan del usuario
            const userPhone = await this.getUserPhone(userId);
            const userPlan = await userService.getUserPlan(userId);

            if (!userPhone) return { success: false, reason: 'invalid_phone' };

            // Formatear mensaje según plan
            const { text, buttons } = whatsappFormatter.formatMainAlert(alert, userPlan);

            // Enviar mensaje con botones
            const result = await whatsappClient.sendButtonMessage(userPhone, text, buttons);

            return { success: true, messageId: result.messages[0].id };
        } catch (error) {
            logger.error(`Error enviando alerta principal WhatsApp: ${error.message}`);
            return { success: false, reason: 'send_error', error: error.message };
        }
    }

    // Enviar análisis detallado
    async sendDetailedAnalysis(userId, alert) {
        if (!this.isEnabled) {
            logger.info('WhatsApp desactivado. No se envió análisis detallado.');
            return { success: false, reason: 'whatsapp_disabled' };
        }

        try {
            // Obtener número de teléfono y plan del usuario
            const userPhone = await this.getUserPhone(userId);
            const userPlan = await userService.getUserPlan(userId);

            if (!userPhone) return { success: false, reason: 'invalid_phone' };

            // Verificar si el plan permite análisis detallado
            if (userPlan === 'free') {
                return { success: false, reason: 'plan_restriction' };
            }

            // Formatear mensaje
            const message = whatsappFormatter.formatDetailedAnalysis(alert, userPlan);

            // Enviar mensaje
            const result = await whatsappClient.sendTextMessage(userPhone, message);

            return { success: true, messageId: result.messages[0].id };
        } catch (error) {
            logger.error(`Error enviando análisis detallado: ${error.message}`);
            return { success: false, reason: 'send_error', error: error.message };
        }
    }

    // Obtener número de teléfono del usuario
    async getUserPhone(userId) {
        if (this.isTestMode) {
            return this.testRecipient;
        }

        const user = await userService.getUserById(userId);
        return user ? user.phone : null;
    }
}

module.exports = new WhatsAppSender();