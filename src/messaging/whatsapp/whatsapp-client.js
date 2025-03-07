/**
 * Cliente para WhatsApp Business API
 * Gestiona la conexión con la API de WhatsApp
 */
const axios = require('axios');
const config = require('../../config/app-config').whatsapp;
const logger = require('../../utils/logger');

class WhatsAppClient {
    constructor() {
        this.baseUrl = config.baseUrl;
        this.token = process.env.WHATSAPP_TOKEN || config.token;
        this.phoneNumberId = process.env.WHATSAPP_PHONE_ID || config.phoneNumberId;
        this.version = config.version || 'v14.0';

        this.httpClient = axios.create({
            baseURL: `${this.baseUrl}/${this.version}/${this.phoneNumberId}`,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        });
    }

    // Enviar mensaje de texto
    async sendTextMessage(to, text) {
        try {
            const response = await this.httpClient.post('/messages', {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to,
                type: 'text',
                text: {
                    body: text
                }
            });

            logger.info(`Mensaje enviado a ${to}`);
            return response.data;
        } catch (error) {
            logger.error(`Error enviando mensaje WhatsApp: ${error.message}`);
            throw error;
        }
    }

    // Enviar mensaje con botones
    async sendButtonMessage(to, text, buttons) {
        try {
            const response = await this.httpClient.post('/messages', {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: {
                        text: text
                    },
                    action: {
                        buttons: buttons.map((button, index) => ({
                            type: 'reply',
                            reply: {
                                id: `button_${index}`,
                                title: button
                            }
                        }))
                    }
                }
            });

            logger.info(`Mensaje interactivo enviado a ${to}`);
            return response.data;
        } catch (error) {
            logger.error(`Error enviando mensaje interactivo: ${error.message}`);
            throw error;
        }
    }

    // Enviar mensaje con sección de lista
    async sendListMessage(to, text, sections) {
        try {
            const response = await this.httpClient.post('/messages', {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to,
                type: 'interactive',
                interactive: {
                    type: 'list',
                    body: {
                        text: text
                    },
                    action: {
                        button: 'Ver opciones',
                        sections: sections
                    }
                }
            });

            logger.info(`Mensaje con lista enviado a ${to}`);
            return response.data;
        } catch (error) {
            logger.error(`Error enviando mensaje con lista: ${error.message}`);
            throw error;
        }
    }

    // Verificar estado del mensaje
    async getMessageStatus(messageId) {
        try {
            const response = await this.httpClient.get(`/messages/${messageId}`);
            return response.data;
        } catch (error) {
            logger.error(`Error obteniendo estado de mensaje: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new WhatsAppClient();