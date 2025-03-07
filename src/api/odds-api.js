/**
 * Cliente específico para The Odds API
 */
class OddsApiClient {
    constructor() {
        this.baseUrl = 'https://api.the-odds-api.com/v4';
        this.apiKey = process.env.ODDS_API_KEY;
    }

    // Métodos específicos para cada endpoint
    async getSports() {... }
    async getOdds(sport, regions = 'eu', markets = 'h2h,totals') {... }
    async getEventOdds(sport, eventId, regions = 'eu') {... }
}