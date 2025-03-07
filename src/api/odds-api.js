/**
 * Cliente para The Odds API
 * Gestiona peticiones a The Odds API para obtener cuotas de apuestas
 */
const axios = require('axios');
const logger = require('../utils/logger');
const apiConfig = require('../config/api-config');

class OddsApiClient {
    constructor() {
        // Configuración desde variables de entorno o archivo de configuración
        this.baseUrl = process.env.ODDS_API_URL || apiConfig.odds.baseUrl || 'https://api.the-odds-api.com/v4';
        this.apiKey = process.env.ODDS_API_KEY || apiConfig.odds.apiKey;

        // Verificar si la clave está configurada
        if (!this.apiKey) {
            logger.warn('The Odds API key no configurada. Algunas funciones no estarán disponibles.');
        }

        // Crear cliente HTTP con configuración base
        this.httpClient = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000 // 10 segundos timeout
        });

        // Contadores para límites de API
        this.requestCount = {
            monthly: 0,
            daily: 0,
            lastReset: {
                daily: new Date().setHours(0, 0, 0, 0),
                monthly: new Date().setDate(1)
            }
        };

        // Límites por defecto
        this.limits = {
            monthlyLimit: apiConfig.odds.monthlyLimit || 500,
            dailyTarget: apiConfig.odds.dailyTarget || 16  // ~16/día para no exceder 500/mes
        };
    }

    /**
     * Realizar petición a la API con manejo de errores y límites
     * @param {string} endpoint - Endpoint de la API
     * @param {Object} params - Parámetros de la petición
     * @returns {Promise<Object|null>} - Respuesta de la API o null en caso de error
     */
    async makeRequest(endpoint, params = {}) {
        // Añadir API key a los parámetros
        const requestParams = {
            apiKey: this.apiKey,
            ...params
        };

        // Verificar límites
        if (!this.checkLimits()) {
            logger.warn('Límite de The Odds API alcanzado');
            return null;
        }

        try {
            // Realizar petición
            const response = await this.httpClient.get(endpoint, { params: requestParams });

            // Actualizar contador
            this.updateRequestCount(response.headers);

            // Verificar si la respuesta es correcta
            if (response.data && response.status === 200) {
                return response.data;
            } else {
                logger.warn(`Respuesta inesperada de The Odds API: ${response.status}`);
                return null;
            }
        } catch (error) {
            this.handleApiError(error, endpoint);
            return null;
        }
    }

    /**
     * Verificar si no se han superado los límites
     * @returns {boolean} - True si se puede realizar la petición
     */
    checkLimits() {
        // Resetear contadores si es un nuevo día/mes
        const today = new Date().setHours(0, 0, 0, 0);
        const thisMonth = new Date().setDate(1);

        if (today > this.requestCount.lastReset.daily) {
            this.requestCount.daily = 0;
            this.requestCount.lastReset.daily = today;
        }

        if (thisMonth > this.requestCount.lastReset.monthly) {
            this.requestCount.monthly = 0;
            this.requestCount.lastReset.monthly = thisMonth;
        }

        // Verificar límite mensual
        if (this.requestCount.monthly >= this.limits.monthlyLimit) {
            return false;
        }

        // Verificar límite diario objetivo
        if (this.requestCount.daily >= this.limits.dailyTarget) {
            return false;
        }

        return true;
    }

    /**
     * Actualizar contador de peticiones
     * @param {Object} headers - Cabeceras de la respuesta
     */
    updateRequestCount(headers) {
        this.requestCount.daily++;
        this.requestCount.monthly++;

        // Si las cabeceras contienen información de límites, actualizarlos
        if (headers['x-requests-remaining']) {
            const remaining = parseInt(headers['x-requests-remaining']);
            const used = parseInt(headers['x-requests-used'] || '0');

            if (!isNaN(remaining) && !isNaN(used)) {
                // Actualizar límite mensual total
                this.limits.monthlyLimit = remaining + used;
                // Actualizar contador mensual
                this.requestCount.monthly = used;

                logger.debug(`Peticiones The Odds API restantes: ${remaining}`);
            }
        }

        logger.debug(`Peticiones The Odds API hoy: ${this.requestCount.daily}/${this.limits.dailyTarget}`);
    }

    /**
     * Manejar errores de la API
     * @param {Error} error - Error de la petición
     * @param {string} endpoint - Endpoint que se estaba consultando
     */
    handleApiError(error, endpoint) {
        if (error.response) {
            // La petición fue realizada y el servidor respondió con un código de error
            logger.error(`Error ${error.response.status} en The Odds API (${endpoint}): ${error.response.data.message || 'Sin mensaje'}`);

            // Manejar casos específicos
            if (error.response.status === 429) {
                logger.error('Límite de The Odds API excedido');
            }
        } else if (error.request) {
            // La petición fue realizada pero no se recibió respuesta
            logger.error(`No se recibió respuesta de The Odds API (${endpoint})`);
        } else {
            // Error en la configuración de la petición
            logger.error(`Error al configurar petición a The Odds API (${endpoint}): ${error.message}`);
        }
    }

    /**
     * Obtener lista de deportes disponibles
     * @returns {Promise<Array|null>} - Lista de deportes
     */
    async getSports() {
        try {
            const response = await this.makeRequest('sports');

            if (response) {
                // Filtrar solo deportes activos
                const activeSports = response.filter(sport => sport.active);
                logger.info(`Obtenidos ${activeSports.length} deportes activos`);
                return activeSports;
            }

            return null;
        } catch (error) {
            logger.error(`Error obteniendo deportes: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener cuotas para un deporte específico
     * @param {string} sport - Clave del deporte (ej. 'soccer_argentina_primera_division')
     * @param {string} regions - Regiones de cuotas (ej. 'eu,uk,us')
     * @param {string} markets - Mercados a consultar (ej. 'h2h,spreads,totals')
     * @param {string} dateFormat - Formato de fecha (iso, unix)
     * @returns {Promise<Array|null>} - Lista de eventos con cuotas
     */
    async getOdds(sport, regions = 'eu', markets = 'h2h,totals', dateFormat = 'iso') {
        try {
            const response = await this.makeRequest('sports/' + sport + '/odds', {
                regions,
                markets,
                dateFormat
            });

            if (response) {
                logger.info(`Obtenidas cuotas para ${response.length} eventos de ${sport}`);
                return response;
            }

            return null;
        } catch (error) {
            logger.error(`Error obteniendo cuotas para ${sport}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener cuotas para un evento específico
     * @param {string} sport - Clave del deporte
     * @param {string} eventId - ID del evento
     * @param {string} regions - Regiones de cuotas
     * @param {string} markets - Mercados a consultar
     * @returns {Promise<Object|null>} - Evento con cuotas
     */
    async getEventOdds(sport, eventId, regions = 'eu', markets = 'h2h,totals') {
        try {
            const response = await this.makeRequest(`sports/${sport}/events/${eventId}/odds`, {
                regions,
                markets
            });

            if (response) {
                return response;
            }

            logger.warn(`No se encontraron cuotas para evento ${eventId}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo cuotas para evento ${eventId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener historial de cuotas para un evento
     * @param {string} sport - Clave del deporte
     * @param {string} eventId - ID del evento
     * @param {string} regions - Regiones de cuotas
     * @param {string} markets - Mercados a consultar
     * @param {string} date - Fecha (formato ISO)
     * @returns {Promise<Object|null>} - Historial de cuotas
     */
    async getHistoricalOdds(sport, eventId, regions = 'eu', markets = 'h2h,totals', date = null) {
        try {
            const params = {
                regions,
                markets
            };

            if (date) {
                params.date = date;
            }

            const response = await this.makeRequest(`sports/${sport}/events/${eventId}/odds/historical`, params);

            if (response) {
                return response;
            }

            logger.warn(`No se encontró historial de cuotas para evento ${eventId}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo historial de cuotas: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener eventos para un deporte
     * @param {string} sport - Clave del deporte
     * @param {string} regions - Regiones de cuotas
     * @param {string} status - Estado de eventos (upcoming o ended)
     * @returns {Promise<Array|null>} - Lista de eventos
     */
    async getEvents(sport, regions = 'eu', status = 'upcoming') {
        try {
            const response = await this.makeRequest(`sports/${sport}/events`, {
                regions,
                status
            });

            if (response) {
                logger.info(`Obtenidos ${response.length} eventos de ${sport}`);
                return response;
            }

            return null;
        } catch (error) {
            logger.error(`Error obteniendo eventos para ${sport}: ${error.message}`);
            return null;
        }
    }

    /**
     * Buscar el código de deporte para un partido de fútbol
     * @param {string} homeTeam - Equipo local
     * @param {string} awayTeam - Equipo visitante
     * @returns {Promise<Object|null>} - Información del evento encontrado
     */
    async findSoccerEventByTeams(homeTeam, awayTeam) {
        try {
            // Lista de posibles deportes de fútbol
            const soccerSports = [
                'soccer_argentina_primera_division',
                'soccer_fifa_world_cup',
                'soccer_spain_la_liga',
                'soccer_epl',
                'soccer_italy_serie_a',
                'soccer_germany_bundesliga',
                'soccer_france_ligue_one',
                'soccer_uefa_champs_league',
                'soccer_uefa_europa_league',
                'soccer_copa_libertadores'
            ];

            // Intentar buscar en cada deporte
            for (const sport of soccerSports) {
                const events = await this.getEvents(sport);

                if (events && events.length > 0) {
                    // Buscar coincidencia de equipos
                    const event = events.find(evt => {
                        const matchHome = evt.home_team.toLowerCase();
                        const matchAway = evt.away_team.toLowerCase();

                        return (
                            matchHome.includes(homeTeam.toLowerCase()) ||
                            homeTeam.toLowerCase().includes(matchHome)
                        ) && (
                                matchAway.includes(awayTeam.toLowerCase()) ||
                                awayTeam.toLowerCase().includes(matchAway)
                            );
                    });

                    if (event) {
                        logger.info(`Evento encontrado para ${homeTeam} vs ${awayTeam} en ${sport}`);
                        return {
                            sport,
                            event
                        };
                    }
                }
            }

            logger.warn(`No se encontró evento para ${homeTeam} vs ${awayTeam}`);
            return null;
        } catch (error) {
            logger.error(`Error buscando evento por equipos: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener cuotas de un partido por nombres de equipos
     * @param {string} homeTeam - Equipo local
     * @param {string} awayTeam - Equipo visitante
     * @param {string} markets - Mercados a consultar
     * @returns {Promise<Object|null>} - Cuotas del partido
     */
    async getMatchOddsByTeams(homeTeam, awayTeam, markets = 'h2h,totals') {
        try {
            // Buscar evento
            const eventInfo = await this.findSoccerEventByTeams(homeTeam, awayTeam);

            if (!eventInfo) {
                return null;
            }

            // Obtener cuotas
            const odds = await this.getEventOdds(eventInfo.sport, eventInfo.event.id, 'eu', markets);

            return odds;
        } catch (error) {
            logger.error(`Error obteniendo cuotas por equipos: ${error.message}`);
            return null;
        }
    }
}

module.exports = new OddsApiClient();