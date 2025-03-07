/**
 * Cliente para API-Football
 * Gestiona peticiones a API-Football para obtener datos de partidos
 */
const axios = require('axios');
const logger = require('../utils/logger');
const apiConfig = require('../config/api-config');

class FootballApiClient {
    constructor() {
        // Configuración desde variables de entorno o archivo de configuración
        this.baseUrl = process.env.FOOTBALL_API_URL || apiConfig.football.baseUrl || 'https://api-football-v1.p.rapidapi.com/v3';
        this.apiKey = process.env.FOOTBALL_API_KEY || apiConfig.football.apiKey;
        this.apiHost = process.env.FOOTBALL_API_HOST || apiConfig.football.apiHost || 'api-football-v1.p.rapidapi.com';

        // Verificar si las claves están configuradas
        if (!this.apiKey) {
            logger.warn('API-Football key no configurada. Algunas funciones no estarán disponibles.');
        }

        // Crear cliente HTTP con configuración base
        this.httpClient = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'X-RapidAPI-Key': this.apiKey,
                'X-RapidAPI-Host': this.apiHost,
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 segundos timeout
        });

        // Contadores para límites de API
        this.requestCount = {
            daily: 0,
            lastReset: new Date().setHours(0, 0, 0, 0)
        };

        // Límites por defecto
        this.limits = {
            dailyLimit: apiConfig.football.dailyLimit || 100
        };
    }

    /**
     * Realizar petición a la API con manejo de errores y límites
     * @param {string} endpoint - Endpoint de la API
     * @param {Object} params - Parámetros de la petición
     * @returns {Promise<Object|null>} - Respuesta de la API o null en caso de error
     */
    async makeRequest(endpoint, params = {}) {
        // Verificar límites
        if (!this.checkLimits()) {
            logger.warn('Límite diario de API-Football alcanzado');
            return null;
        }

        try {
            // Realizar petición
            const response = await this.httpClient.get(endpoint, { params });

            // Actualizar contador
            this.updateRequestCount();

            // Verificar si la respuesta es correcta
            if (response.data && response.status === 200) {
                return response.data;
            } else {
                logger.warn(`Respuesta inesperada de API-Football: ${response.status}`);
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
        // Resetear contador si es un nuevo día
        const today = new Date().setHours(0, 0, 0, 0);
        if (today > this.requestCount.lastReset) {
            this.requestCount.daily = 0;
            this.requestCount.lastReset = today;
            return true;
        }

        // Verificar límite diario
        return this.requestCount.daily < this.limits.dailyLimit;
    }

    /**
     * Actualizar contador de peticiones
     */
    updateRequestCount() {
        this.requestCount.daily++;
        logger.debug(`Peticiones API-Football hoy: ${this.requestCount.daily}/${this.limits.dailyLimit}`);
    }

    /**
     * Manejar errores de la API
     * @param {Error} error - Error de la petición
     * @param {string} endpoint - Endpoint que se estaba consultando
     */
    handleApiError(error, endpoint) {
        if (error.response) {
            // La petición fue realizada y el servidor respondió con un código de error
            logger.error(`Error ${error.response.status} en API-Football (${endpoint}): ${error.response.data.message || 'Sin mensaje'}`);

            // Manejar casos específicos
            if (error.response.status === 429) {
                logger.error('Límite de API-Football excedido');
            }
        } else if (error.request) {
            // La petición fue realizada pero no se recibió respuesta
            logger.error(`No se recibió respuesta de API-Football (${endpoint})`);
        } else {
            // Error en la configuración de la petición
            logger.error(`Error al configurar petición a API-Football (${endpoint}): ${error.message}`);
        }
    }

    /**
     * Obtener partidos en vivo
     * @returns {Promise<Array|null>} - Lista de partidos en vivo
     */
    async getLiveMatches() {
        try {
            const response = await this.makeRequest('fixtures', { live: 'all' });

            if (response && response.response) {
                logger.info(`Obtenidos ${response.response.length} partidos en vivo`);
                return response.response;
            }

            return null;
        } catch (error) {
            logger.error(`Error obteniendo partidos en vivo: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener partidos programados para las próximas horas
     * @param {number} hours - Número de horas a consultar
     * @returns {Promise<Array|null>} - Lista de partidos programados
     */
    async getUpcomingMatches(hours = 2) {
        try {
            // Calcular fecha actual y límite
            const now = new Date();
            const to = new Date(now.getTime() + (hours * 60 * 60 * 1000));

            // Formatear fechas para la API (YYYY-MM-DD)
            const fromDate = now.toISOString().split('T')[0];
            const toDate = to.toISOString().split('T')[0];

            // Si es el mismo día, usar solo una fecha
            if (fromDate === toDate) {
                const response = await this.makeRequest('fixtures', { date: fromDate });

                if (response && response.response) {
                    // Filtrar solo partidos en las próximas "hours" horas
                    const upcomingMatches = response.response.filter(match => {
                        const matchDate = new Date(match.fixture.date);
                        return matchDate > now && matchDate <= to;
                    });

                    logger.info(`Obtenidos ${upcomingMatches.length} partidos para próximas ${hours} horas`);
                    return upcomingMatches;
                }
            } else {
                // Si son días diferentes, hacer múltiples peticiones
                const responsesPromises = [
                    this.makeRequest('fixtures', { date: fromDate }),
                    this.makeRequest('fixtures', { date: toDate })
                ];

                const responses = await Promise.all(responsesPromises);
                let allMatches = [];

                responses.forEach(response => {
                    if (response && response.response) {
                        allMatches = [...allMatches, ...response.response];
                    }
                });

                // Filtrar solo partidos en las próximas "hours" horas
                const upcomingMatches = allMatches.filter(match => {
                    const matchDate = new Date(match.fixture.date);
                    return matchDate > now && matchDate <= to;
                });

                logger.info(`Obtenidos ${upcomingMatches.length} partidos para próximas ${hours} horas`);
                return upcomingMatches;
            }

            return null;
        } catch (error) {
            logger.error(`Error obteniendo partidos programados: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener información de un partido específico
     * @param {string|number} fixtureId - ID del partido
     * @returns {Promise<Object|null>} - Datos del partido
     */
    async getFixture(fixtureId) {
        try {
            const response = await this.makeRequest('fixtures', { id: fixtureId });

            if (response && response.response && response.response.length > 0) {
                return response.response[0];
            }

            logger.warn(`No se encontró información para el partido ${fixtureId}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo información del partido ${fixtureId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener estadísticas de un partido
     * @param {string|number} fixtureId - ID del partido
     * @returns {Promise<Object|null>} - Estadísticas del partido
     */
    async getFixtureStatistics(fixtureId) {
        try {
            const response = await this.makeRequest('fixtures/statistics', { fixture: fixtureId });

            if (response && response.response) {
                return response.response;
            }

            logger.warn(`No se encontraron estadísticas para el partido ${fixtureId}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo estadísticas del partido ${fixtureId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener eventos de un partido
     * @param {string|number} fixtureId - ID del partido
     * @returns {Promise<Array|null>} - Lista de eventos
     */
    async getFixtureEvents(fixtureId) {
        try {
            const response = await this.makeRequest('fixtures/events', { fixture: fixtureId });

            if (response && response.response) {
                return response.response;
            }

            logger.warn(`No se encontraron eventos para el partido ${fixtureId}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo eventos del partido ${fixtureId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener alineaciones de un partido
     * @param {string|number} fixtureId - ID del partido
     * @returns {Promise<Object|null>} - Alineaciones del partido
     */
    async getFixtureLineups(fixtureId) {
        try {
            const response = await this.makeRequest('fixtures/lineups', { fixture: fixtureId });

            if (response && response.response) {
                return response.response;
            }

            logger.warn(`No se encontraron alineaciones para el partido ${fixtureId}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo alineaciones del partido ${fixtureId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener historial de enfrentamientos entre dos equipos
     * @param {string|number} team1 - ID del primer equipo
     * @param {string|number} team2 - ID del segundo equipo
     * @returns {Promise<Array|null>} - Historial de enfrentamientos
     */
    async getH2H(team1, team2) {
        try {
            const response = await this.makeRequest('fixtures/headtohead', {
                h2h: `${team1}-${team2}`
            });

            if (response && response.response) {
                return response.response;
            }

            logger.warn(`No se encontró historial para equipos ${team1} vs ${team2}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo historial de equipos: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener información de un equipo
     * @param {string|number} teamId - ID del equipo
     * @returns {Promise<Object|null>} - Información del equipo
     */
    async getTeam(teamId) {
        try {
            const response = await this.makeRequest('teams', { id: teamId });

            if (response && response.response && response.response.length > 0) {
                return response.response[0];
            }

            logger.warn(`No se encontró información para el equipo ${teamId}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo información del equipo ${teamId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener estadísticas de un equipo en una competición
     * @param {string|number} teamId - ID del equipo
     * @param {string|number} leagueId - ID de la liga
     * @param {string} season - Temporada (ej. "2023")
     * @returns {Promise<Object|null>} - Estadísticas del equipo
     */
    async getTeamStatistics(teamId, leagueId, season = new Date().getFullYear().toString()) {
        try {
            const response = await this.makeRequest('teams/statistics', {
                team: teamId,
                league: leagueId,
                season: season
            });

            if (response && response.response) {
                return response.response;
            }

            logger.warn(`No se encontraron estadísticas para el equipo ${teamId} en liga ${leagueId}`);
            return null;
        } catch (error) {
            logger.error(`Error obteniendo estadísticas de equipo: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener ligas disponibles (con filtro opcional por país)
     * @param {string} country - País (opcional)
     * @returns {Promise<Array|null>} - Lista de ligas
     */
    async getLeagues(country = null) {
        try {
            const params = {};
            if (country) {
                params.country = country;
            }

            const response = await this.makeRequest('leagues', params);

            if (response && response.response) {
                return response.response;
            }

            return null;
        } catch (error) {
            logger.error(`Error obteniendo ligas: ${error.message}`);
            return null;
        }
    }

    /**
     * Obtener temporadas disponibles
     * @returns {Promise<Array|null>} - Lista de temporadas
     */
    async getSeasons() {
        try {
            const response = await this.makeRequest('leagues/seasons');

            if (response && response.response) {
                return response.response;
            }

            return null;
        } catch (error) {
            logger.error(`Error obteniendo temporadas: ${error.message}`);
            return null;
        }
    }
}

module.exports = new FootballApiClient();